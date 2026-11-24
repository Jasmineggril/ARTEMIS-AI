/**
 * Official INPE fire risk (model 2.2) end to end against a REAL PostgreSQL (own database, suffix "_rf").
 * The observed NetCDF4 is CONTROLLED (written with h5wasm in INPE's layout: lat/lon 0.01° south→north,
 * rf[1, lat, lon], fill −999, title "Risco de fogo para o dia AAAAMMDD"); the downloader is injected.
 * Covers: sampling over the property polygon checked against an independent mean, idempotency by
 * sha256, 404 / non-NetCDF / wrong-day failures recorded in the sync log, public grid/point
 * endpoints, organisation isolation, and the persistent-risk alert rule (R1) with deduplication and
 * wording that never claims a hotspot or a confirmed fire.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import h5wasm from "h5wasm/node";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE || !/test/i.test(new URL(BASE).pathname)) { console.error("TEST_DATABASE_URL ausente ou sem 'test'."); process.exit(1); }
const DB_NAME = `${new URL(BASE).pathname.slice(1)}_rf`;
const withDb = (u: string, n: string) => { const x = new URL(u); x.pathname = `/${n}`; return x.toString(); };
const DB_URL = withDb(BASE, DB_NAME);
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_DISABLED = "true";
process.env.PYTHON_SERVICE_URL = "http://127.0.0.1:9";
process.env.INPE_RISK_SYNC_ENABLED = "false";

// controlled grid: lat −16.00…−15.50, lon −48.20…−47.70 (51×51 pixels of 0.01°)
const LAT0 = -16.0, LON0 = -48.2, N = 51;
/** value for pixel (y, x) on a given day; a 3×3 "urban" block inside the property is −999 */
const pix = (y: number, x: number, base: number) => (y >= 20 && y < 23 && x >= 30 && x < 33 ? -999 : Math.round((base + 0.001 * (x - 25)) * 1e6) / 1e6);
async function observedNc(day: string, base: number) {
  await h5wasm.ready;
  const p = path.join(mkdtempSync(path.join(os.tmpdir(), "rf-fixture-")), "rf.nc");
  const f = new h5wasm.File(p, "w");
  f.create_dataset({ name: "lat", data: Float64Array.from({ length: N }, (_, i) => LAT0 + i * 0.01) });
  f.create_dataset({ name: "lon", data: Float64Array.from({ length: N }, (_, i) => LON0 + i * 0.01) });
  const v = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) v[y * N + x] = pix(y, x, base);
  f.create_dataset({ name: "rf", data: v, shape: [1, N, N], dtype: "<f" });
  f.create_attribute("title", `Risco de fogo para o dia ${day.replace(/-/g, "")}`);
  f.close();
  return readFileSync(p);
}
const fast = { timeoutMs: 1000, attempts: 2, baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} };

let base = "", close: () => Promise<void>, c: pg.Client;
const q = async (s: string, p: unknown[] = []) => (await c.query(s, p)).rows;
class Client {
  cookie = "";
  async req(method: string, p: string, body?: unknown) {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = r.headers.get("set-cookie"); if (set) this.cookie = set.split(";")[0];
    const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  }
}
const owner = new Client(), other = new Client(), anon = new Client();
let areaId = 0;
// property: lon −47.95…−47.90, lat −15.82…−15.77 → pixels x 25..30, y 18..23 (centres inside)
const BOX = { minLng: -47.955, maxLng: -47.895, minLat: -15.825, maxLat: -15.775 }; // edges between pixel centres (no ties)

before(async () => {
  const a = new pg.Client({ connectionString: withDb(BASE!, "postgres") });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); await a.query(`CREATE DATABASE "${DB_NAME}"`); await a.end();
  const origLog = console.log, origWarn = console.warn;
  console.log = (...x: unknown[]) => { if (process.env.TEST_VERBOSE) origLog(...x); };
  console.warn = (...x: unknown[]) => { if (process.env.TEST_VERBOSE) origWarn(...x); };
  const { runMigrations } = await import("../../server/migrate"); await runMigrations();
  const { createApp } = await import("../../server/app"); const { httpServer } = await createApp();
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  c = new pg.Client({ connectionString: DB_URL }); await c.connect();
  const { pool } = await import("../../server/db");
  close = async () => { await c.end(); await new Promise((r) => httpServer.close(() => r(null))); await pool?.end(); console.log = origLog; console.warn = origWarn; };
  for (const [cl, email] of [[owner, "dona@rf.test"], [other, "outra@rf.test"]] as const) {
    assert.equal((await cl.req("POST", "/api/auth/signup", { name: "Pessoa", email, password: "senhaForte1", organizationName: `Org ${email}`, organizationType: "produtor", acceptPrivacy: true })).status, 201);
  }
  const { minLng: x0, maxLng: x1, minLat: y0, maxLat: y1 } = BOX;
  const r = await owner.req("POST", "/api/areas", { name: "Fazenda RF", operationType: "propriedade_rural", municipality: "Brasília", state: "DF",
    boundary: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } });
  assert.equal(r.status, 201, JSON.stringify(r.body)); areaId = r.body.id;
});
after(async () => { await close?.(); });

const DAYS = ["2026-09-18", "2026-09-19", "2026-09-20"], BASES = [0.8, 0.85, 0.9];
const files = new Map<string, Buffer>();
const fetchBin = async (url: string) => {
  const b = files.get(url);
  return b ? { status: 200, body: b, lastModified: null } : { status: 404, body: Buffer.alloc(0), lastModified: null };
};

test("observed NetCDF: property value = independent mean of valid pixel centres inside the polygon", async () => {
  const { observedUrl } = await import("../../server/connectors/inpe-fire-risk");
  const { syncObserved } = await import("../../server/services/inpe-fire-risk-sync");
  for (let i = 0; i < 3; i++) files.set(observedUrl(DAYS[i]), await observedNc(DAYS[i], BASES[i]));
  const r = await syncObserved(DAYS, { fetchBin, retry: fast, trigger: "teste" });
  assert.deepEqual(r.map((x) => x.status), ["sucesso", "sucesso", "sucesso"], JSON.stringify(r));

  // independent: pixel centres strictly inside the box, excluding −999
  const vals: number[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const lat = LAT0 + y * 0.01, lng = LON0 + x * 0.01;
    if (lat > BOX.minLat && lat < BOX.maxLat && lng > BOX.minLng && lng < BOX.maxLng) { const v = pix(y, x, 0.9); if (v !== -999) vals.push(v); }
  }
  const exp = vals.reduce((s, v) => s + v, 0) / vals.length;
  const [row] = await q(`SELECT value_mean, value_max, risk_class, pixels_valid, pixels_total, method, source_sha256 FROM fire_risk_values
    WHERE index_key = 'inpe_rf_oficial' AND product = 'observado' AND target_type = 'area' AND target_id = $1 AND valid_day = '2026-09-20'`, [areaId]);
  assert.ok(Math.abs(row.value_mean - exp) < 1e-4, `mean ${row.value_mean} × ${exp}`);
  assert.equal(row.pixels_valid, vals.length);
  assert.ok(row.pixels_total > row.pixels_valid, "urban pixels counted as total but not as valid");
  assert.equal(row.risk_class, "alto");
  assert.equal(row.source_sha256.length, 64);
  const runs = await q(`SELECT r.status, r.params->>'validDay' AS d FROM source_sync_runs r JOIN data_sources s ON s.id = r.source_id WHERE s.key = 'inpe-risco-fogo' ORDER BY r.id`);
  assert.deepEqual(runs.map((x) => x.status), ["sucesso", "sucesso", "sucesso"]);
});

test("same file is not reprocessed; 404, non-NetCDF and wrong-day files are recorded as failures", async () => {
  const { observedUrl } = await import("../../server/connectors/inpe-fire-risk");
  const { syncObserved } = await import("../../server/services/inpe-fire-risk-sync");
  const again = await syncObserved([DAYS[2]], { fetchBin, retry: fast });
  assert.equal(again[0].status, "sem_alteracao");
  files.set(observedUrl("2026-09-22"), Buffer.from("<html>erro</html>"));
  files.set(observedUrl("2026-09-23"), await observedNc("2026-09-01", 0.5));
  const bad = await syncObserved(["2026-09-21", "2026-09-22", "2026-09-23"], { fetchBin, retry: fast });
  assert.deepEqual(bad.map((x) => x.status), ["falha", "falha", "falha"]);
  assert.match(bad[0].error!, /ainda não publicado/);
  assert.match(bad[1].error!, /não é NetCDF4/);
  assert.match(bad[2].error!, /esperado 2026-09-23/);
  const [n] = await q(`SELECT count(*)::int AS n FROM fire_risk_values WHERE valid_day IN ('2026-09-21','2026-09-22','2026-09-23')`);
  assert.equal(n.n, 0, "no value stored from a failed file");
});

test("public grid and point endpoints; area series is organisation-scoped", async () => {
  const av = await anon.req("GET", "/api/fire-risk/available");
  assert.equal(av.status, 200);
  assert.deepEqual(av.body.layers.find((l: any) => l.index === "inpe_rf_oficial" && l.product === "observado").days, [...DAYS].reverse());
  assert.match(av.body.method.notThis, /não é incêndio confirmado/);
  const g = await anon.req("GET", "/api/fire-risk/grid?day=2026-09-19");
  assert.equal(g.status, 200); assert.equal(g.body.validDay, "2026-09-19"); assert.equal(g.body.cellDeg, 0.2);
  assert.equal((await anon.req("GET", "/api/fire-risk/grid?day=2020-01-01")).status, 404);
  assert.equal((await anon.req("GET", "/api/fire-risk/grid?day=ontem")).status, 400);
  const p = await anon.req("GET", "/api/fire-risk/point?lat=-15.8&lng=-47.92");
  assert.equal(p.status, 200);
  const obs = p.body.values.find((v: any) => v.index === "inpe_rf_oficial" && v.product === "observado");
  assert.equal(obs.validDay, "2026-09-20"); assert.ok(obs.mean > 0.85 && obs.mean < 0.95, String(obs.mean));
  assert.equal((await anon.req("GET", "/api/fire-risk/point?lat=40&lng=10")).status, 400);

  const s = await owner.req("GET", `/api/areas/${areaId}/fire-risk?from=2026-09-01&to=2026-09-30`);
  assert.equal(s.status, 200); assert.deepEqual(s.body.series.map((x: any) => x.day), DAYS);
  assert.equal((await other.req("GET", `/api/areas/${areaId}/fire-risk`)).status, 404);
  assert.equal((await anon.req("GET", `/api/areas/${areaId}/fire-risk`)).status, 401);
  assert.equal((await other.req("GET", `/api/areas/${areaId}/haines`)).status, 404);
});

test("R1: 3 days above 0.70 → one 'risco_oficial' alert, worded as a condition; rerun does not duplicate", async () => {
  const { evaluateRiskAlerts } = await import("../../server/services/fire-risk-alerts");
  const r1 = await evaluateRiskAlerts();
  assert.equal(r1.created, 1);
  const [a] = await q(`SELECT id, kind, severity, reason, data_source FROM alerts WHERE area_id = $1`, [areaId]);
  assert.equal(a.kind, "risco_oficial"); assert.equal(a.severity, "alto");
  assert.match(a.reason, /não indica foco de calor nem incêndio confirmado/);
  assert.doesNotMatch(a.reason, /%/, "no percentage presented as probability");
  const r2 = await evaluateRiskAlerts();
  assert.equal(r2.created, 0);
  const [n] = await q(`SELECT count(*)::int AS n FROM alerts WHERE area_id = $1`, [areaId]);
  assert.equal(n.n, 1);
  const [d] = await q(`SELECT count(*)::int AS n FROM notification_deliveries WHERE alert_id = $1`, [a.id]);
  assert.equal(d.n, 1, "owner notified once by default preferences");
  assert.equal((await other.req("GET", "/api/alerts")).body.some?.((x: any) => x.id === a.id) ?? false, false);
});

test("point query: a cell without valid pixels and a point outside the grid return null, not another cell's value", async () => {
  // −15.0, −47.0 is inside Brazil's coarse grid but outside the controlled raster → cell has no pixels
  const p = await anon.req("GET", "/api/fire-risk/point?lat=-15.0&lng=-40.0");
  assert.equal(p.status, 200);
  for (const v of p.body.values) assert.equal(v.mean, null, JSON.stringify(v));
});
