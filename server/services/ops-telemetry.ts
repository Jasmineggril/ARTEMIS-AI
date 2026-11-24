/**
 * Operational telemetry measured by the running system (evidence for TRL 7–9).
 *
 *   requestMetrics()   Express middleware: per-minute, per-route-group counters
 *                      (requests, 4xx, 5xx, p50/p95/max latency). Route groups
 *                      replace ids with ":id"; no query strings, no user data.
 *   heartbeat          every minute: database round-trip, risk engine health,
 *                      freshness of INPE and Sisfogo data.
 *
 * Availability is computed later as minutes WITH a healthy heartbeat divided by
 * minutes in the window: if the server is down, no heartbeat is written and
 * the gap counts as downtime (it cannot hide an outage).
 */
import os from "node:os";
import type { RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { opsHeartbeats } from "@shared/schema";
import { inpeFreshness } from "../connectors/inpe";

export const INSTANCE = process.env.OPS_INSTANCE ?? `${os.hostname()}:${process.pid}`;

const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{24,})$/i;
export function routeGroup(path: string): string {
  if (!path.startsWith("/api/")) return path.startsWith("/assets/") ? "static:assets" : "static:page";
  return path.split("?")[0].split("/").map((s) => (ID_SEGMENT.test(s) ? ":id" : s)).join("/").replace(/\.(csv|json)$/, ".$1").slice(0, 120);
}

interface Bucket { requests: number; e4: number; e5: number; samples: number[] }
const buckets = new Map<string, Bucket>(); // key: minuteIso|route
const MAX_SAMPLES = 2000;

const minuteOf = (t: number) => new Date(Math.floor(t / 60_000) * 60_000).toISOString();

export function recordRequest(path: string, status: number, ms: number, at = Date.now()) {
  const key = `${minuteOf(at)}|${routeGroup(path)}`;
  let b = buckets.get(key);
  if (!b) { b = { requests: 0, e4: 0, e5: 0, samples: [] }; buckets.set(key, b); }
  b.requests++;
  if (status >= 500) b.e5++; else if (status >= 400) b.e4++;
  if (b.samples.length < MAX_SAMPLES) b.samples.push(ms);
  else b.samples[Math.floor(Math.random() * b.requests) % MAX_SAMPLES] = ms; // reservoir sample
}

export const requestMetrics = (): RequestHandler => (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    recordRequest(req.path, res.statusCode, ms);
  });
  next();
};

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : 0);

/** Writes every COMPLETED minute (or all, with force) and removes it from memory. */
export async function flushRequestMetrics(force = false): Promise<number> {
  const current = minuteOf(Date.now());
  const rows: { minute: string; route: string; b: Bucket }[] = [];
  buckets.forEach((b, key) => {
    const [minute, route] = key.split("|");
    if (force || minute < current) rows.push({ minute, route, b });
  });
  if (!rows.length) return 0;
  for (const { minute, route, b } of rows) {
    const s = [...b.samples].sort((x, y) => x - y);
    await db.execute(sql`
      INSERT INTO ops_request_metrics (minute, route, requests, errors_5xx, errors_4xx, p50_ms, p95_ms, max_ms)
      VALUES (${minute}, ${route}, ${b.requests}, ${b.e5}, ${b.e4}, ${Math.round(pct(s, 0.5))}, ${Math.round(pct(s, 0.95))}, ${Math.round(s[s.length - 1] ?? 0)})
      ON CONFLICT (minute, route) DO UPDATE SET
        requests = ops_request_metrics.requests + excluded.requests,
        errors_5xx = ops_request_metrics.errors_5xx + excluded.errors_5xx,
        errors_4xx = ops_request_metrics.errors_4xx + excluded.errors_4xx,
        p50_ms = GREATEST(ops_request_metrics.p50_ms, excluded.p50_ms),
        p95_ms = GREATEST(ops_request_metrics.p95_ms, excluded.p95_ms),
        max_ms = GREATEST(ops_request_metrics.max_ms, excluded.max_ms)`);
    buckets.delete(`${minute}|${route}`);
  }
  return rows.length;
}

async function riskEngineOk(): Promise<boolean> {
  const base = process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8000";
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 3000);
  try {
    const r = await fetch(`${base}/health`, { signal: c.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function writeHeartbeat(): Promise<void> {
  let dbOk = false;
  let dbMs: number | null = null;
  const t0 = Date.now();
  try {
    await pool!.query("SELECT 1");
    dbOk = true;
    dbMs = Date.now() - t0;
  } catch { /* recorded as false */ }
  const engine = await riskEngineOk();
  let inpe: boolean | null = null;
  let sis: boolean | null = null;
  if (dbOk) {
    inpe = (await inpeFreshness().catch(() => ({ fresh: false }))).fresh;
    const r = await db.execute<{ ok: boolean }>(sql`
      SELECT coalesce(max(r.finished_at) > now() - interval '26 hours', false) AS ok
      FROM source_sync_runs r JOIN data_sources s ON s.id = r.source_id
      WHERE s.key = 'sisfogo-roi' AND r.status = 'sucesso'`).catch(() => null);
    sis = r?.rows[0]?.ok ?? null;
    await db.insert(opsHeartbeats).values({ instance: INSTANCE, dbOk, dbMs, riskEngineOk: engine, inpeFresh: inpe, sisfogoFresh: sis });
  }
  // Without the database nothing can be stored: the missing minute is itself the evidence.
}

let timers: NodeJS.Timeout[] = [];
export function startTelemetry() {
  if (process.env.NODE_ENV === "test" || process.env.OPS_TELEMETRY_ENABLED === "false") return false;
  const log = (e: unknown) => console.error(JSON.stringify({ level: "warn", source: "telemetry", err: e instanceof Error ? e.message : String(e) }));
  timers = [
    setInterval(() => { writeHeartbeat().catch(log); }, 60_000),
    setInterval(() => { flushRequestMetrics().catch(log); }, 60_000),
  ];
  timers.forEach((t) => t.unref());
  writeHeartbeat().catch(log);
  return true;
}
export async function stopTelemetry() {
  timers.forEach(clearInterval);
  timers = [];
  await flushRequestMetrics(true).catch(() => {});
}
