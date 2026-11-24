/**
 * Alert notifications against a REAL PostgreSQL (own database, suffix "_notify").
 * Covers: delivery row created with the alert, no duplicates, preferences,
 * "blocked by configuration" without SMTP (never reported as sent), sending
 * with a transport, retry with backoff and final failure, organisation isolation.
 * The hotspot is a CONTROLLED test row; e-mails go to nodemailer's in-memory
 * jsonTransport (nothing leaves the machine).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import pg from "pg";
import nodemailer from "nodemailer";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE || !/test/i.test(new URL(BASE).pathname)) { console.error("TEST_DATABASE_URL ausente ou sem 'test'."); process.exit(1); }
const DB_NAME = `${new URL(BASE).pathname.slice(1)}_notify`;
const DB_URL = (() => { const x = new URL(BASE); x.pathname = `/${DB_NAME}`; return x.toString(); })();
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_DISABLED = "true";
process.env.PYTHON_SERVICE_URL = "http://127.0.0.1:9";
process.env.MAIL_FROM = "artemis@test.invalid";
delete process.env.SMTP_URL;

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
    return { status: res.status, body: j };
  }
}
const owner = new Client(), other = new Client();
let areaId = 0;
const LAT = -14.1255, LNG = -47.5055;

before(async () => {
  const a = new pg.Client({ connectionString: (() => { const x = new URL(BASE!); x.pathname = "/postgres"; return x.toString(); })() });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); await a.query(`CREATE DATABASE "${DB_NAME}"`); await a.end();
  const origLog = console.log, origErr = console.error;
  console.log = (...x: unknown[]) => { if (process.env.TEST_VERBOSE) origLog(...x); };
  console.error = (...x: unknown[]) => { if (process.env.TEST_VERBOSE) origErr(...x); };
  const { runMigrations } = await import("../../server/migrate"); await runMigrations();
  const { createApp } = await import("../../server/app"); const { httpServer } = await createApp();
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  c = new pg.Client({ connectionString: DB_URL }); await c.connect();
  const { pool } = await import("../../server/db");
  close = async () => { await c.end(); await new Promise((r) => httpServer.close(() => r(null))); await pool?.end(); console.log = origLog; console.error = origErr; };
  for (const [cl, email] of [[owner, "dona@test.dev"], [other, "outra@test.dev"]] as const) {
    assert.equal((await cl.req("POST", "/api/auth/signup", { name: "Pessoa", email, password: "senhaForte1", organizationName: `Org ${email}`, organizationType: "produtor", acceptPrivacy: true })).status, 201);
  }
  const d = 0.009;
  const r = await owner.req("POST", "/api/areas", { name: "Fazenda Aviso", operationType: "propriedade_rural", municipality: "Alto Paraíso de Goiás", state: "GO",
    boundary: { type: "Polygon", coordinates: [[[LNG - d / 2, LAT - d / 2], [LNG + d / 2, LAT - d / 2], [LNG + d / 2, LAT + d / 2], [LNG - d / 2, LAT + d / 2], [LNG - d / 2, LAT - d / 2]]] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  areaId = r.body.id;
});
after(async () => { const { setMailerForTests } = await import("../../server/services/account-links"); setMailerForTests(undefined); await close?.(); });

async function hotspot(id: string, hoursAgo = 1) {
  await q(`INSERT INTO satellite_hotspots (source_id, external_id, satellite, detected_at, latitude, longitude)
    SELECT id, $1, 'TESTE', now() - make_interval(hours => $2), $3, $4 FROM data_sources WHERE key = 'inpe-queimadas'`, [id, hoursAgo, LAT, LNG]);
}

test("preferences: defaults, validation and update", async () => {
  const g = await owner.req("GET", "/api/notifications/preferences");
  assert.equal(g.status, 200);
  assert.deepEqual([g.body.emailEnabled, g.body.minSeverity, g.body.saved, g.body.smtpConfigured], [true, "alto", false, false]);
  assert.equal((await owner.req("PUT", "/api/notifications/preferences", { emailEnabled: true, minSeverity: "urgente", kinds: [] })).status, 400);
  // the other organisation opts out completely: it must never get a row
  assert.equal((await other.req("PUT", "/api/notifications/preferences", { emailEnabled: false, minSeverity: "baixo", kinds: ["risco"] })).status, 200);
});

test("hotspot alert creates one delivery; without SMTP it is BLOCKED, never 'sent'", async () => {
  const { evaluateHotspotAlerts } = await import("../../server/services/hotspot-alerts");
  const { processDeliveries } = await import("../../server/services/notifications");
  await hotspot("n1");
  const r = await evaluateHotspotAlerts({ windowHours: 24 });
  assert.equal(r.alertsCreated, 1);
  let rows = await q(`SELECT d.status, d.attempts FROM notification_deliveries d JOIN alerts a ON a.id = d.alert_id WHERE a.area_id = $1`, [areaId]);
  assert.deepEqual(rows, [{ status: "pendente", attempts: 0 }]);
  // a second detection updates the same alert: no second delivery
  await hotspot("n2");
  assert.equal((await evaluateHotspotAlerts({ windowHours: 24 })).alertsUpdated, 1);
  assert.equal((await q(`SELECT count(*)::int AS n FROM notification_deliveries`))[0].n, 1);

  const p = await processDeliveries();
  assert.deepEqual([p.claimed, p.sent, p.blocked], [1, 0, 1]);
  rows = await q(`SELECT status, sent_at, last_error FROM notification_deliveries`);
  assert.equal(rows[0].status, "bloqueado_configuracao");
  assert.equal(rows[0].sent_at, null);
  assert.match(rows[0].last_error, /SMTP não configurado/);
  // blocked rows are not reprocessed while there is still no SMTP
  assert.equal((await processDeliveries()).claimed, 0);
});

test("once SMTP exists, the blocked delivery is sent; the alert log shows it", async () => {
  const { setMailerForTests } = await import("../../server/services/account-links");
  const { processDeliveries } = await import("../../server/services/notifications");
  const sent: any[] = [];
  const t = nodemailer.createTransport({ jsonTransport: true });
  const orig = t.sendMail.bind(t);
  (t as any).sendMail = async (m: any) => { sent.push(m); return orig(m); };
  setMailerForTests(t);
  const p = await processDeliveries();
  assert.deepEqual([p.claimed, p.sent], [1, 1]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "dona@test.dev");
  assert.match(sent[0].subject, /\[ARTEMIS AI\] Foco de calor dentro de Fazenda Aviso/);
  assert.match(sent[0].text, /não incêndio confirmado/);
  const alertId = (await q(`SELECT id FROM alerts WHERE area_id = $1`, [areaId]))[0].id;
  const log = await owner.req("GET", `/api/alerts/${alertId}/deliveries`);
  assert.equal(log.status, 200);
  assert.equal(log.body.deliveries[0].status, "enviado");
  assert.ok(log.body.deliveries[0].sentAt);
  // isolation: another organisation cannot read this log
  assert.equal((await other.req("GET", `/api/alerts/${alertId}/deliveries`)).status, 404);
});

test("send errors are retried with backoff, then marked as failure after 5 attempts", async () => {
  const { setMailerForTests } = await import("../../server/services/account-links");
  const { processDeliveries, MAX_ATTEMPTS, backoffMinutes } = await import("../../server/services/notifications");
  // a new alert on a new day for the same property
  await q(`UPDATE alerts SET status = 'resolvido', is_resolved = true WHERE area_id = $1`, [areaId]);
  await q(`DELETE FROM satellite_hotspots WHERE satellite = 'TESTE'`);
  const { evaluateHotspotAlerts } = await import("../../server/services/hotspot-alerts");
  await hotspot("n3");
  assert.equal((await evaluateHotspotAlerts({ windowHours: 24 })).alertsCreated, 1);
  setMailerForTests({ sendMail: async () => { throw new Error("535 autenticação recusada"); } } as any);
  let now = new Date();
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const p = await processDeliveries({ now });
    assert.equal(p.claimed, 1, `tentativa ${i}`);
    const [d] = await q(`SELECT status, attempts, next_attempt_at FROM notification_deliveries WHERE status <> 'enviado'`);
    assert.equal(d.attempts, i);
    if (i < MAX_ATTEMPTS) {
      assert.equal(d.status, "pendente");
      const wait = (new Date(d.next_attempt_at).getTime() - now.getTime()) / 60_000;
      assert.ok(Math.abs(wait - backoffMinutes(i)) < 0.1, `espera ${wait} min`);
      assert.equal((await processDeliveries({ now })).claimed, 0, "not retried before the backoff");
      now = new Date(d.next_attempt_at);
    } else {
      assert.equal(d.status, "falha");
    }
  }
  const [last] = await q(`SELECT last_error FROM notification_deliveries WHERE status = 'falha'`);
  assert.match(last.last_error, /535/);
  assert.equal((await q(`SELECT count(*)::int AS n FROM notification_deliveries d JOIN users u ON u.id = d.user_id WHERE u.email = 'outra@test.dev'`))[0].n, 0, "opted-out user never queued");
});
