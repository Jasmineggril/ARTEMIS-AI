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

test("Florestaí: only explicitly published batches are public, sanitised and filterable", async () => {
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
