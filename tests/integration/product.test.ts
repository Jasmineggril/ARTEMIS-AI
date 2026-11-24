/**
 * Product features against a REAL PostgreSQL database: property boundaries
 * (validation + calculated values with provenance), surroundings, alerts from
 * detected hotspots, platform admin, invitations and account recovery.
 * Own database derived from TEST_DATABASE_URL (suffix "_product"), dropped and
 * recreated on every run. Hotspots inserted here are TEST rows in a test DB.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import pg from "pg";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE || !/test/i.test(new URL(BASE).pathname)) {
  console.error("TEST_DATABASE_URL ausente ou sem 'test' no nome — testes não executados.");
  process.exit(1);
}
const DB_NAME = `${new URL(BASE).pathname.slice(1)}_product`;
const DB_URL = (() => { const x = new URL(BASE); x.pathname = `/${DB_NAME}`; return x.toString(); })();
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_DISABLED = "true";
process.env.PYTHON_SERVICE_URL = "http://127.0.0.1:9";
delete process.env.SMTP_URL;

let base = "";
let close: () => Promise<void>;
let c: pg.Client;
const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;

class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
}
const owner = new Client();
const other = new Client();
const admin = new Client();
const anon = new Client();

before(async () => {
  const a = new pg.Client({ connectionString: (() => { const x = new URL(BASE!); x.pathname = "/postgres"; return x.toString(); })() });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await a.query(`CREATE DATABASE "${DB_NAME}"`);
  await a.end();
  const origLog = console.log;
  console.log = (...args: unknown[]) => { if (process.env.TEST_VERBOSE) origLog(...args); };
  const { runMigrations } = await import("../../server/migrate");
  await runMigrations();
  const { createApp } = await import("../../server/app");
  const { httpServer } = await createApp();
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  const { pool } = await import("../../server/db");
  close = async () => { await c.end(); await new Promise((r) => httpServer.close(() => r(null))); await pool?.end(); console.log = origLog; };
  for (const [cl, email, org] of [[owner, "dona@test.dev", "Fazenda Teste"], [other, "outra@test.dev", "Outra Org"], [admin, "admin@test.dev", "Plataforma"]] as const) {
    assert.equal((await cl.post("/api/auth/signup", { name: "Pessoa Teste", email, password: "senhaForte1", organizationName: org, organizationType: "produtor", acceptPrivacy: true })).status, 201);
  }
  await q(`UPDATE users SET role = 'platform_admin' WHERE email = 'admin@test.dev'`);
});
after(async () => close?.());

// ~1 km × 1 km square (≈100 ha) near Alto Paraíso de Goiás
const d = 0.009;
const SQ = { type: "Polygon", coordinates: [[[-47.51, -14.13], [-47.51 + d * 1.0307, -14.13], [-47.51 + d * 1.0307, -14.13 + d], [-47.51, -14.13 + d], [-47.51, -14.13]]] };
const AREA = { name: "Fazenda Polígono", operationType: "propriedade_rural", municipality: "Alto Paraíso de Goiás", state: "GO" };
let areaId = 0;

test("property with a drawn boundary: area and point are CALCULATED from the polygon, with provenance", async () => {
  const r = await owner.post("/api/areas", { ...AREA, boundary: SQ, boundarySource: "desenho" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  areaId = r.body.id;
  assert.equal(r.body.boundarySource, "desenho");
  assert.ok(Math.abs(r.body.boundaryAreaHa - 100) < 2, `boundary ${r.body.boundaryAreaHa}`);
  assert.equal(r.body.areaHectares, r.body.boundaryAreaHa);
  assert.equal(r.body.areaHectaresSource, "calculada");
  assert.equal(r.body.coordinatesSource, "centro_do_poligono");
  assert.ok(Math.abs(r.body.latitude - (-14.1255)) < 0.001 && Math.abs(r.body.longitude - (-47.5054)) < 0.001);
  assert.deepEqual(r.body.warnings, []);
});

test("informed values are kept and flagged when they disagree with the polygon", async () => {
  const r = await owner.post("/api/areas", { ...AREA, name: "Fazenda Informada", boundary: SQ, areaHectares: 300, latitude: -14.5, longitude: -47.51 });
  assert.equal(r.status, 201);
  assert.equal(r.body.areaHectaresSource, "informada");
  assert.equal(r.body.areaHectares, 300);
  assert.equal(r.body.coordinatesSource, "informadas");
  assert.equal(r.body.warnings.length, 2, JSON.stringify(r.body.warnings));
  assert.match(r.body.warnings.join(" "), /mais de 5 km do polígono/);
  assert.match(r.body.warnings.join(" "), /difere em mais de 20 %/);
  // removing the boundary clears only values that were calculated from it
  const p = await owner.patch(`/api/areas/${areaId}`, { boundary: null });
  assert.equal(p.status, 200);
  assert.equal(p.body.boundary, null);
  assert.equal(p.body.areaHectares, null);
  assert.equal(p.body.latitude, null);
  assert.equal((await owner.patch(`/api/areas/${areaId}`, { boundary: SQ, boundarySource: "kml" })).body.areaHectaresSource, "calculada");
});

test("invalid geometry is refused with an explanation (422), nothing stored", async () => {
  const before = (await q(`SELECT count(*)::int n FROM monitored_areas`))[0].n;
  const bow = { type: "Polygon", coordinates: [[[-47.5, -14.1], [-47.4, -14.0], [-47.4, -14.1], [-47.5, -14.0], [-47.5, -14.1]]] };
  const r1 = await owner.post("/api/areas", { ...AREA, boundary: bow });
  assert.equal(r1.status, 422);
  assert.match(r1.body.message, /bordas se cruzam/);
  const swapped = { type: "Polygon", coordinates: [SQ.coordinates[0].map(([x, y]) => [y, x])] };
  const r2 = await owner.post("/api/areas", { ...AREA, boundary: swapped });
  assert.equal(r2.status, 422);
  assert.match(r2.body.message, /fora do Brasil/);
  assert.equal((await q(`SELECT count(*)::int n FROM monitored_areas`))[0].n, before);
});

async function hotspot(lng: number, lat: number, minutesAgo: number, sat = "NOAA-20") {
  const [{ id: src }] = await q(`SELECT id FROM data_sources WHERE key = 'inpe-queimadas'`);
  await q(`INSERT INTO satellite_hotspots (source_id, external_id, satellite, detected_at, latitude, longitude)
           VALUES ($1, $2, $3, now() - make_interval(mins => $4), $5, $6)`, [src, `teste-${lng}-${lat}-${minutesAgo}`, sat, minutesAgo, lat, lng]);
}

test("surroundings: observed hotspots by distance to the boundary, official records, own imports", async () => {
  await hotspot(-47.506, -14.126, 30);                 // inside
  await hotspot(-47.51 + d * 1.0307 + 0.028, -14.126, 40); // ~3 km east of the edge
  await hotspot(-47.30, -14.126, 50);                  // ~22 km: outside the 10 km radius
  await hotspot(-47.506, -14.126, 60 * 24 * 10);       // inside but 10 days old
  const [{ id: sis }] = await q(`SELECT id FROM data_sources WHERE key = 'sisfogo-roi'`);
  await q(`INSERT INTO fire_occurrences (data_source_id, external_id, occurrence_date, occurred_at, latitude, longitude, source_reference, affected_area)
           VALUES ($1, 'teste-roi-1', '2026-08-01', '2026-08-01T15:00:00Z', -14.12, -47.50, 'ROI.TESTE.1', 12.5)`, [sis]);
  const s = await owner.get(`/api/areas/${areaId}/surroundings?days=7`);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.reference.kind, "poligono");
  assert.deepEqual(s.body.hotspots.counts, { inside: 1, km1: 1, km5: 2, radius: 2 });
  assert.equal(s.body.hotspots.nearestKm, 0);
  assert.equal(s.body.hotspots.items.length, 2);
  assert.match(s.body.hotspots.note, /não são incêndios confirmados/i);
  assert.equal(s.body.official.counts.radius, 1);
  assert.equal(s.body.official.items[0].roiNumber, "ROI.TESTE.1");
  assert.equal(s.body.imported.count, 0);
  assert.equal((await owner.get(`/api/areas/${areaId}/surroundings?days=31`)).body.hotspots.counts.inside, 2);
  assert.equal((await other.get(`/api/areas/${areaId}/surroundings`)).status, 404, "another organisation cannot see it");
  assert.equal((await owner.get(`/api/areas/${areaId}/surroundings?days=99`)).status, 400);
});

test("detected hotspot opens ONE alert per property per day, updates it, respects the configured distance", async () => {
  const { evaluateHotspotAlerts } = await import("../../server/services/hotspot-alerts");
  const r1 = await evaluateHotspotAlerts({ windowHours: 24 });
  assert.ok(r1.alertsCreated >= 1);
  const [al] = await q(`SELECT * FROM alerts WHERE area_id = $1 AND kind = 'foco_proximo'`, [areaId]);
  assert.equal(al.status, "novo");
  assert.equal(al.severity, "alto", "hotspot inside the property");
  assert.equal(al.evidence.count, 2);
  assert.equal(al.evidence.inside, 1);
  assert.match(al.reason, /não é incêndio confirmado/);
  assert.equal(al.data_source, "INPE — Programa Queimadas (focos de calor por satélite)");

  const again = await evaluateHotspotAlerts({ windowHours: 24 });
  assert.equal(again.alertsCreated, 0);
  assert.equal(again.alertsUpdated, 0, "same detections: unchanged");
  await hotspot(-47.507, -14.127, 5, "AQUA_M-T");
  const upd = await evaluateHotspotAlerts({ windowHours: 24 });
  assert.equal(upd.alertsCreated, 0);
  assert.ok(upd.alertsUpdated >= 1, "both properties over the same ground are updated, none duplicated");
  const [al2] = await q(`SELECT occurrence_count, evidence FROM alerts WHERE id = $1`, [al.id]);
  assert.equal(al2.occurrence_count, 2);
  assert.equal(al2.evidence.count, 3);
  assert.equal((await q(`SELECT count(*)::int n FROM alerts WHERE area_id = $1 AND kind = 'foco_proximo'`, [areaId]))[0].n, 1);
  const events = await q(`SELECT note FROM alert_events WHERE alert_id = $1 ORDER BY id`, [al.id]);
  assert.equal(events.length, 2);

  // the alert is visible in the alerts API with its evidence
  const api = await owner.get(`/api/alerts/${al.id}`);
  assert.equal(api.status, 200);
  assert.equal(api.body.kind, "foco_proximo");
  assert.equal(api.body.evidence.detections.length, 3);

  // a property configured for "inside only" (0 km) is not alerted for a hotspot 3 km away
  const far = await owner.post("/api/areas", { ...AREA, name: "Só dentro", boundary: { type: "Polygon", coordinates: [SQ.coordinates[0].map(([x, y]) => [x + 0.0475, y])] }, hotspotAlertKm: 0 });
  assert.equal(far.status, 201);
  await evaluateHotspotAlerts({ windowHours: 24 });
  assert.equal((await q(`SELECT count(*)::int n FROM alerts WHERE area_id = $1`, [far.body.id]))[0].n, 0);
});

test("platform admin panel: real counts, restricted access, users with last login", async () => {
  assert.equal((await owner.get("/api/admin/overview")).status, 403);
  assert.equal((await anon.get("/api/admin/overview")).status, 401);
  const o = await admin.get("/api/admin/overview");
  assert.equal(o.status, 200);
  const [{ n: users }] = await q(`SELECT count(*)::int n FROM users`);
  const [{ n: areas }] = await q(`SELECT count(*)::int n FROM monitored_areas`);
  assert.equal(o.body.users.total, users);
  assert.equal(o.body.areas.total, areas);
  assert.equal(o.body.areas.withBoundary, areas);
  assert.ok(o.body.alerts.open >= 1);
  assert.ok(o.body.sources.some((s: any) => s.key === "sisfogo-roi"));
  const u = await admin.get("/api/admin/users?q=dona");
  assert.equal(u.status, 200);
  assert.equal(u.body.length, 1);
  assert.equal(u.body[0].organizations[0].role, "owner");
  assert.ok(u.body[0].lastLoginAt === null || typeof u.body[0].lastLoginAt === "string");
});

test("invitation: new person gets an account + single-use link; can define password and sign in", async () => {
  const r = await owner.post("/api/organization/members", { email: "convidada@test.dev", role: "analyst" });
  assert.equal(r.status, 404);
  assert.equal(r.body.needsName, true);
  const inv = await owner.post("/api/organization/members", { email: "convidada@test.dev", role: "analyst", name: "Pessoa Convidada" });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  assert.equal(inv.body.invited, true);
  assert.equal(inv.body.access.emailed, false, "no SMTP in this environment");
  const token = new URL(inv.body.access.link).searchParams.get("token")!;
  const guest = new Client();
  assert.equal((await guest.post("/api/auth/login", { email: "convidada@test.dev", password: "qualquer1" })).status, 401, "no usable password before the link");
  assert.equal((await guest.post("/api/auth/password-reset/confirm", { token, newPassword: "senhaNova9" })).status, 200);
  assert.equal((await guest.post("/api/auth/password-reset/confirm", { token, newPassword: "senhaNova8" })).status, 400, "single use");
  assert.equal((await guest.post("/api/auth/login", { email: "convidada@test.dev", password: "senhaNova9" })).status, 200);
  const st = await guest.get("/api/auth/status");
  assert.equal(st.body.organization.name, "Fazenda Teste");
  assert.equal(st.body.organization.role, "analyst");
  const [{ action }] = await q(`SELECT action FROM audit_logs WHERE action = 'org.member_invited' LIMIT 1`);
  assert.equal(action, "org.member_invited");
});

test("access link: org admin only for people in no other organisation; platform admin for anyone", async () => {
  const [{ id: guestId }] = await q(`SELECT id FROM users WHERE email = 'convidada@test.dev'`);
  const ok = await owner.post(`/api/organization/members/${guestId}/access-link`);
  assert.equal(ok.status, 201);
  assert.ok(ok.body.link.includes("/reset-password?token="));
  // the person joins another organisation → the first org's admin can no longer issue links
  await q(`INSERT INTO organization_members (organization_id, user_id, role) SELECT o.id, $1, 'viewer' FROM organizations o WHERE o.name = 'Outra Org'`, [guestId]);
  const refused = await owner.post(`/api/organization/members/${guestId}/access-link`);
  assert.equal(refused.status, 403);
  assert.match(refused.body.message, /outra organização/);
  const [{ id: otherId }] = await q(`SELECT id FROM users WHERE email = 'outra@test.dev'`);
  assert.equal((await owner.post(`/api/organization/members/${otherId}/access-link`)).status, 404, "not a member");
  const pa = await admin.post(`/api/admin/users/${guestId}/access-link`);
  assert.equal(pa.status, 201);
  assert.equal((await owner.post(`/api/admin/users/${guestId}/access-link`)).status, 403);
});

test("self-service reset: honest message without e-mail; sends the link when SMTP is configured", async () => {
  const r = await anon.post("/api/auth/password-reset/request", { email: "dona@test.dev" });
  assert.equal(r.status, 200);
  assert.equal(r.body.emailDelivery, false);
  assert.match(r.body.message, /administrador da sua organização/);
  const unknown = await anon.post("/api/auth/password-reset/request", { email: "ninguem@test.dev" });
  assert.equal(unknown.body.message, r.body.message, "does not reveal whether the e-mail exists");

  const { setMailerForTests } = await import("../../server/services/account-links");
  const sent: any[] = [];
  process.env.MAIL_FROM = "ARTEMIS AI <teste@test.dev>";
  setMailerForTests({ sendMail: async (m: any) => { sent.push(m); return {}; } } as any);
  try {
    const m = await anon.post("/api/auth/password-reset/request", { email: "dona@test.dev" });
    assert.equal(m.body.emailDelivery, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "dona@test.dev");
    assert.match(sent[0].text, /reset-password\?token=/);
    const inv = await owner.post("/api/organization/members", { email: "segunda@test.dev", role: "viewer", name: "Segunda Pessoa" });
    assert.equal(inv.body.access.emailed, true);
    assert.equal(inv.body.access.link, undefined, "link not exposed when it was e-mailed");
    assert.match(sent[1].subject, /Convite para a ARTEMIS AI — Fazenda Teste/);
  } finally {
    setMailerForTests(undefined);
    delete process.env.MAIL_FROM;
  }
});
