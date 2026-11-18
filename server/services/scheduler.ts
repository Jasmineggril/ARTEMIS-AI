/**
 * In-process scheduler (enabled with SCHEDULER_ENABLED=true; off in tests).
 *   INPE        every INPE_SYNC_MINUTES (default 60): today + yesterday, then hotspot alerts
 *   Sisfogo     incremental every SISFOGO_SYNC_HOURS (default 24); complete when the last
 *               complete run is older than 7 days
 *   E-mails     alert notifications due, every NOTIFY_MINUTES (default 5)
 *   INMET       station registry + current-year archive every INMET_SYNC_HOURS (default 24);
 *               the archive is downloaded only when its Last-Modified changed
 * Each job runs under a PostgreSQL advisory lock, so it never overlaps itself
 * or the same job started by cron/CLI. Every run is recorded in
 * source_sync_runs (visible in Fontes de Dados and in the admin panel).
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { syncInpeDay, recentUtcDays } from "../connectors/inpe";
import { syncSisfogo, SisfogoBusyError } from "./sisfogo-sync";
import { evaluateHotspotAlerts } from "./hotspot-alerts";
import { processDeliveries } from "./notifications";
import { syncInmetStations } from "../connectors/inmet";
import { syncInmetYear, archiveLooksUnchanged, InmetBusyError } from "./inmet-sync";

const log = (e: Record<string, unknown>) => console.log(JSON.stringify({ time: new Date().toISOString(), source: "scheduler", ...e }));

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T | "busy"> {
  if (!pool) throw new Error("Banco de dados não configurado.");
  const c = await pool.connect();
  try {
    const { rows: [r] } = await c.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [key]);
    if (!r?.ok) return "busy";
    try {
      return await fn();
    } finally {
      await c.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => {});
    }
  } finally {
    c.release();
  }
}

async function lastSuccess(key: string, mode?: string): Promise<Date | null> {
  const r = await db.execute<{ at: Date | null }>(sql`
    SELECT max(r.finished_at) AS at FROM source_sync_runs r JOIN data_sources s ON s.id = r.source_id
    WHERE s.key = ${key} AND r.status = 'sucesso' ${mode ? sql`AND r.params->>'mode' = ${mode} AND r.progress->>'stoppedBecause' = 'fim_da_lista'` : sql``}`);
  const at = r.rows[0]?.at;
  return at ? new Date(at) : null;
}

/** INPE sync for today and yesterday (UTC), then hotspot alerts. Exported for the CLI and tests. */
export async function runInpeCycle() {
  const res = await withLock("artemis:sync:inpe-queimadas", async () => {
    const days = [];
    for (const day of recentUtcDays(2)) days.push(await syncInpeDay(day));
    const alerts = await evaluateHotspotAlerts({ windowHours: 24 });
    return { days: days.map((d) => ({ day: d.day, status: d.status, inserted: d.inserted, updated: d.updated, error: d.error })), alerts };
  });
  log({ job: "inpe", result: res });
  return res;
}

async function runSisfogoCycle() {
  const lastComplete = await lastSuccess("sisfogo-roi", "completa");
  const mode = !lastComplete || Date.now() - lastComplete.getTime() > 7 * 86_400_000 ? "completa" : "incremental";
  try {
    const r = await syncSisfogo({ mode, trigger: "agendado" });
    log({ job: "sisfogo", mode, status: r.status, inserted: r.inserted, updated: r.updated, rectified: r.rectified, error: r.error });
  } catch (err) {
    if (err instanceof SisfogoBusyError) log({ job: "sisfogo", status: "ignorado", reason: "já em andamento" });
    else log({ job: "sisfogo", status: "erro", error: err instanceof Error ? err.message : String(err) });
  }
}

export async function runInmetCycle() {
  const year = new Date().getUTCFullYear();
  try {
    const st = await syncInmetStations();
    if (await archiveLooksUnchanged(year)) { log({ job: "inmet", stations: st.status, archive: "sem alteração (Last-Modified)" }); return; }
    const r = await syncInmetYear(year, { trigger: "agendado" });
    log({ job: "inmet", stations: st.status, year, status: r.status, inserted: r.inserted, updated: r.updated, unchangedArchive: r.unchangedArchive, error: r.error });
  } catch (err) {
    if (err instanceof InmetBusyError) log({ job: "inmet", status: "ignorado", reason: "já em andamento" });
    else log({ job: "inmet", status: "erro", error: err instanceof Error ? err.message : String(err) });
  }
}

let timers: NodeJS.Timeout[] = [];

export function startScheduler() {
  if (process.env.SCHEDULER_ENABLED !== "true" || process.env.NODE_ENV === "test") return false;
  const inpeMin = Math.max(15, Number(process.env.INPE_SYNC_MINUTES ?? 60));
  const sisH = Math.max(1, Number(process.env.SISFOGO_SYNC_HOURS ?? 24));
  const safe = (name: string, fn: () => Promise<unknown>) => () => fn().catch((e) => log({ job: name, status: "erro", error: e instanceof Error ? e.message : String(e) }));
  const inpe = safe("inpe", runInpeCycle);
  const sis = safe("sisfogo", runSisfogoCycle);
  const inmetH = Math.max(6, Number(process.env.INMET_SYNC_HOURS ?? 24));
  const inmetJob = process.env.INMET_SYNC_ENABLED === "false" ? () => {} : safe("inmet", runInmetCycle);
  const notifyMin = Math.max(1, Number(process.env.NOTIFY_MINUTES ?? 5));
  const notify = safe("notificacoes", async () => {
    const r = await processDeliveries();
    if (r.claimed) log({ job: "notificacoes", result: r });
  });

  // On start, catch up only what is overdue (a restart does not re-download everything).
  setTimeout(async () => {
    const [i, s] = await Promise.all([lastSuccess("inpe-queimadas"), lastSuccess("sisfogo-roi")]).catch(() => [null, null]);
    if (!i || Date.now() - i.getTime() > inpeMin * 60_000) inpe();
    if (!s || Date.now() - s.getTime() > sisH * 3_600_000) sis();
    const m = await lastSuccess("inmet-estacoes").catch(() => null);
    if (process.env.INMET_SYNC_ENABLED !== "false" && (!m || Date.now() - m.getTime() > inmetH * 3_600_000)) inmetJob();
  }, 30_000).unref();
  if (process.env.INMET_SYNC_ENABLED === "false") log({ job: "inmet", status: "desativado" });
  timers = [setInterval(inpe, inpeMin * 60_000), setInterval(sis, sisH * 3_600_000), setInterval(notify, notifyMin * 60_000), setInterval(inmetJob, inmetH * 3_600_000)];
  timers.forEach((t) => t.unref());
  log({ status: "iniciado", inpeMinutes: inpeMin, sisfogoHours: sisH, notifyMinutes: notifyMin, inmetHours: inmetH });
  return true;
}

export function stopScheduler() {
  timers.forEach(clearInterval);
  timers = [];
}
