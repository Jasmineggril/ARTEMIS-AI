/**
 * INMET pipeline against a REAL PostgreSQL (own database, suffix "_inmet").
 * The yearly archive is built in memory with one UNMODIFIED excerpt of INMET's
 * official file (A001 Brasília, 15–16/09/2026) and one CONTROLLED station file
 * with known values; the downloader is injected (no network).
 * Covers: ingest, daily aggregates checked against an independent computation,
 * identical archive skipped, changed archive (update + insert only), resume of
 * an interrupted run, connection failure / 404 / non-ZIP, property linkage with
 * distance and representativeness, organisation isolation, public endpoints,
 * and the risk engine using a fresh observation (and not using a stale one).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import JSZip from "jszip";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE || !/test/i.test(new URL(BASE).pathname)) { console.error("TEST_DATABASE_URL ausente ou sem 'test'."); process.exit(1); }
const DB_NAME = `${new URL(BASE).pathname.slice(1)}_inmet`;
const withDb = (u: string, n: string) => { const x = new URL(u); x.pathname = `/${n}`; return x.toString(); };
const DB_URL = withDb(BASE, DB_NAME);
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_DISABLED = "true";
process.env.PYTHON_SERVICE_URL = "http://127.0.0.1:9";
process.env.INMET_RAW_DIR = mkdtempSync(path.join(os.tmpdir(), "inmet-raw-"));
const SU = process.env.TEST_SUPERUSER_URL;

const REAL = readFileSync(new URL("../fixtures/inmet_A001_amostra.csv", import.meta.url));
const HEAD9 = REAL.toString("latin1").split(/\r?\n/).slice(0, 9);
/** Controlled station A777 (MT → UTC-4) with 26 hours of known values. */
function controlled(changes: { tempAt5?: string; extraHour?: boolean } = {}) {
  const head = HEAD9.map((l) => l.replace("CO", "CO").replace("DF", "MT").replace("BRASILIA", "ESTACAO TESTE").replace("A001", "A777")
    .replace("-15,78944444", "-15,50000000").replace("-47,92583332", "-56,00000000").replace("1160,96", "180"));
  const rows: string[] = [];
  for (let h = 0; h < (changes.extraHour ? 27 : 26); h++) {
    const day = h < 24 ? "15" : "16", hh = String(h % 24).padStart(2, "0");
    const temp = h === 5 && changes.tempAt5 ? changes.tempAt5 : String(20 + h).replace(".", ",");
    const rh = h === 17 ? "22" : "40";       // 17 UTC = 13 h local in MT (UTC-4)
    const rain = h === 10 ? "1,5" : "0";
    rows.push(["2026/09/" + day, `${hh}00 UTC`, rain, "990", "990", "989", "", temp, "10", temp, temp, "11", "9", "50", rh, rh, "90", "6", "2", ""].join(";"));
  }
  return Buffer.from([...head, ...rows].join("\r\n") + "\r\n", "latin1");
}
async function archive(ctrl = controlled()) {
  const z = new JSZip();
  z.file("INMET_CO_DF_A001_BRASILIA_01-01-2026_A_31-10-2026.CSV", REAL);
  z.file("INMET_CO_MT_A777_TESTE_01-01-2026_A_31-10-2026.CSV", ctrl);
  return z.generateAsync({ type: "nodebuffer" });
}
const fast = { timeoutMs: 1000, attempts: 2, baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} };
const serve = (buf: Buffer) => async () => ({ status: 200, headers: { "last-modified": "Thu, 05 Nov 2026 12:58:43 GMT" }, body: buf });

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

before(async () => {
  const a = new pg.Client({ connectionString: withDb(BASE!, "postgres") });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); await a.query(`CREATE DATABASE "${DB_NAME}"`); await a.end();
  if (SU) { const s = new pg.Client({ connectionString: withDb(SU, DB_NAME) }); await s.connect(); await s.query("CREATE EXTENSION IF NOT EXISTS postgis"); await s.end(); }
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
  for (const [cl, email] of [[owner, "dona@inmet.test"], [other, "outra@inmet.test"]] as const) {
    assert.equal((await cl.req("POST", "/api/auth/signup", { name: "Pessoa", email, password: "senhaForte1", organizationName: `Org ${email}`, organizationType: "produtor", acceptPrivacy: true })).status, 201);
  }
  // property ~5 km east of station A001 (Brasília)
  const lng = -47.88, lat = -15.79, d = 0.01;
  const r = await owner.req("POST", "/api/areas", { name: "Chácara perto do INMET", operationType: "propriedade_rural", municipality: "Brasília", state: "DF",
    boundary: { type: "Polygon", coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] } });
  assert.equal(r.status, 201, JSON.stringify(r.body)); areaId = r.body.id;
});
after(async () => { await close?.(); });

test("yearly archive: ingested with raw traceability; daily aggregates match an independent computation", async () => {
  const { syncInmetYear } = await import("../../server/services/inmet-sync");
  const r = await syncInmetYear(2026, { fetchBin: serve(await archive()), retry: fast });
  assert.equal(r.status, "sucesso", r.error);
  assert.deepEqual([r.files, r.filesFailed, r.read, r.inserted, r.updated, r.stationsNew], [2, 0, 56, 56, 0, 2]);
  const [o] = await q(`SELECT raw_file_name, raw_line, raw_file_sha256, quality_flags FROM weather_station_observations o JOIN weather_stations s ON s.id = o.station_id WHERE s.code = 'A001' AND observed_at = '2026-09-15T00:00:00Z'`);
  assert.equal(o.raw_line, 10); assert.match(o.raw_file_name, /A001_BRASILIA/); assert.equal(o.raw_file_sha256.length, 64);

  // independent computation from the raw real file: local day 15/09 (UTC-3) = 03 UTC 15/09 … 02 UTC 16/09
  const lines = REAL.toString("latin1").split(/\r?\n/).slice(9).filter(Boolean).map((l) => l.split(";"));
  const n = (v: string) => (v === "" ? null : Number(v.replace(",", ".")));
  const day = lines.filter((c) => { const t = Date.UTC(2026, 8, +c[0].slice(8, 10), +c[1].slice(0, 2)); return t >= Date.UTC(2026, 8, 15, 3) && t < Date.UTC(2026, 8, 16, 3); });
  const exp = {
    hours: day.length, tmax: Math.max(...day.map((c) => Math.max(n(c[9])!, n(c[7])!))), tmin: Math.min(...day.map((c) => Math.min(n(c[10])!, n(c[7])!))),
    rhmin: Math.min(...day.map((c) => Math.min(n(c[14])!, n(c[15])!))), rain: day.reduce((s, c) => s + n(c[2])!, 0),
    rh13: n(day.find((c) => c[1].startsWith("16"))![15]),
  };
  const [g] = await q(`SELECT d.* FROM weather_station_daily d JOIN weather_stations s ON s.id = d.station_id WHERE s.code = 'A001' AND d.day = '2026-09-15'`);
  assert.equal(g.hours_observed, 24); assert.equal(exp.hours, 24);
  assert.ok(Math.abs(g.temperature_max_c - exp.tmax) < 0.01, `tmax ${g.temperature_max_c} × ${exp.tmax}`);
  assert.ok(Math.abs(g.temperature_min_c - exp.tmin) < 0.01, `tmin ${g.temperature_min_c} × ${exp.tmin}`);
  assert.ok(Math.abs(g.humidity_min_pct - exp.rhmin) < 0.01);
  assert.ok(Math.abs(g.humidity_13h_pct - exp.rh13!) < 0.01, "13 h local = 16 UTC in DF");
  assert.ok(Math.abs(g.precipitation_mm - exp.rain) < 0.01);
  // controlled station in MT (UTC-4): local 15/09 = 04 UTC 15/09 … 03 UTC 16/09; the file has 00 UTC 15/09 … 01 UTC 16/09 → 22 h
  const [m] = await q(`SELECT d.* FROM weather_station_daily d JOIN weather_stations s ON s.id = d.station_id WHERE s.code = 'A777' AND d.day = '2026-09-15'`);
  assert.equal(m.hours_observed, 22, "04 UTC 15/09 .. 01 UTC 16/09");
  assert.equal(m.humidity_13h_pct, 22, "13 h local = 17 UTC in MT");
  assert.equal(m.precipitation_mm, 1.5);
  assert.equal(m.temperature_max_c, 45, "20 + 25 (01 UTC 16/09)");
});

test("identical archive is not reprocessed; a changed archive only updates/inserts what changed", async () => {
  const { syncInmetYear } = await import("../../server/services/inmet-sync");
  const same = await syncInmetYear(2026, { fetchBin: serve(await archive()), retry: fast });
  assert.equal(same.unchangedArchive, true);
  const changed = await syncInmetYear(2026, { fetchBin: serve(await archive(controlled({ tempAt5: "33,3", extraHour: true }))), retry: fast });
  assert.equal(changed.status, "sucesso");
  assert.deepEqual([changed.inserted, changed.updated, changed.unchanged], [1, 1, 55]);
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM weather_station_observations`);
  assert.equal(n, 57, "no duplicates");
  const forced = await syncInmetYear(2026, { fetchBin: serve(await archive(controlled({ tempAt5: "33,3", extraHour: true }))), retry: fast, force: true });
  assert.deepEqual([forced.inserted, forced.updated, forced.unchanged], [0, 0, 57], "forced reprocess is idempotent");
});

test("interrupted run with the same archive is resumed; failures are recorded, nothing invented", async () => {
  const { syncInmetYear } = await import("../../server/services/inmet-sync");
  const buf = await archive(controlled({ tempAt5: "34,4", extraHour: true }));
  const { sha256 } = await import("../../server/connectors/inmet");
  await q(`INSERT INTO source_sync_runs (source_id, status, params, progress) SELECT id, 'falha', $1, $2 FROM data_sources WHERE key = 'inmet-estacoes'`,
    [JSON.stringify({ kind: "ano", year: 2026, sha256: sha256(buf) }), JSON.stringify({ filesDone: ["INMET_CO_DF_A001_BRASILIA_01-01-2026_A_31-10-2026.CSV"] })]);
  const r = await syncInmetYear(2026, { fetchBin: serve(buf), retry: fast });
  assert.equal(r.resumedFrom, 1); assert.equal(r.read, 27, "only the station not yet done was read");
  assert.equal(r.updated, 1);

  const down = await syncInmetYear(2026, { fetchBin: async () => { throw new Error("ECONNREFUSED"); }, retry: fast });
  assert.equal(down.status, "falha"); assert.match(down.error!, /ECONNREFUSED \(após 2 tentativas\)/);
  const nf = await syncInmetYear(2025, { fetchBin: async () => ({ status: 404, headers: {}, body: Buffer.alloc(0) }), retry: fast });
  assert.match(nf.error!, /não publicado/);
  const html = await syncInmetYear(2026, { fetchBin: async () => ({ status: 200, headers: {}, body: Buffer.from("<html>manutenção</html>".repeat(100)) }), retry: fast });
  assert.match(html.error!, /não é um arquivo ZIP/);
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM weather_station_observations`);
  assert.equal(n, 57, "failed runs wrote nothing");
});

test("property linkage: distance to the boundary, representativeness, isolation; public endpoints validate input", async () => {
  const r = await owner.req("GET", `/api/areas/${areaId}/weather-stations`);
  assert.equal(r.status, 200);
  const a001 = r.body.stations.find((s: any) => s.code === "A001");
  assert.ok(a001.distanceKm > 3 && a001.distanceKm < 6, `distância ${a001.distanceKm}`);
  assert.equal(a001.representativeness, "proxima");
  assert.equal(a001.method, SU ? "postgis" : "haversine");
  const far = r.body.stations.find((s: any) => s.code === "A777");
  assert.ok(!far, "station ~860 km away is beyond the 150 km search radius");
  assert.equal((await other.req("GET", `/api/areas/${areaId}/weather-stations`)).status, 404);
  const h = await owner.req("GET", `/api/areas/${areaId}/weather-history?from=2026-09-01&to=2026-09-30`);
  assert.equal(h.body.station.code, "A001"); assert.ok(h.body.days.length >= 1); assert.ok(h.body.fma.days.length === 30);
  assert.equal((await anon.req("GET", "/api/weather-stations/A001/daily?from=2026-09-30&to=2026-09-01")).status, 400);
  assert.equal((await anon.req("GET", "/api/weather-stations/A001/daily?from=2024-01-01&to=2026-09-01")).status, 400);
  assert.equal((await anon.req("GET", "/api/weather-stations/Z999/daily?from=2026-09-01&to=2026-09-30")).status, 404);
  assert.equal((await anon.req("GET", "/api/weather-stations/A001;DROP/daily?from=2026-09-01&to=2026-09-30")).status, 404);
  const st = await anon.req("GET", "/api/connectors/inmet/status");
  assert.equal(st.body.observations, "57"); assert.ok(!JSON.stringify(st.body).includes("inmet-raw-"), "raw file path not exposed");
});

test("risk engine: a fresh INMET observation is used and labelled; a stale one is not", async () => {
  // controlled fresh observations at A001 for the last 72 h
  await q(`INSERT INTO weather_station_observations (station_id, observed_at, temperature_c, humidity_pct, wind_speed_ms, precipitation_mm)
    SELECT s.id, date_trunc('hour', now()) - make_interval(hours => g), 31.5, 24, 5, 0.1 FROM weather_stations s, generate_series(1, 72) g WHERE s.code = 'A001'`);
  const a = await owner.req("POST", `/api/areas/${areaId}/analyses`, { inputs: { vegetationCondition: "dry", nearbyHotspot: false } });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const prov = a.body.dataQuality.provenance.filter((p: any) => p.origin === "inmet-estacao").map((p: any) => p.field).sort();
  assert.deepEqual(prov, ["humidity", "recentRainfall", "temperature", "windSpeed"]);
  assert.equal(a.body.inputData.windSpeed, 18, "5 m/s → 18 km/h");
  assert.equal(a.body.inputData.recentRainfall, 7.2, "72 × 0,1 mm");
  assert.ok(a.body.dataSources.some((s: any) => s.key === "inmet-estacoes" && /A001/.test(s.name)));
  assert.ok(a.body.limitations.some((l: string) => /Observação oficial do INMET da estação A001/.test(l)));
  const [src] = await q(`SELECT fields, detail FROM risk_analysis_sources WHERE analysis_id = $1 AND source_key = 'inmet-estacoes'`, [a.body.id]);
  assert.equal(src.detail.station.code, "A001");

  await q(`DELETE FROM weather_station_observations WHERE observed_at > now() - interval '4 days'`);
  const b = await owner.req("POST", `/api/areas/${areaId}/analyses`, { inputs: { vegetationCondition: "dry", nearbyHotspot: false, temperature: 30, humidity: 30, windSpeed: 10, recentRainfall: 0 } });
  assert.equal(b.status, 201);
  assert.ok(!b.body.dataQuality.provenance.some((p: any) => p.origin === "inmet-estacao"));
  assert.ok(b.body.limitations.some((l: string) => /INMET não utilizado: última observação disponível da estação A001/.test(l)));
});
