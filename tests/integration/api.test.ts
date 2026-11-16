/**
 * ARTEMIS AI — API integration tests against a REAL PostgreSQL database.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/artemis_test npm run test:integration
 *
 * The target database is WIPED (schema public dropped) at the start. Never
 * point TEST_DATABASE_URL at a database with data you want to keep.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import pg from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  console.error("TEST_DATABASE_URL não definido — testes de integração não executados.");
  process.exit(1);
}
if (!/test/i.test(new URL(TEST_DB).pathname)) {
  console.error("Por segurança, o nome do banco de testes deve conter 'test'.");
  process.exit(1);
}

process.env.DATABASE_URL = TEST_DB;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_DISABLED = "true";
process.env.RISK_ENGINE = "python";
// Default: closed port → exercises the TS fallback. Set TEST_PYTHON_URL to a
// running FastAPI service to exercise the real Node → Python path.
const WITH_PYTHON = Boolean(process.env.TEST_PYTHON_URL);
process.env.PYTHON_SERVICE_URL = process.env.TEST_PYTHON_URL ?? "http://127.0.0.1:9";

let base = "";
let close: () => Promise<void>;
const resetLinks: string[] = [];

class Client {
  cookie = "";
  constructor(public origin?: string) {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(this.origin ? { Origin: this.origin } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  put = (p: string, b: unknown) => this.req("PUT", p, b);
  del = (p: string) => this.req("DELETE", p);
}

const alice = new Client();
const bob = new Client();
const anon = new Client();

const AREA = {
  name: "Fazenda Piloto Teste",
  operationType: "propriedade_rural",
  municipality: "Alto Paraíso de Goiás",
  state: "GO",
  latitude: -14.13,
  longitude: -47.51,
  areaHectares: 1200,
  vegetationCategory: "Cerrado sentido restrito",
};
const CRITICAL_INPUTS = {
  temperature: 39, humidity: 15, windSpeed: 45, recentRainfall: 0,
  vegetationCondition: "very_dry", nearbyHotspot: true, hotspotDistance: 2, historicalOccurrences: 6,
};

let areaId = 0;
let alertId = 0;
let aliceOrgId = 0;

before(async () => {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();
  // Optional PostGIS path (extension created by a superuser, as in Docker init).
  if (process.env.TEST_SUPERUSER_URL) {
    const su = new pg.Client({ connectionString: (() => { const x = new URL(process.env.TEST_SUPERUSER_URL!); x.pathname = new URL(TEST_DB!).pathname; return x.toString(); })() });
    await su.connect();
    await su.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await su.end();
  }

  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    const s = args.map(String).join(" ");
    const m = s.match(/reset-password\?token=([A-Za-z0-9_-]+)/);
    if (m) resetLinks.push(m[1]);
    if (process.env.TEST_VERBOSE) origLog(...args);
  };

  const { runMigrations } = await import("../../server/migrate");
  await runMigrations();
  const { createApp } = await import("../../server/app");
  const { httpServer } = await createApp();
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const { pool } = await import("../../server/db");
  close = async () => {
    await new Promise((r) => httpServer.close(() => r(null)));
    await pool?.end();
    console.log = origLog;
  };
});

after(async () => close?.());

// ── Health & auth ────────────────────────────────────────────────────────────

test("health reports database ok and degraded engine without leaking data", async () => {
  const r = await anon.get("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.database, "ok");
  if (WITH_PYTHON) assert.equal(r.body.riskEngine, "ok");
  else assert.match(r.body.riskEngine, /fallback|unavailable/);
});

test("signup rejects weak password and missing privacy consent", async () => {
  let r = await anon.post("/api/auth/signup", { name: "X", email: "x@t.dev", password: "123", acceptPrivacy: true });
  assert.equal(r.status, 400);
  r = await anon.post("/api/auth/signup", { name: "Xavier", email: "x@t.dev", password: "senhaForte1" });
  assert.equal(r.status, 400);
});

test("signup creates user + organization (owner) and an authenticated session", async () => {
  const r = await alice.post("/api/auth/signup", {
    name: "Alice Analista", email: "alice@test.dev", password: "senhaForte1",
    organizationName: "Cooperativa Alfa", organizationType: "produtor", acceptPrivacy: true,
  });
  assert.equal(r.status, 201);
  const s = await alice.get("/api/auth/status");
  assert.equal(s.status, 200);
  assert.equal(s.body.organization.name, "Cooperativa Alfa");
  assert.equal(s.body.organization.role, "owner");
  aliceOrgId = s.body.organization.id;

  const b = await bob.post("/api/auth/signup", { name: "Bob Gestor", email: "bob@test.dev", password: "outraSenha2", acceptPrivacy: true });
  assert.equal(b.status, 201);
});

test("duplicate e-mail signup is refused", async () => {
  const r = await anon.post("/api/auth/signup", { name: "Alice 2", email: "ALICE@test.dev", password: "senhaForte1", acceptPrivacy: true });
  assert.equal(r.status, 409);
});

test("session cookie is HttpOnly and SameSite=Lax", async () => {
  const c = new Client();
  const r = await c.req("POST", "/api/auth/login", { email: "alice@test.dev", password: "senhaForte1" });
  assert.equal(r.status, 200);
  const sc = r.headers.get("set-cookie") ?? "";
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Lax/i);
});

test("login with wrong password returns 401 with generic message", async () => {
  const r = await anon.post("/api/auth/login", { email: "alice@test.dev", password: "errada123" });
  assert.equal(r.status, 401);
  assert.equal(r.body.message, "E-mail ou senha inválidos.");
});

test("auth status answers 200 null for anonymous visitors (no console noise)", async () => {
  const r = await anon.get("/api/auth/status");
  assert.equal(r.status, 200);
  assert.equal(r.body, null);
});

test("protected endpoints require authentication", async () => {
  for (const p of ["/api/areas", "/api/alerts", "/api/dashboard/summary", "/api/sensors", "/api/fire-occurrences", "/api/denuncias"]) {
    const r = await anon.get(p);
    assert.equal(r.status, 401, p);
  }
});

test("profile update cannot escalate role (strict schema)", async () => {
  const r = await alice.put("/api/user/profile", { firstName: "Alice", role: "platform_admin" });
  assert.equal(r.status, 400);
  const p = await alice.get("/api/user/profile");
  assert.equal(p.body.role, "user");
});

test("cross-origin state-changing request is blocked", async () => {
  const evil = new Client("https://evil.example");
  evil.cookie = alice.cookie;
  const r = await evil.post("/api/areas", AREA);
  assert.equal(r.status, 403);
});

// ── Areas ────────────────────────────────────────────────────────────────────

test("area validation: invalid UF, lonely coordinate and open polygon are rejected", async () => {
  assert.equal((await alice.post("/api/areas", { ...AREA, state: "XX" })).status, 400);
  assert.equal((await alice.post("/api/areas", { ...AREA, longitude: null })).status, 400);
  const open = { type: "Polygon", coordinates: [[[-47.5, -14.1], [-47.4, -14.1], [-47.4, -14.2], [-47.5, -14.25]]] };
  assert.equal((await alice.post("/api/areas", { ...AREA, boundary: open })).status, 400);
  assert.equal((await alice.post("/api/areas", { ...AREA, organizationId: 999 })).status, 400, "client org id must be refused");
});

test("organization can register an area with a valid polygon", async () => {
  const boundary = { type: "Polygon", coordinates: [[[-47.52, -14.12], [-47.50, -14.12], [-47.50, -14.14], [-47.52, -14.14], [-47.52, -14.12]]] };
  const r = await alice.post("/api/areas", { ...AREA, boundary });
  assert.equal(r.status, 201);
  assert.equal(r.body.organizationId, aliceOrgId);
  areaId = r.body.id;
  const list = await alice.get("/api/areas");
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].latestAnalysis, null);
});

// ── Risk analysis ────────────────────────────────────────────────────────────

test("analysis without meteorological data and without live source → 422, nothing invented", async () => {
  const r = await alice.post(`/api/areas/${areaId}/analyses`, { inputs: { vegetationCondition: "dry", nearbyHotspot: false } });
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.missing.sort(), ["precipitação 72 h", "temperatura", "umidade relativa", "velocidade do vento"].sort());
});

test("live weather failure is reported, not masked (integration recovery)", async () => {
  const r = await alice.post(`/api/areas/${areaId}/analyses`, { useLiveWeather: true, inputs: { vegetationCondition: "dry", nearbyHotspot: false } });
  // Either the connector is unreachable (sandbox) → 422 with connectorError, or reachable → 201 with provenance.
  if (r.status === 422) {
    assert.ok(r.body.connectorError, "connector error must be surfaced");
  } else {
    assert.equal(r.status, 201);
    assert.ok(r.body.dataSources.some((s: any) => s.key === "open-meteo"));
  }
});

test("critical analysis is executed, explained, stored and creates one alert", async () => {
  const r = await alice.post(`/api/areas/${areaId}/analyses`, { inputs: CRITICAL_INPUTS, notes: "teste" });
  assert.equal(r.status, 201);
  const a = r.body;
  assert.equal(a.level, "crítico");
  assert.ok(a.score >= 75 && a.score <= 100);
  assert.ok(a.factors.length >= 4, "factors explained");
  assert.ok(a.recommendations.length > 0);
  assert.equal(a.engineType, WITH_PYTHON ? "transparent-rule-engine" : "transparent-rule-engine-ts-fallback");
  assert.equal(a.confidence, null, "no uncalibrated confidence");
  assert.equal(a.isExperimental, false);
  assert.equal(a.limitations.some((l: string) => /fallback/i.test(l)), !WITH_PYTHON);
  assert.ok(a.limitations.some((l: string) => /não substitui/i.test(l)));
  assert.equal(a.dataQuality.provenance.find((p: any) => p.field === "temperature").origin, "manual");
  assert.ok(a.alert?.created);
  alertId = a.alert.id;

  const hist = await alice.get(`/api/areas/${areaId}/analyses`);
  assert.equal(hist.body.length, 1);
  const one = await alice.get(`/api/analyses/${a.id}`);
  assert.equal(one.body.score, a.score);
});

test("re-analysis at same level de-duplicates the open alert", async () => {
  const r = await alice.post(`/api/areas/${areaId}/analyses`, { inputs: CRITICAL_INPUTS });
  assert.equal(r.status, 201);
  assert.equal(r.body.alert.id, alertId);
  assert.equal(r.body.alert.created, false);
  const al = await alice.get(`/api/alerts/${alertId}`);
  assert.equal(al.body.occurrenceCount, 2);
  assert.equal(al.body.events.length, 2);
  const open = await alice.get("/api/alerts?status=abertos");
  assert.equal(open.body.length, 1);
});

test("low-risk analysis does not create an alert", async () => {
  const r = await alice.post(`/api/areas/${areaId}/analyses`, {
    inputs: { temperature: 22, humidity: 80, windSpeed: 5, recentRainfall: 40, vegetationCondition: "humid", nearbyHotspot: false },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.level, "baixo");
  assert.equal(r.body.alert, null);
});

// ── Alerts lifecycle ─────────────────────────────────────────────────────────

test("alert lifecycle transitions are enforced and recorded", async () => {
  let r = await alice.post(`/api/alerts/${alertId}/status`, { status: "reconhecido", note: "Equipe ciente", assignToMe: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "reconhecido");
  r = await alice.post(`/api/alerts/${alertId}/status`, { status: "novo" });
  assert.equal(r.status, 409);
  r = await alice.post(`/api/alerts/${alertId}/status`, { status: "descartado" });
  assert.equal(r.status, 400, "discard requires a reason");
  r = await alice.post(`/api/alerts/${alertId}/status`, { status: "resolvido", note: "Aceiros revisados" });
  assert.equal(r.status, 200);
  assert.equal(r.body.isResolved, true);
  const d = await alice.get(`/api/alerts/${alertId}`);
  assert.deepEqual(d.body.events.map((e: any) => e.toStatus), ["novo", "novo", "reconhecido", "resolvido"]);
  assert.equal(d.body.events[2].userName, "Alice Analista");
});

// ── Imports ──────────────────────────────────────────────────────────────────

test("import batch re-validates on server and never drops records silently", async () => {
  const records = [
    { occurrenceDate: "2025-08-10", municipality: "Alto Paraíso de Goiás", state: "go", latitude: -14.131, longitude: -47.512, validationStatus: "válido" },
    { occurrenceDate: "2025-08-11", municipality: "Alto Paraíso de Goiás", state: "GO", latitude: -14.14, longitude: -47.50, validationStatus: "válido com ressalvas" },
    { occurrenceDate: "2025-08-12", municipality: "X", state: "GO", latitude: 123, longitude: -47.5, validationStatus: "válido" },
    { occurrenceDate: "2025-08-10", municipality: "Alto Paraíso de Goiás", state: "GO", latitude: -14.131, longitude: -47.512, validationStatus: "duplicado" },
  ];
  const r = await alice.post("/api/import-batches", { filename: "ocorrencias.csv", sourceName: "Arquivo autorizado", records });
  assert.equal(r.status, 201);
  assert.equal(r.body.saved, 2);
  const rep = r.body.report;
  assert.equal(rep.totalRows, 4);
  assert.equal(rep.validRows + rep.warningRows + rep.invalidRows + rep.duplicateRows, 4);
  assert.equal(rep.invalidRows, 1);
  assert.equal(rep.rejectionReasons["latitude fora da faixa válida"], 1);

  const occ = await alice.get("/api/fire-occurrences?state=GO&from=2025-08-01&to=2025-08-31");
  assert.equal(occ.body.length, 2);
  const none = await alice.get("/api/fire-occurrences?from=2026-01-01");
  assert.equal(none.body.length, 0);
});

test("imported occurrences feed the historical factor of the next analysis", async () => {
  const { historicalOccurrences, ...rest } = CRITICAL_INPUTS;
  const r = await alice.post(`/api/areas/${areaId}/analyses`, { inputs: rest });
  assert.equal(r.status, 201);
  assert.equal(r.body.inputData.historicalOccurrences, 2);
  assert.ok(r.body.dataSources.some((s: any) => s.key === "fire_occurrences"));
});

// ── Isolation between organizations ──────────────────────────────────────────

test("organization isolation: Bob cannot read or change Alice's data", async () => {
  assert.equal((await bob.get("/api/areas")).body.length, 0);
  assert.equal((await bob.get(`/api/areas/${areaId}`)).status, 404);
  assert.equal((await bob.patch(`/api/areas/${areaId}`, { name: "hack" })).status, 404);
  assert.equal((await bob.del(`/api/areas/${areaId}`)).status, 404);
  assert.equal((await bob.post(`/api/areas/${areaId}/analyses`, { inputs: CRITICAL_INPUTS })).status, 404);
  assert.equal((await bob.get(`/api/areas/${areaId}/analyses`)).status, 404);
  assert.equal((await bob.get(`/api/alerts/${alertId}`)).status, 404);
  assert.equal((await bob.post(`/api/alerts/${alertId}/status`, { status: "descartado", note: "x" })).status, 404);
  assert.equal((await bob.get("/api/alerts")).body.length, 0);
  assert.equal((await bob.get("/api/fire-occurrences")).body.length, 0);
  assert.equal((await bob.get("/api/import-batches")).body.length, 0);
  assert.equal((await bob.get(`/api/reports/areas/${areaId}/analyses.csv`)).status, 404);
  const dash = await bob.get("/api/dashboard/summary");
  assert.equal(dash.body.areas.total, 0);
  assert.equal(dash.body.occurrences.total, 0);
  // cannot switch into an organization he does not belong to
  assert.equal((await bob.post("/api/auth/switch-organization", { organizationId: aliceOrgId })).status, 403);
});

test("roles: a viewer member can read but not create areas or change alerts", async () => {
  const add = await alice.post("/api/organization/members", { email: "bob@test.dev", role: "viewer" });
  assert.equal(add.status, 201);
  const sw = await bob.post("/api/auth/switch-organization", { organizationId: aliceOrgId });
  assert.equal(sw.status, 200);
  assert.equal((await bob.get("/api/areas")).body.length, 1);
  assert.equal((await bob.post("/api/areas", AREA)).status, 403);
  assert.equal((await bob.post(`/api/areas/${areaId}/analyses`, { inputs: CRITICAL_INPUTS })).status, 403);
  assert.equal((await bob.post(`/api/alerts/${alertId}/status`, { status: "em_acompanhamento" })).status, 403);
  assert.equal((await bob.get("/api/audit-logs")).status, 403);
  // admin cannot be granted owner by non-owner; alice (owner) removes bob
  assert.equal((await alice.del(`/api/organization/members/${(await alice.get("/api/organization/members")).body.find((m: any) => m.email === "bob@test.dev").userId}`)).status, 204);
  assert.equal((await bob.get("/api/areas")).status, 403, "membership re-checked on every request");
  // the session recovers to an organization he still belongs to
  const st = await bob.get("/api/auth/status");
  assert.notEqual(st.body.organization.id, aliceOrgId);
  assert.equal(st.body.organization.role, "owner");
  assert.equal((await bob.get("/api/areas")).status, 200);
});

// ── Dashboard, reports, audit ────────────────────────────────────────────────

test("dashboard summary reflects stored data with sources", async () => {
  const d = await alice.get("/api/dashboard/summary");
  assert.equal(d.status, 200);
  assert.equal(d.body.areas.total, 1);
  assert.equal(d.body.areas.analyzed, 1);
  assert.equal(d.body.alerts.resolved, 1);
  assert.equal(d.body.occurrences.total, 2);
  assert.match(d.body.occurrences.source, /não é integração oficial/);
  assert.ok(d.body.riskTrend.points.length >= 1);
});

test("CSV report export works and neutralises formula injection", async () => {
  await alice.patch(`/api/areas/${areaId}`, { name: "=HYPERLINK(\"http://x\")" });
  const r = await alice.get(`/api/reports/areas/${areaId}/analyses.csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/csv/);
  const lines = String(r.body).trim().split("\n");
  assert.equal(lines.length, 1 + 4);
  assert.ok(!/,=HYPERLINK/.test(String(r.body)));
  assert.match(String(r.body), /'=HYPERLINK/);
});

test("area report aggregates the period with sources, alerts and limitations", async () => {
  const r = await alice.get(`/api/reports/areas/${areaId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.area.id, areaId);
  assert.equal(r.body.summary.analyses, 4);
  assert.equal(r.body.summary.distribution["crítico"], 3);
  assert.equal(r.body.summary.distribution.baixo, 1);
  assert.equal(r.body.summary.scoreMax <= 100 && r.body.summary.scoreMin >= 0, true);
  assert.ok(r.body.sources.some((s: any) => s.key === "manual"));
  assert.ok(r.body.sources.some((s: any) => s.key === "fire_occurrences"));
  // first alert was resolved in the lifecycle test, so the later critical analysis opened a new one
  assert.equal(r.body.alerts.length, 2);
  assert.deepEqual(r.body.alerts.map((a: any) => a.status).sort(), ["novo", "resolvido"]);
  assert.ok(r.body.limitations.some((l: string) => /não substitui/i.test(l)));
  assert.ok(r.body.systemVersion);
  // empty past period
  const past = await alice.get(`/api/reports/areas/${areaId}?from=2020-01-01&to=2020-01-31`);
  assert.equal(past.body.summary.analyses, 0);
  assert.equal(past.body.summary.scoreAvg, null);
  // invalid period
  assert.equal((await alice.get(`/api/reports/areas/${areaId}?from=2026-02-01&to=2026-01-01`)).status, 400);
  // other organization
  assert.equal((await bob.get(`/api/reports/areas/${areaId}`)).status, 404);
});

test("insights aggregate only the caller's organization", async () => {
  const r = await alice.get("/api/insights");
  assert.equal(r.status, 200);
  const weekTotal = r.body.analysesByWeek.points.reduce((s: number, p: any) => s + p.baixo + p.moderado + p.alto + p["crítico"], 0);
  assert.equal(weekTotal, 4);
  assert.equal(r.body.frequentFactors.totalAnalyses, 4);
  assert.ok(r.body.frequentFactors.items.length > 0);
  assert.deepEqual(r.body.occurrencesByMonth.points, [{ month: "2025-08", n: 2 }]);
  const b = await bob.get("/api/insights");
  assert.equal(b.status, 200);
  assert.equal(b.body.frequentFactors.totalAnalyses, 0);
  assert.equal(b.body.occurrencesByMonth.points.length, 0);
});

test("Consulta Pública: only explicitly published batches are public, sanitised and filterable", async () => {
  const records = [
    { occurrenceDate: "2025-09-03", occurrenceTime: "14:30", municipality: "Cavalcante", state: "GO", latitude: -13.79712, longitude: -47.45678,
      occurrenceType: "Queimada", notes: "proprietário João, tel 6199999", sourceReference: "interno-123", validationStatus: "válido" },
    { occurrenceDate: "2025-09-20", occurrenceTime: "9h", municipality: "Cavalcante", state: "GO", latitude: -13.8, longitude: -47.46, validationStatus: "válido" },
    { occurrenceDate: "2024-09-10", occurrenceTime: "15:00", municipality: "Cavalcante", state: "GO", latitude: -13.81, longitude: -47.47, validationStatus: "válido" },
  ];
  const imp = await alice.post("/api/import-batches", { filename: "publicavel.csv", sourceName: "Brigada local (autorizado)", records });
  assert.equal(imp.status, 201);
  const batchId = imp.body.batchId;

  // private by default
  let pub = await anon.get("/api/public/occurrences?municipality=Cavalcante");
  assert.equal(pub.status, 200);
  assert.equal(pub.body.points.length, 0);

  // publishing requires explicit confirmation, admin role and own organization
  assert.equal((await alice.patch(`/api/import-batches/${batchId}/visibility`, { visibility: "publico" })).status, 400);
  assert.equal((await bob.patch(`/api/import-batches/${batchId}/visibility`, { visibility: "publico", confirm: true })).status, 404);
  const ok = await alice.patch(`/api/import-batches/${batchId}/visibility`, { visibility: "publico", confirm: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.visibility, "publico");

  pub = await anon.get("/api/public/occurrences?state=GO&municipality=cavalcante");
  assert.equal(pub.body.points.length, 3);
  const p0 = pub.body.points.find((p: any) => p.date === "2025-09-03");
  assert.equal(p0.latitude, -13.8);   // rounded to ~1 km
  assert.equal(p0.longitude, -47.46);
  const json = JSON.stringify(pub.body);
  assert.ok(!json.includes("João") && !json.includes("interno-123") && !json.includes("rawData"), "no private fields");
  // the earlier private batch of the same organization stays hidden
  assert.equal((await anon.get("/api/public/occurrences?municipality=Alto%20Paraíso%20de%20Goiás")).body.points.length, 0);

  // filters: period, hour
  assert.equal((await anon.get("/api/public/occurrences?from=2025-01-01&to=2025-12-31")).body.points.length, 2);
  assert.equal((await anon.get("/api/public/occurrences?hourFrom=12&hourTo=23")).body.points.length, 2);
  assert.equal((await anon.get("/api/public/occurrences?hourFrom=0&hourTo=11")).body.points.length, 1);
  assert.equal((await anon.get("/api/public/occurrences?state=XX")).status, 400);

  const sum = await anon.get("/api/public/summary?from=2025-09-01&to=2025-09-30&compareFrom=2024-09-01&compareTo=2024-09-30");
  assert.equal(sum.status, 200);
  assert.equal(sum.body.total, 2);
  assert.equal(sum.body.byHour.length, 24);
  assert.equal(sum.body.byHour[14].n, 1);
  assert.equal(sum.body.byHour[9].n, 1);
  assert.deepEqual(sum.body.comparison.current.total, 2);
  assert.deepEqual(sum.body.comparison.previous.total, 1);
  assert.equal(sum.body.comparison.changePct, 100);
  assert.equal(sum.body.sources[0].organization, "Cooperativa Alfa");
  assert.deepEqual((await anon.get("/api/public/municipalities?state=GO")).body, ["Cavalcante"]);

  // unpublish removes it immediately
  await alice.patch(`/api/import-batches/${batchId}/visibility`, { visibility: "privado" });
  assert.equal((await anon.get("/api/public/occurrences")).body.points.length, 0);
});

test("re-importing the same occurrences counts them as duplicates (cross-batch), never stores twice", async () => {
  const records = [
    { occurrenceDate: "2025-08-10", municipality: "Alto Paraíso de Goiás", state: "GO", latitude: -14.131, longitude: -47.512, validationStatus: "válido" },
    { occurrenceDate: "2025-08-11", municipality: "Alto Paraíso de Goiás", state: "GO", latitude: -14.14, longitude: -47.50, validationStatus: "válido com ressalvas" },
    { occurrenceDate: "2025-08-25", municipality: "Alto Paraíso de Goiás", state: "GO", latitude: -14.2, longitude: -47.6, validationStatus: "válido" },
  ];
  const before = (await alice.get("/api/fire-occurrences")).body.length;
  const r = await alice.post("/api/import-batches", { filename: "reenvio.csv", records });
  assert.equal(r.status, 201);
  assert.equal(r.body.saved, 1, "only the new occurrence is stored");
  assert.equal(r.body.report.duplicateRows, 2);
  assert.equal(r.body.report.validRows + r.body.report.warningRows, 1);
  assert.equal(r.body.report.rejectionReasons["duplicado de ocorrência já importada pela organização"], 2);
  assert.equal((await alice.get("/api/fire-occurrences")).body.length, before + 1);
});

test("an import that fails midway is rolled back completely (no partial batch)", async () => {
  const batchesBefore = (await alice.get("/api/import-batches")).body.length;
  const occBefore = Number((await alice.get("/api/fire-occurrences?limit=1")).headers.get("x-total-count"));
  const records = Array.from({ length: 1500 }, (_, i) => ({
    occurrenceDate: `2024-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    municipality: `Município ${i}`, state: "GO", latitude: -15 - i / 10000, longitude: -48, validationStatus: "válido",
    // row 1200 sits in the 2nd insert chunk; PostgreSQL rejects NUL bytes in text
    notes: i === 1200 ? "texto com byte nulo \u0000 aqui" : null,
  }));
  const r = await alice.post("/api/import-batches", { filename: "quebra.csv", records });
  assert.equal(r.status, 500);
  assert.equal(r.body.message, "Erro interno. Tente novamente mais tarde.");
  assert.equal((await alice.get("/api/import-batches")).body.length, batchesBefore, "no batch row left behind");
  assert.equal(Number((await alice.get("/api/fire-occurrences?limit=1")).headers.get("x-total-count")), occBefore, "first chunk rolled back");
});

test("pagination: limit/offset with X-Total-Count, body stays an array", async () => {
  const all = await alice.get("/api/fire-occurrences");
  const total = Number(all.headers.get("x-total-count"));
  assert.equal(all.body.length, total);
  const p1 = await alice.get("/api/fire-occurrences?limit=2&offset=0");
  const p2 = await alice.get("/api/fire-occurrences?limit=2&offset=2");
  assert.ok(Array.isArray(p1.body));
  assert.equal(p1.body.length, Math.min(2, total));
  assert.equal(Number(p1.headers.get("x-total-count")), total);
  assert.ok(!p1.body.some((a: any) => p2.body.some((b: any) => b.id === a.id)), "pages do not overlap");
  assert.equal((await alice.get("/api/fire-occurrences?limit=0")).status, 400);
  assert.equal((await alice.get("/api/fire-occurrences?limit=999999")).status, 400);
  const al = await alice.get("/api/alerts?limit=1");
  assert.equal(al.body.length, 1);
  assert.ok(Number(al.headers.get("x-total-count")) >= 1);
});

test("imports resolve the official IBGE municipality code when the list is loaded", async () => {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query(`INSERT INTO municipalities (ibge_code, name, state, name_normalized) VALUES ('5205307','Cavalcante','GO','cavalcante') ON CONFLICT DO NOTHING`);
  await c.end();
  const r = await alice.post("/api/import-batches", { filename: "ibge.csv", records: [
    { occurrenceDate: "2025-10-02", municipality: "CAVALCANTE", state: "go", latitude: -13.7, longitude: -47.4, validationStatus: "válido" },
    { occurrenceDate: "2025-10-03", municipality: "Lugar Inexistente", state: "GO", latitude: -13.7, longitude: -47.4, validationStatus: "válido" },
  ] });
  assert.equal(r.status, 201);
  const occ = (await alice.get(`/api/fire-occurrences?batchId=${r.body.batchId}`)).body;
  const byMun = Object.fromEntries(occ.map((o: any) => [o.municipality, o.municipalityIbgeCode]));
  assert.equal(byMun["CAVALCANTE"], "5205307");
  assert.equal(byMun["Lugar Inexistente"], null, "unknown name is left NULL, never guessed");
});

// ── INPE hotspots, weather cache and AI traceability ─────────────────────────
import { readFileSync } from "node:fs";
const INPE_SAMPLE = readFileSync(new URL("../fixtures/inpe_focos_diario_amostra.csv", import.meta.url), "utf8");

/** Real INPE sample with timestamps moved to `hoursAgo` and the first 3 rows placed ~2 km from the test area. */
function inpeFixture(hoursAgo = 2, frpOverride?: string) {
  const ts = new Date(Date.now() - hoursAgo * 3600_000).toISOString().slice(0, 19).replace("T", " ");
  const [head, ...lines] = INPE_SAMPLE.trim().split("\n");
  const out = lines.map((l, i) => {
    const c = l.split(",");
    if (c[3] && /^\d{4}-/.test(c[3])) c[3] = ts;
    if (i < 3) { c[1] = String(AREA.latitude + 0.015 * (i + 1)); c[2] = String(AREA.longitude); c[9] = "52"; }
    if (i === 0 && frpOverride !== undefined) c[15] = frpOverride;
    return c.join(",");
  });
  return [head, ...out].join("\n") + "\n";
}

test("analysis without hotspot info and without INPE data flags proximity as NOT verified", async () => {
  const { nearbyHotspot, hotspotDistance, ...rest } = CRITICAL_INPUTS;
  const r = await alice.post(`/api/areas/${areaId}/analyses`, { inputs: rest });
  assert.equal(r.status, 201);
  assert.equal(r.body.inputData.nearbyHotspot, false);
  assert.ok(r.body.limitations.some((l: string) => /NÃO verificada/.test(l)));
  assert.ok(!r.body.dataSources.some((s: any) => s.key === "inpe-queimadas"));
});

test("INPE sync: failure is recorded without rows; success is idempotent; real changes are updates", async () => {
  const { syncInpeDay } = await import("../../server/connectors/inpe");
  const day = new Date().toISOString().slice(0, 10);
  const failed = await syncInpeDay(day, async () => ({ ok: false, status: 404, text: "" }));
  assert.equal(failed.status, "falha");
  assert.match(failed.error!, /404/);
  const broken = await syncInpeDay(day, async () => ({ ok: true, status: 200, text: "coluna_errada\n1\n" }));
  assert.equal(broken.status, "falha");
  assert.match(broken.error!, /colunas ausentes/);

  const first = await syncInpeDay(day, async () => ({ ok: true, status: 200, text: inpeFixture() }));
  assert.equal(first.status, "sucesso");
  assert.deepEqual([first.read, first.inserted, first.updated, first.rejected], [16, 12, 0, 4]);
  const again = await syncInpeDay(day, async () => ({ ok: true, status: 200, text: inpeFixture() }));
  assert.deepEqual([again.inserted, again.updated, again.unchanged], [0, 0, 12], "idempotent re-sync");
  const changed = await syncInpeDay(day, async () => ({ ok: true, status: 200, text: inpeFixture(2, "999.9") }));
  assert.deepEqual([changed.inserted, changed.updated], [0, 1], "INPE correction updates the row");

  const conn = (await anon.get("/api/connectors")).body.find((c: any) => c.key === "inpe-queimadas");
  assert.ok(conn.lastSuccessAt, "registry shows last successful sync");
  assert.equal(conn.lastRun.status, "sucesso");
});

test("public hotspot API: separate from imported records, explicit caveats, bounded range", async () => {
  const s = await anon.get("/api/public/hotspots/summary");
  assert.equal(s.status, 200);
  assert.equal(s.body.total, 12);
  assert.ok(s.body.bySatellite.length >= 1);
  assert.match(s.body.notice, /não é incêndio confirmado/);
  const p = await anon.get("/api/public/hotspots?state=GO");
  assert.ok(p.body.points.length >= 3);
  assert.ok(p.body.points.every((x: any) => x.state === "GO"));
  assert.equal((await anon.get("/api/public/hotspots?from=2026-01-01&to=2026-03-01")).status, 400);
  // public occurrence lookup never includes satellite detections
  const occ = await anon.get("/api/public/summary");
  assert.ok(!JSON.stringify(occ.body).includes("NOAA"));
});

test("Sisfogo sync: strict on shape, idempotent, rectified ROIs update, public summary", async () => {
  const { syncSisfogo } = await import("../../server/connectors/sisfogo");
  const { roi, page } = await import("../fixtures/sisfogo");
  const fast = { intervalMs: 0 };
  const failed = await syncSisfogo({ ...fast, fetchJson: async () => ({ ok: false, status: 503, json: null }) });
  assert.equal(failed.status, "falha");
  assert.match(failed.error!, /503/);
  const odd = await syncSisfogo({ ...fast, fetchJson: async () => ({ ok: true, status: 200, json: { content: [] } }) });
  assert.equal(odd.status, "falha");
  assert.match(odd.error!, /fora do formato documentado/);

  const pages = (fix = false) => async (url: string) => {
    const n = Number(new URL(url).searchParams.get("page"));
    const items = n === 1
      ? [roi(1), roi(2), roi(3, { statusRoi: "EM_ANDAMENTO" }), { semId: true }]
      : [roi(4, fix ? { retificado: true, informacoesPosIncendio: { estimativaAreaQueimada: 40 } } : {}), roi(4)];
    return { ok: true, status: 200, json: page(items, n, 2) };
  };
  const first = await syncSisfogo({ ...fast, fetchJson: pages() });
  assert.equal(first.status, "sucesso");
  assert.deepEqual([first.pages, first.read, first.inserted, first.updated, first.rejected], [2, 6, 3, 0, 3]);
  assert.equal(first.rejectionReasons.duplicado_na_pagina, 1);
  const again = await syncSisfogo({ ...fast, fetchJson: pages() });
  assert.deepEqual([again.inserted, again.updated, again.unchanged], [0, 0, 3], "idempotent re-sync");
  const fixed = await syncSisfogo({ ...fast, fetchJson: pages(true) });
  assert.deepEqual([fixed.inserted, fixed.updated], [0, 1], "rectified ROI updates the stored row");
  const capped = await syncSisfogo({ ...fast, maxPages: 1, fetchJson: pages() });
  assert.equal(capped.pages, 1);

  const s = await anon.get("/api/public/sisfogo/summary?state=TO");
  assert.equal(s.status, 200);
  assert.equal(s.body.total, 3);
  assert.equal(s.body.burnedAreaHa, 12.5 + 12.5 + 40);
  assert.ok(s.body.lastSyncAt);
  assert.match(s.body.notice, /não representam todos os incêndios/);
  assert.equal((await anon.get("/api/public/sisfogo/summary?state=SP")).body.total, 0);
  assert.equal((await anon.get("/api/public/sisfogo/summary?state=XX")).status, 400);
  assert.equal((await anon.get("/api/public/sisfogo/summary?from=2026-09-01&to=2026-08-01")).status, 400);
  const conn = (await anon.get("/api/connectors")).body.find((c: any) => c.key === "sisfogo-roi");
  assert.ok(conn, "source listed in the connector registry");
  assert.equal(conn.lastRun.status, "sucesso");
});

test("public hotspot grid aggregates detections for overview maps", async () => {
  const g = await anon.get("/api/public/hotspots/grid");
  assert.equal(g.status, 200);
  assert.equal(g.body.total, 12, "grid total equals the stored detections in range");
  assert.ok(g.body.cells.length >= 1 && g.body.cells.length <= 12);
  assert.ok(g.body.cells.every((c: any) => c.n >= 1 && Math.abs(c.lat) <= 90));
  assert.equal(g.body.states.reduce((a: number, s: any) => a + s.n, 0) <= 12, true);
  assert.equal(g.body.states[0].state !== undefined, true);
  assert.ok(g.body.lastSyncAt);
  assert.equal((await anon.get("/api/public/hotspots/grid?cell=0")).status, 400);
});

test("analysis infers nearby hotspot from fresh INPE data and records full traceability", async () => {
  const { nearbyHotspot, hotspotDistance, ...rest } = CRITICAL_INPUTS;
  const r = await alice.post(`/api/areas/${areaId}/analyses`, { inputs: rest });
  assert.equal(r.status, 201);
  assert.equal(r.body.inputData.nearbyHotspot, true);
  assert.ok(r.body.inputData.hotspotDistance > 1 && r.body.inputData.hotspotDistance < 2, `distance ${r.body.inputData.hotspotDistance}`);
  assert.ok(r.body.dataSources.some((x: any) => x.key === "inpe-queimadas"));
  assert.ok(r.body.limitations.some((l: string) => /detecções do INPE/.test(l)));
  const d = await alice.get(`/api/analyses/${r.body.id}`);
  assert.equal(d.body.modelVersion.engineFamily, WITH_PYTHON ? "regras-python" : "regras-typescript");
  assert.equal(d.body.modelVersion.isExperimental, false);
  const inpe = d.body.sourcesUsed.find((x: any) => x.sourceKey === "inpe-queimadas");
  assert.deepEqual(inpe.fields, ["nearbyHotspot"]);
  assert.equal(inpe.recordCount, 3);
  assert.ok(d.body.sourcesUsed.some((x: any) => x.sourceKey === "manual" && x.fields.includes("temperature")));
  const current = await alice.get(`/api/areas/${areaId}`);
  assert.equal(d.body.areaSnapshot.name, current.body.name, "snapshot = area as it was at analysis time");
});

test("weather cache: a recent Open-Meteo value for the same coordinate is reused (no API call)", async () => {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query(
    `INSERT INTO weather_data (latitude, longitude, temperature, humidity, wind_speed, precipitation_72h, source_key, kind, observed_at, fetched_at)
     VALUES ($1, $2, 37.5, 16, 33, 0.4, 'open-meteo', 'atual', now() - interval '20 minutes', now() - interval '5 minutes')`,
    [AREA.latitude + 0.001, AREA.longitude - 0.001],
  );
  await c.end();
  const r = await alice.post(`/api/areas/${areaId}/analyses`, { useLiveWeather: true, inputs: { vegetationCondition: "dry", nearbyHotspot: false } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.inputData.temperature, 37.5);
  assert.equal(r.body.dataQuality.provenance.find((p: any) => p.field === "humidity").origin, "open-meteo");
  assert.ok(r.body.limitations.some((l: string) => /cache local/.test(l)));
  const d = await alice.get(`/api/analyses/${r.body.id}`);
  assert.equal(d.body.sourcesUsed.find((x: any) => x.sourceKey === "open-meteo").detail.cached, true);
});

test("critical operations are written to the audit log", async () => {
  const r = await alice.get("/api/audit-logs");
  assert.equal(r.status, 200);
  const actions = new Set(r.body.map((x: any) => x.action));
  for (const a of ["auth.signup", "area.created", "analysis.created", "alert.status_changed", "import.batch_created", "import.batch_published", "import.batch_unpublished", "org.member_added", "report.exported"]) {
    assert.ok(actions.has(a), `missing audit action ${a}`);
  }
  assert.ok(!JSON.stringify(r.body).includes("senhaForte1"), "no password in audit");
});

// ── Password reset & logout ──────────────────────────────────────────────────

test("password reset: same response for unknown e-mail, single-use token", async () => {
  const unknown = await anon.post("/api/auth/password-reset/request", { email: "ninguem@test.dev" });
  const known = await anon.post("/api/auth/password-reset/request", { email: "alice@test.dev" });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.message, known.body.message);
  const token = resetLinks.at(-1)!;
  assert.ok(token);
  assert.equal((await anon.post("/api/auth/password-reset/confirm", { token, newPassword: "novaSenha3" })).status, 200);
  assert.equal((await anon.post("/api/auth/password-reset/confirm", { token, newPassword: "outraNova4" })).status, 400);
  const c = new Client();
  assert.equal((await c.post("/api/auth/login", { email: "alice@test.dev", password: "novaSenha3" })).status, 200);
});

test("logout invalidates the session", async () => {
  const oldCookie = alice.cookie;
  assert.equal((await alice.get("/api/areas")).status, 200);
  assert.equal((await alice.post("/api/auth/logout")).status, 200);
  alice.cookie = oldCookie; // replay the pre-logout cookie: must be dead server-side
  assert.equal((await alice.get("/api/areas")).status, 401);
});

test("unknown API route returns JSON 404", async () => {
  const r = await anon.get("/api/nao-existe");
  assert.equal(r.status, 404);
  assert.equal(typeof r.body.message, "string");
});
