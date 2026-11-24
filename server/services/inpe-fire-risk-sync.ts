/**
 * Sync of INPE's official fire risk (observed + forecast) into fire_risk_values (per monitored
 * area and INMET station) and fire_risk_grids (0.2° grid for the map).
 *  - Idempotent: upserts by (index, product, target, day, lead); an observed file already processed
 *    with the same sha256 is skipped.
 *  - A failure leaves no partial data (one transaction per file) and is recorded in source_sync_runs.
 *  - One run at a time (advisory lock). No call to INPE beyond the files themselves.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { dataSources, fireRiskGrids, fireRiskValues, monitoredAreas, sourceSyncRuns, weatherStations } from "@shared/schema";
import type { RetryPolicy } from "../connectors/sisfogo";
import {
  INPE_RF_SOURCE_KEY, ndwrUrl, openNdwrNc, validDays, RF_RETRY, coarseGrid, defaultFetchBin, fetchWithRetry, forecastUrl, observedUrl, openForecastTif, openObservedNc, sampleTargets, sha256,
  type FetchBin, type RfRaster, type RfTarget,
} from "../connectors/inpe-fire-risk";
import { INPE_RF_VERSION } from "@shared/inpe-fire-risk";

export class InpeRfBusyError extends Error { constructor() { super("Sincronização do risco de fogo do INPE já em andamento."); } }
export interface RfFileResult { url: string; product: "observado" | "previsto"; validDay?: string; lead: number; status: "sucesso" | "falha" | "sem_alteracao"; targets?: number; withValue?: number; error?: string; sha256?: string }

async function sourceId() {
  const [s] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, INPE_RF_SOURCE_KEY));
  if (!s) throw new Error("Fonte 'inpe-risco-fogo' não cadastrada (aplique a migração 0019).");
  return s.id;
}

export async function rfTargets(): Promise<RfTarget[]> {
  const areas = await db.select({ id: monitoredAreas.id, boundary: monitoredAreas.boundary, lat: monitoredAreas.latitude, lng: monitoredAreas.longitude })
    .from(monitoredAreas).where(and(sql`${monitoredAreas.organizationId} IS NOT NULL`, sql`${monitoredAreas.status} <> 'inativo'`));
  const st = await db.select({ id: weatherStations.id, lat: weatherStations.latitude, lng: weatherStations.longitude }).from(weatherStations);
  return [...areas.map((a) => ({ type: "area" as const, id: a.id, boundary: a.boundary as any, lat: a.lat, lng: a.lng })), ...st.map((s) => ({ type: "station" as const, id: s.id, lat: s.lat, lng: s.lng }))];
}

async function storeRaster(r: RfRaster, ctx: { product: "observado" | "previsto"; lead: number; issuedOn: string | null; url: string; sha: string; runId: number; targets: RfTarget[]; withGrid: boolean }) {
  const samples = await sampleTargets(r, ctx.targets);
  const grid = ctx.withGrid ? await coarseGrid(r) : null;
  await db.transaction(async (tx) => {
    for (let i = 0; i < samples.length; i += 500) {
      const rows = samples.slice(i, i + 500).map((s) => ({
        indexKey: "inpe_rf_oficial", product: ctx.product, modelVersion: INPE_RF_VERSION, targetType: s.type, targetId: s.id, validDay: r.validDay, leadDays: ctx.lead,
        issuedOn: ctx.issuedOn, valueMean: s.mean, valueMax: s.max, valueMin: s.min, riskClass: s.cls, pixelsTotal: s.pixelsTotal, pixelsValid: s.pixelsValid,
        method: s.method, sourceFile: ctx.url.split("/").pop()!, sourceSha256: ctx.sha, syncRunId: ctx.runId,
      }));
      if (rows.length) await tx.insert(fireRiskValues).values(rows).onConflictDoUpdate({
        target: [fireRiskValues.indexKey, fireRiskValues.product, fireRiskValues.targetType, fireRiskValues.targetId, fireRiskValues.validDay, fireRiskValues.leadDays],
        set: { valueMean: sql`excluded.value_mean`, valueMax: sql`excluded.value_max`, valueMin: sql`excluded.value_min`, riskClass: sql`excluded.risk_class`,
          pixelsTotal: sql`excluded.pixels_total`, pixelsValid: sql`excluded.pixels_valid`, method: sql`excluded.method`, issuedOn: sql`excluded.issued_on`,
          sourceFile: sql`excluded.source_file`, sourceSha256: sql`excluded.source_sha256`, syncRunId: sql`excluded.sync_run_id`, computedAt: sql`now()` },
      });
    }
    if (grid) await tx.insert(fireRiskGrids).values({
      indexKey: "inpe_rf_oficial", product: ctx.product, validDay: r.validDay, leadDays: ctx.lead, cellDeg: grid.cellDeg, lat0: grid.lat0, lon0: grid.lon0,
      nlat: grid.nlat, nlon: grid.nlon, meanValues: grid.mean, maxValues: grid.max, sourceFile: ctx.url.split("/").pop()!, sourceSha256: ctx.sha,
    }).onConflictDoUpdate({
      target: [fireRiskGrids.indexKey, fireRiskGrids.product, fireRiskGrids.validDay, fireRiskGrids.leadDays, fireRiskGrids.cellDeg],
      set: { meanValues: sql`excluded.mean_values`, maxValues: sql`excluded.max_values`, sourceFile: sql`excluded.source_file`, sourceSha256: sql`excluded.source_sha256`, computedAt: sql`now()` },
    });
  });
  return { targets: samples.length, withValue: samples.filter((s) => s.mean != null).length };
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (!pool) throw new Error("Banco de dados não configurado.");
  const c = await pool.connect();
  try {
    const { rows: [l] } = await c.query("SELECT pg_try_advisory_lock(hashtext('artemis:sync:inpe-rf')) AS ok");
    if (!l?.ok) throw new InpeRfBusyError();
    // we hold the lock: any run still "em_execucao" belongs to a process that died
    await db.execute(sql`UPDATE source_sync_runs SET status = 'falha', finished_at = now(), error = 'Execução interrompida antes de concluir (processo encerrado).'
      WHERE status = 'em_execucao' AND source_id = (SELECT id FROM data_sources WHERE key = 'inpe-risco-fogo')`);
    try { return await fn(); } finally { await c.query("SELECT pg_advisory_unlock(hashtext('artemis:sync:inpe-rf'))").catch(() => {}); }
  } finally { c.release(); }
}

async function processFile(product: "observado" | "previsto", url: string, lead: number, opts: { fetchBin?: FetchBin; retry?: RetryPolicy; expectDay?: string; issuedOn?: string | null; targets: RfTarget[]; trigger: string }): Promise<RfFileResult> {
  const src = await sourceId();
  const [run] = await db.insert(sourceSyncRuns).values({ sourceId: src, params: { kind: product, url, lead }, trigger: opts.trigger }).returning();
  const fail = async (error: string): Promise<RfFileResult> => {
    await db.update(sourceSyncRuns).set({ status: "falha", finishedAt: new Date(), error }).where(eq(sourceSyncRuns.id, run.id));
    return { url, product, lead, status: "falha", error };
  };
  let r: RfRaster | null = null;
  try {
    const res = await fetchWithRetry(opts.fetchBin ?? defaultFetchBin, url, opts.retry ?? RF_RETRY);
    if (res.status === 404) return fail(product === "observado" ? `Arquivo do dia ${opts.expectDay} ainda não publicado pelo INPE (404).` : "Previsão não encontrada (404).");
    if (res.status !== 200) return fail(`INPE respondeu HTTP ${res.status}.`);
    const sha = sha256(res.body);
    if (product === "observado" && opts.expectDay) {
      const [seen] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM fire_risk_grids WHERE index_key = 'inpe_rf_oficial' AND product = 'observado' AND valid_day = ${opts.expectDay}::date AND source_sha256 = ${sha}`)).rows;
      if (seen?.n) {
        await db.update(sourceSyncRuns).set({ status: "sucesso", finishedAt: new Date(), params: { kind: product, url, lead, sha256: sha }, progress: { note: "arquivo já processado (mesmo sha256)" } }).where(eq(sourceSyncRuns.id, run.id));
        return { url, product, lead, validDay: opts.expectDay, status: "sem_alteracao", sha256: sha };
      }
    }
    r = product === "observado" ? await openObservedNc(res.body) : await openForecastTif(res.body);
    if (opts.expectDay && r.validDay !== opts.expectDay) return fail(`Arquivo traz o dia ${r.validDay}, esperado ${opts.expectDay}.`);
    const st = await storeRaster(r, { product, lead, issuedOn: opts.issuedOn ?? null, url, sha, runId: run.id, targets: opts.targets, withGrid: true });
    await db.update(sourceSyncRuns).set({ status: "sucesso", finishedAt: new Date(), recordsRead: st.targets, recordsInserted: st.withValue,
      params: { kind: product, url, lead, sha256: sha, validDay: r.validDay, title: r.title, attempts: res.attempts } }).where(eq(sourceSyncRuns.id, run.id));
    await db.update(dataSources).set({ lastUpdate: new Date(), status: "ativo" }).where(eq(dataSources.key, INPE_RF_SOURCE_KEY));
    return { url, product, lead, validDay: r.validDay, status: "sucesso", sha256: sha, ...st };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  } finally { r?.close(); }
}

/** Observed product for each day (YYYY-MM-DD). */
export async function syncObserved(days: string[], opts: { fetchBin?: FetchBin; retry?: RetryPolicy; trigger?: string } = {}) {
  return withLock(async () => {
    const targets = await rfTargets(), out: RfFileResult[] = [];
    for (const d of days) out.push(await processFile("observado", observedUrl(d), 0, { ...opts, expectDay: d, targets, trigger: opts.trigger ?? "cli" }));
    return out;
  });
}

/** Days without rain (grid only, for the drought layer of the map). */
export async function syncDryDays(days: string[], opts: { fetchBin?: FetchBin; retry?: RetryPolicy; trigger?: string } = {}) {
  const src = await sourceId(), out: RfFileResult[] = [];
  for (const d of days) {
    const url = ndwrUrl(d);
    const [run] = await db.insert(sourceSyncRuns).values({ sourceId: src, params: { kind: "dias_sem_chuva", url, day: d }, trigger: opts.trigger ?? "cli" }).returning();
    try {
      const res = await fetchWithRetry(opts.fetchBin ?? defaultFetchBin, url, opts.retry ?? RF_RETRY);
      if (res.status !== 200) throw new Error(res.status === 404 ? `Arquivo de ${d} não publicado (404).` : `INPE respondeu HTTP ${res.status}.`);
      const sha = sha256(res.body), r = await openNdwrNc(res.body, d);
      const g = await coarseGrid(r, 0.2, undefined, validDays);
      await db.insert(fireRiskGrids).values({ indexKey: "inpe_dias_sem_chuva", product: "observado", validDay: d, leadDays: 0, cellDeg: g.cellDeg, lat0: g.lat0, lon0: g.lon0,
        nlat: g.nlat, nlon: g.nlon, meanValues: g.mean, maxValues: g.max, sourceFile: url.split("/").pop()!, sourceSha256: sha })
        .onConflictDoUpdate({ target: [fireRiskGrids.indexKey, fireRiskGrids.product, fireRiskGrids.validDay, fireRiskGrids.leadDays, fireRiskGrids.cellDeg],
          set: { meanValues: sql`excluded.mean_values`, maxValues: sql`excluded.max_values`, sourceSha256: sql`excluded.source_sha256`, computedAt: sql`now()` } });
      await db.update(sourceSyncRuns).set({ status: "sucesso", finishedAt: new Date(), params: { kind: "dias_sem_chuva", url, day: d, sha256: sha } }).where(eq(sourceSyncRuns.id, run.id));
      out.push({ url, product: "observado", lead: 0, validDay: d, status: "sucesso", sha256: sha });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await db.update(sourceSyncRuns).set({ status: "falha", finishedAt: new Date(), error }).where(eq(sourceSyncRuns.id, run.id));
      out.push({ url, product: "observado", lead: 0, status: "falha", error });
    }
  }
  return out;
}

/** Forecast T0..T3 (validity from each file's title; issued on T0's day). */
export async function syncForecast(opts: { fetchBin?: FetchBin; retry?: RetryPolicy; trigger?: string; leads?: number[] } = {}) {
  return withLock(async () => {
    const targets = await rfTargets(), out: RfFileResult[] = [];
    let issuedOn: string | null = null;
    for (const lead of opts.leads ?? [0, 1, 2, 3]) {
      const r = await processFile("previsto", forecastUrl(lead), lead, { ...opts, issuedOn, targets, trigger: opts.trigger ?? "cli" });
      if (lead === 0 && r.validDay) issuedOn = r.validDay;
      out.push(r);
    }
    // T0's issue day is its own validity day
    if (issuedOn) await db.execute(sql`UPDATE fire_risk_values SET issued_on = ${issuedOn}::date WHERE index_key = 'inpe_rf_oficial' AND product = 'previsto' AND issued_on IS NULL AND valid_day >= ${issuedOn}::date`);
    return out;
  });
}

/** What the scheduler runs: the last `days` observed days (already-processed files are skipped) + the forecast. */
export async function syncRecentRisk(days = 3) {
  const list = Array.from({ length: days }, (_, i) => new Date(Date.now() - (i + 1) * 86_400_000).toISOString().slice(0, 10));
  return { observado: await syncObserved(list, { trigger: "agendado" }), previsto: await syncForecast({ trigger: "agendado" }),
    diasSemChuva: await syncDryDays(list.slice(0, 1), { trigger: "agendado" }) };
}
