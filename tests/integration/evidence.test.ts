/**
 * Operational evidence against a REAL PostgreSQL database: telemetry,
 * availability, alert verdicts, feedback, SUS, retrospective validation and
 * the evidence export. Own database (suffix "_evidence"), recreated each run.
 * Rows inserted here are TEST rows in a test database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import pg from "pg";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE || !/test/i.test(new URL(BASE).pathname)) { console.error("TEST_DATABASE_URL ausente ou sem 'test'."); process.exit(1); }
const DB_NAME = `${new URL(BASE).pathname.slice(1)}_evidence`;
const DB_URL = (() => { const x = new URL(BASE); x.pathname = `/${DB_NAME}`; return x.toString(); })();
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_DISABLED = "true";
process.env.PYTHON_SERVICE_URL = "http://127.0.0.1:9";

let base = "";
let close: () => Promise<void>;
let c: pg.Client;
const q = async (s: string, p: unknown[] = []) => (await c.query(s, p)).rows;
class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie"); if (set) this.cookie = set.split(";")[0];
    const t = await res.text(); let j: any = null; try { j = JSON.parse(t); } catch { j = t; }
    return { status: res.status, body: j, headers: res.headers };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
}
const owner = new Client(), admin = new Client(), anon = new Client();
let orgId = 0, areaId = 0;

before(async () => {
  const a = new pg.Client({ connectionString: (() => { const x = new URL(BASE!); x.pathname = "/postgres"; return x.toString(); })() });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); await a.query(`CREATE DATABASE "${DB_NAME}"`); await a.end();
  const origLog = console.log; console.log = (...x: unknown[]) => { if (process.env.TEST_VERBOSE) origLog(...x); };
  const { runMigrations } = await import("../../server/migrate"); await runMigrations();
  const { createApp } = await import("../../server/app"); const { httpServer } = await createApp();
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  c = new pg.Client({ connectionString: DB_URL }); await c.connect();
  const { pool } = await import("../../server/db");
  close = async () => { await c.end(); await new Promise((r) => httpServer.close(() => r(null))); await pool?.end(); console.log = origLog; };
  for (const [cl, email] of [[owner, "dona@test.dev"], [admin, "admin@test.dev"]] as const) {
    assert.equal((await cl.post("/api/auth/signup", { name: "Pessoa", email, password: "senhaForte1", organizationName: `Org ${email}`, organizationType: "produtor", acceptPrivacy: true })).status, 201);
  }
  await q(`UPDATE users SET role = 'platform_admin' WHERE email = 'admin@test.dev'`);
  orgId = (await owner.get("/api/auth/status")).body.organization.id;
  const d = 0.009;
  const r = await owner.post("/api/areas", { name: "Fazenda Evidência", operationType: "propriedade_rural", municipality: "Alto Paraíso de Goiás", state: "GO",
    boundary: { type: "Polygon", coordinates: [[[-47.51, -14.13], [-47.51 + d, -14.13], [-47.51 + d, -14.13 + d], [-47.51, -14.13 + d], [-47.51, -14.13]]] } });
  areaId = r.body.id;
});
after(async () => close?.());

test("request metrics: per-minute route groups without ids, p95 and errors are stored", async () => {
  const { recordRequest, flushRequestMetrics, routeGroup } = await import("../../server/services/ops-telemetry");
  assert.equal(routeGroup("/api/areas/123/surroundings"), "/api/areas/:id/surroundings");
  assert.equal(routeGroup("/api/admin/users/00000000-0000-4000-8000-000000000001/access-link"), "/api/admin/users/:id/access-link");
  assert.equal(routeGroup("/assets/index-abc.js"), "static:assets");
  const t = Date.now() - 120_000;
  for (let i = 1; i <= 100; i++) recordRequest("/api/areas/7", i === 100 ? 500 : i > 95 ? 404 : 200, i, t);
  await flushRequestMetrics();
  const [m] = await q(`SELECT * FROM ops_request_metrics WHERE route = '/api/areas/:id'`);
  assert.deepEqual([m.requests, m.errors_5xx, m.errors_4xx, m.p50_ms, m.p95_ms, m.max_ms], [100, 1, 4, 50, 95, 100]);
});

test("heartbeat writes the real state; availability counts missing minutes as downtime", async () => {
  const { writeHeartbeat } = await import("../../server/services/ops-telemetry");
  await writeHeartbeat();
  const [h] = await q(`SELECT * FROM ops_heartbeats ORDER BY id DESC LIMIT 1`);
  assert.equal(h.db_ok, true);
  assert.equal(h.risk_engine_ok, false, "engine at a closed port is reported down, not assumed up");
  await q(`DELETE FROM ops_heartbeats`);
  // 60 minutes window: 50 healthy minutes, 10 missing (outage)
  for (let i = 60; i > 10; i--) await q(`INSERT INTO ops_heartbeats (at, instance, db_ok, risk_engine_ok) VALUES (now() - make_interval(mins => $1), 't', true, true)`, [i]);
  const r = await admin.get("/api/admin/operations?days=1");
  assert.equal(r.status, 200);
  assert.equal(r.body.availability.minutesWithHeartbeat, 50);
  assert.ok(r.body.availability.expectedMinutes >= 60);
  assert.ok(r.body.availability.availabilityPct < 84, `${r.body.availability.availabilityPct}`);
  assert.equal(r.body.availability.gaps.length, 1, "the 10-minute hole is listed as an interruption");
  assert.ok(r.body.availability.gaps[0].minutes >= 10);
});

test("expert verdict on an alert: rules, history, organisation scope", async () => {
  const [{ id: alertId }] = await q(`INSERT INTO alerts (organization_id, area_id, title, message, severity, status, kind) VALUES ($1, $2, 'teste', 'teste', 'alto', 'novo', 'risco') RETURNING id`, [orgId, areaId]);
  assert.equal((await owner.post(`/api/alerts/${alertId}/evaluation`, { evaluation: "nao_pertinente" })).status, 400, "justification required");
  const ok = await owner.post(`/api/alerts/${alertId}/evaluation`, { evaluation: "pertinente", note: "Confirmado em campo." });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.evaluation, "pertinente");
  const [ev] = await q(`SELECT note FROM alert_events WHERE alert_id = $1 ORDER BY id DESC LIMIT 1`, [alertId]);
  assert.match(ev.note, /Avaliação do alerta: pertinente — Confirmado em campo/);
  assert.equal((await admin.post(`/api/alerts/${alertId}/evaluation`, { evaluation: "pertinente" })).status, 404, "other organisation");
});

test("feedback and SUS: stored with the person and organisation; SUS score computed per Brooke", async () => {
  const { susScore } = await import("../../server/evidence-routes");
  assert.equal(susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), 50);
  assert.equal(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100);
  assert.equal(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]), 0);
  assert.equal((await anon.post("/api/feedback", { page: "/x", category: "problema", message: "teste" })).status, 401);
  const f = await owner.post("/api/feedback", { page: "/areas?x=1", category: "problema", rating: 2, message: "O mapa demorou a carregar." });
  assert.equal(f.status, 201);
  assert.equal((await q(`SELECT page, organization_id FROM user_feedback WHERE id = $1`, [f.body.id]))[0].page, "/areas", "query string dropped");
  const s = await owner.post("/api/sus", { answers: [4, 2, 4, 2, 4, 2, 4, 2, 4, 2] });
  assert.equal(s.status, 201);
  assert.equal(s.body.score, 75);
  assert.equal((await owner.post("/api/sus", { answers: [4, 2, 4] })).status, 400);
  assert.equal((await owner.get("/api/admin/feedback")).status, 403);
  const list = await admin.get("/api/admin/feedback");
  assert.equal(list.body[0].message, "O mapa demorou a carregar.");
  assert.equal((await admin.patch(`/api/admin/feedback/${f.body.id}`, { status: "resolvido", response: "Corrigido." })).body.status, "resolvido");
});

test("retrospective validation: later hotspot counted for the analysis level; persistence cases separated", async () => {
  const [{ id: src }] = await q(`SELECT id FROM data_sources WHERE key = 'inpe-queimadas'`);
  // two closed-window analyses (10 days ago): one 'alto' without nearby hotspot, one 'crítico' with hotspot nearby
  await q(`INSERT INTO risk_analyses (organization_id, area_id, score, level, input_data, is_simulated, created_at) VALUES
    ($1, $2, 70, 'alto', '{"nearbyHotspot": false}', false, now() - interval '10 days'),
    ($1, $2, 90, 'crítico', '{"nearbyHotspot": true}', false, now() - interval '10 days'),
    ($1, $2, 20, 'baixo', '{"nearbyHotspot": false}', false, now() - interval '10 days')`, [orgId, areaId]);
  // a hotspot inside the property 2 days after the analyses; one 30 km away (outside the radius)
  await q(`INSERT INTO satellite_hotspots (source_id, external_id, satellite, detected_at, latitude, longitude) VALUES
    ($1, 'ev-1', 'NOAA-20', now() - interval '8 days', -14.126, -47.506), ($1, 'ev-2', 'NOAA-20', now() - interval '8 days', -14.126, -47.20)`, [src]);
  const { evaluateOutcomes } = await import("../../server/services/outcome-validation");
  const r = await evaluateOutcomes({ from: new Date(Date.now() - 30 * 86_400_000), to: new Date(), windowDays: 7, radiusKm: 10 });
  const lvl = (rows: any[], l: string) => rows.find((x) => x.level === l);
  assert.deepEqual([lvl(r.analyses.byLevel, "alto").n, lvl(r.analyses.byLevel, "alto").withHotspot], [1, 1]);
  assert.deepEqual([lvl(r.analyses.byLevel, "crítico").n, lvl(r.analyses.withoutNearbyHotspotAtAnalysis, "crítico").n], [1, 0], "persistence case excluded from the clean table");
  assert.equal(lvl(r.analyses.byLevel, "baixo").hotspotRatePct, 100, "the same hotspot follows every analysis of this property");
  assert.ok(r.limits.some((l: string) => /não é uma acurácia calibrada/i.test(l)));
  assert.equal(r.alerts.evaluated, 1);
  assert.equal(r.alerts.pertinentPct, 100);
});

test("operations report and evidence export: platform admin only, dated, audited", async () => {
  assert.equal((await owner.get("/api/admin/operations")).status, 403);
  assert.equal((await admin.get("/api/admin/operations?days=999")).status, 400);
  const e = await admin.get("/api/admin/evidence.json?days=30");
  assert.equal(e.status, 200);
  assert.match(e.headers.get("content-disposition") ?? "", /artemis-evidencias-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.json/);
  assert.equal(e.body.system, "ARTEMIS AI");
  assert.ok(e.body.usage.analyses >= 3);
  assert.equal(e.body.sus.n, 1);
  assert.equal(e.body.sus.mean, 75);
  assert.equal(e.body.feedback.total, 1);
  assert.ok((await q(`SELECT 1 FROM audit_logs WHERE action = 'evidence.exported'`)).length === 1);
});

test("analysis stores the time the person took (Proof of Value: analysis time)", async () => {
  const r = await owner.post(`/api/areas/${areaId}/analyses`, {
    clientDurationMs: 95_000,
    inputs: { temperature: 30, humidity: 40, windSpeed: 10, recentRainfall: 0, vegetationCondition: "dry", nearbyHotspot: false },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await q(`SELECT client_duration_ms FROM risk_analyses WHERE id = $1`, [r.body.id]))[0].client_duration_ms, 95_000);
  const o = await admin.get("/api/admin/operations?days=1");
  assert.equal(o.body.usage.medianAnalysisMs, 95_000);
});
