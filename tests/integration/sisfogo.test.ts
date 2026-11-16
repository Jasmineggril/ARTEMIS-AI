/**
 * Sisfogo synchronisation against a REAL PostgreSQL database and a stubbed
 * Sisfogo API built from real ROIs (tests/fixtures/sisfogo-roi-real.json).
 * Uses its own database derived from TEST_DATABASE_URL (suffix "_sisfogo"),
 * DROPPED and recreated on every run.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { roi, servePages } from "../fixtures/sisfogo";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE || !/test/i.test(new URL(BASE).pathname)) {
  console.error("TEST_DATABASE_URL ausente ou sem 'test' no nome — testes não executados.");
  process.exit(1);
}
const DB_NAME = `${new URL(BASE).pathname.slice(1)}_sisfogo`;
const DB_URL = (() => { const x = new URL(BASE); x.pathname = `/${DB_NAME}`; return x.toString(); })();
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_DISABLED = "true";
process.env.PYTHON_SERVICE_URL = "http://127.0.0.1:9";

const FAST = { intervalMs: 0, retry: { sleep: async () => {}, baseDelayMs: 1, timeoutMs: 200, attempts: 2 }, log: () => {} };
let base = "";
let close: () => Promise<void>;
let c: pg.Client;
let S: typeof import("../../server/services/sisfogo-sync");
let deps: typeof import("../../server/sisfogo-routes").sisfogoRouteDeps;
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
}
const owner = new Client();
const admin = new Client();
const anon = new Client();

before(async () => {
  const a = new pg.Client({ connectionString: (() => { const x = new URL(BASE!); x.pathname = "/postgres"; return x.toString(); })() });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await a.query(`CREATE DATABASE "${DB_NAME}"`);
  await a.end();
  // Optional PostGIS path (extension created by a superuser, as in the Docker init script).
  if (process.env.TEST_SUPERUSER_URL) {
    const su = new pg.Client({ connectionString: (() => { const x = new URL(process.env.TEST_SUPERUSER_URL!); x.pathname = `/${DB_NAME}`; return x.toString(); })() });
    await su.connect();
    await su.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await su.end();
  }
  const origLog = console.log;
  console.log = (...args: unknown[]) => { if (process.env.TEST_VERBOSE) origLog(...args); };
  const { runMigrations } = await import("../../server/migrate");
  await runMigrations();
  S = await import("../../server/services/sisfogo-sync");
  deps = (await import("../../server/sisfogo-routes")).sisfogoRouteDeps;
  const { createApp } = await import("../../server/app");
  const { httpServer } = await createApp();
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  const { pool } = await import("../../server/db");
  close = async () => {
    await c.end();
    await new Promise((r) => httpServer.close(() => r(null)));
    await pool?.end();
    console.log = origLog;
  };

  for (const [cl, email, org] of [[owner, "dona@test.dev", "Cooperativa Isolada"], [admin, "admin@test.dev", "Plataforma"]] as const) {
    const r = await cl.post("/api/auth/signup", { name: "Pessoa Teste", email, password: "senhaForte1", organizationName: org, organizationType: "produtor", acceptPrivacy: true });
    assert.equal(r.status, 201);
  }
  await q(`UPDATE users SET role = 'platform_admin' WHERE email = 'admin@test.dev'`);
});
after(async () => close?.());

const sync = (pages: unknown[][], extra: Parameters<typeof S.syncSisfogo>[0] = {}) =>
  S.syncSisfogo({ ...FAST, mode: "completa", fetchJson: servePages(pages) as any, ...extra });
const occ = (ext: string) => q(`SELECT * FROM fire_occurrences WHERE external_id = $1`, [ext]).then((r) => r[0]);
const id = (n: number) => roi(n).id as string;

test("unreachable API: retried, run recorded as failed, nothing written", async () => {
  let calls = 0;
  const r = await S.syncSisfogo({ ...FAST, fetchJson: async () => { calls++; return { status: 503, retryAfter: null, json: null }; } });
  assert.equal(r.status, "falha");
  assert.match(r.error!, /indisponível após 2 tentativas \(HTTP 503/);
  assert.equal(calls, 2);
  const [run] = await q(`SELECT status, error, trigger FROM source_sync_runs ORDER BY id DESC LIMIT 1`);
  assert.deepEqual([run.status, run.trigger], ["falha", "cli"]);
  assert.equal((await q(`SELECT count(*)::int n FROM fire_occurrences`))[0].n, 0);
});

test("unexpected response shape fails loudly, naming the fields received", async () => {
  const r = await S.syncSisfogo({ ...FAST, fetchJson: async () => ({ status: 200, retryAfter: null, json: { content: [], totalElements: 0 } }) });
  assert.equal(r.status, "falha");
  assert.match(r.error!, /fora do contrato.*content, totalElements/);
  const [src] = await q(`SELECT status FROM data_sources WHERE key = 'sisfogo-roi'`);
  assert.equal(src.status, "em integração", "not operational before a complete real sync");
});

test("first complete sync: official rows land in fire_occurrences with explicit provenance", async () => {
  const p1 = [roi(1), roi(2), roi(90, { statusRoi: "EM_RETIFICACAO" }), roi(2)];
  const p2 = [roi(3), roi(4, { localIncendio: { latitude: undefined, longitude: undefined } })];
  const r = await sync([p1, p2]);
  assert.equal(r.status, "sucesso");
  assert.deepEqual([r.pages, r.read, r.inserted, r.updated, r.rectified, r.unchanged, r.rejected], [2, 6, 4, 0, 0, 0, 2]);
  assert.deepEqual(r.rejectionReasons, { status_nao_finalizado: 1, repetido_na_pagina: 1 });
  assert.equal(r.stoppedBecause, "fim_da_lista");

  const o = await occ(id(1));
  assert.equal(o.organization_id, null);
  assert.equal(o.import_batch_id, null);
  assert.equal(o.source, "Sisfogo (Ibama/Prevfogo)");
  assert.equal(o.source_reference, "ROI.TESTE.1");
  assert.equal(o.occurrence_type, "incêndio (ROI)");
  assert.equal(o.source_available, true);
  assert.equal(new Date(o.occurred_at).toISOString(), new Date(roi(1).datasIncendio.dataInicioIncendio).toISOString());
  assert.equal(o.raw_data, null, "original JSON lives in the mirror/revisions, not duplicated");
  const noCoords = await occ(id(4));
  assert.equal(noCoords.latitude, null, "missing coordinates stay NULL, not 0");

  const [m] = await q(`SELECT revision, institution_acronym, started_at, extinguished_at, content_hash FROM sisfogo_roi_records WHERE external_id = $1`, [id(1)]);
  assert.equal(m.revision, 1);
  assert.equal(m.institution_acronym, "PREVFOGO");
  assert.ok(m.content_hash);
  assert.equal((await q(`SELECT count(*)::int n FROM source_record_revisions WHERE change_kind = 'novo'`))[0].n, 4);

  const [src] = await q(`SELECT status, integration_status FROM data_sources WHERE key = 'sisfogo-roi'`);
  assert.equal(src.status, "ativo");
  assert.match(src.integration_status, /^operacional — sincronização completa em/);
});

test("re-import is idempotent: nothing inserted, no new revisions", async () => {
  const r = await sync([[roi(1), roi(2)], [roi(3), roi(4, { localIncendio: { latitude: undefined, longitude: undefined } })]]);
  assert.deepEqual([r.inserted, r.updated, r.rectified, r.unchanged, r.unavailable], [0, 0, 0, 4, 0]);
  assert.equal((await q(`SELECT count(*)::int n FROM fire_occurrences`))[0].n, 4);
  assert.equal((await q(`SELECT count(*)::int n FROM source_record_revisions`))[0].n, 4);
});

const unchanged4 = () => roi(4, { localIncendio: { latitude: undefined, longitude: undefined } });

test("rectified ROI: new revision kept, previous version preserved, occurrence updated", async () => {
  const fixed = roi(2, { retificado: true, informacoesPosIncendio: { estimativaAreaQueimada: 77.5 } });
  const changed = roi(3, { retificado: false, houveCombate: false });
  const r = await sync([[roi(1), fixed], [changed, unchanged4()]]);
  assert.deepEqual([r.inserted, r.rectified, r.updated, r.unchanged], [0, 1, 1, 2]);
  const revs = await q(`SELECT revision, change_kind, (raw::jsonb #>> '{informacoesPosIncendio,estimativaAreaQueimada}')::float AS area FROM source_record_revisions WHERE external_id = $1 ORDER BY revision`, [id(2)]);
  assert.deepEqual(revs.map((x) => [x.revision, x.change_kind]), [[1, "novo"], [2, "retificado"]]);
  assert.equal(revs[1].area, 77.5);
  assert.notEqual(revs[0].area, 77.5, "the original published version is still there");
  assert.equal((await occ(id(2))).affected_area, 77.5);
  const [run] = await q(`SELECT records_updated, records_rectified FROM source_sync_runs ORDER BY id DESC LIMIT 1`);
  assert.deepEqual([run.records_updated, run.records_rectified], [2, 1]);
});

test("ROI missing from a complete run is flagged unavailable (never deleted) and comes back", async () => {
  const fixed = roi(2, { retificado: true, informacoesPosIncendio: { estimativaAreaQueimada: 77.5 } });
  const changed = roi(3, { retificado: false, houveCombate: false });
  const gone = await sync([[roi(1), fixed], [changed]]);
  assert.equal(gone.unavailable, 1);
  assert.equal((await occ(id(4))).source_available, false);
  assert.ok((await q(`SELECT unavailable_since FROM sisfogo_roi_records WHERE external_id = $1`, [id(4)]))[0].unavailable_since);
  assert.equal((await q(`SELECT count(*)::int n FROM v_fire_events WHERE origem = 'registro_oficial'`))[0].n, 3, "unavailable record left out of the combined view");
  assert.equal((await anon.get("/api/public/sisfogo/summary")).body.total, 3);

  const back = await sync([[roi(1), fixed], [changed, unchanged4()]]);
  assert.equal(back.unavailable, 0);
  assert.equal((await occ(id(4))).source_available, true);
  assert.equal((await anon.get("/api/public/sisfogo/summary")).body.total, 4);
});

test("a source glitch (most ROIs missing) does not flag anything unavailable", async () => {
  const fixed = roi(2, { retificado: true, informacoesPosIncendio: { estimativaAreaQueimada: 77.5 } });
  const changed = roi(3, { retificado: false, houveCombate: false });
  const more = Array.from({ length: 10 }, (_, i) => roi(50 + i));
  const all = await sync([[roi(1), fixed], [changed, unchanged4()], more]);
  assert.deepEqual([all.inserted, all.unavailable], [10, 0]);
  const r = await sync([[roi(1)]]);
  assert.equal(r.status, "sucesso");
  assert.equal(r.unavailable, 0);
  const [run] = await q(`SELECT progress FROM source_sync_runs ORDER BY id DESC LIMIT 1`);
  assert.match(run.progress.note, /13 de 14 ROIs ausentes.*nada foi marcado/);
  assert.equal((await q(`SELECT count(*)::int n FROM fire_occurrences WHERE source_available = false`))[0].n, 0);
});

test("incremental mode stops after consecutive pages with nothing new; limits are honoured", async () => {
  const fixed = roi(2, { retificado: true, informacoesPosIncendio: { estimativaAreaQueimada: 77.5 } });
  const changed = roi(3, { retificado: false, houveCombate: false });
  const pages = [[roi(10)], [roi(1)], [fixed], [changed], [roi(11)]];
  const r = await sync(pages, { mode: "incremental" });
  assert.equal(r.stoppedBecause, "sem_novidades");
  assert.deepEqual([r.pages, r.inserted], [3, 1], "page 1 new, pages 2-3 quiet → stop; roi 11 not reached");
  const lim = await sync(pages, { mode: "incremental", maxPages: 1 });
  assert.equal(lim.stoppedBecause, "limite_de_paginas");
  const rec = await sync(pages, { mode: "completa", maxRecords: 2 });
  assert.equal(rec.stoppedBecause, "limite_de_registros");
  assert.equal(rec.unavailable, 0, "a limited run never flags unavailability");
});

test("failure mid-run keeps stored pages; --resume continues after the last stored page", async () => {
  let fail = true;
  const real = servePages([[roi(20)], [roi(21)], [roi(22)]]);
  const flaky = async (url: string, signal: AbortSignal) => {
    if (fail && new URL(url).searchParams.get("page") === "2") return { status: 502, retryAfter: null, json: null };
    return real(url);
  };
  const r = await S.syncSisfogo({ ...FAST, mode: "completa", fetchJson: flaky as any });
  assert.equal(r.status, "falha");
  assert.match(r.error!, /Páginas 1–1 já gravadas; use --resume/);
  assert.ok(await occ(id(20)));
  assert.equal(await occ(id(21)), undefined);
  const [run] = await q(`SELECT progress FROM source_sync_runs ORDER BY id DESC LIMIT 1`);
  assert.equal(run.progress.lastPage, 1);
  assert.equal(run.progress.failedPage, 2);

  fail = false;
  const resumed = await S.syncSisfogo({ ...FAST, mode: "completa", resume: true, fetchJson: flaky as any });
  assert.equal(resumed.status, "sucesso");
  assert.equal(resumed.startPage, 2);
  assert.ok(real.calls.slice(-2).every((u) => /page=[23]/.test(u)), "page 1 not fetched again");
  assert.ok(await occ(id(22)));
  assert.equal(resumed.unavailable, 0, "a resumed run cannot judge availability");
});

test("a page is all-or-nothing: an error inside the page transaction rolls everything back", async () => {
  const { db } = await import("../../server/db");
  const [{ id: srcId }] = await q(`SELECT id FROM data_sources WHERE key = 'sisfogo-roi'`);
  const [{ id: runId }] = await q(`INSERT INTO source_sync_runs (source_id, status) VALUES ($1, 'sucesso') RETURNING id`, [srcId]);
  await assert.rejects(db.transaction(async (tx) => {
    await S.persistPage(tx, [roi(30), roi(31)], srcId, runId, new Set());
    throw new Error("falha simulada depois de gravar a página");
  }), /falha simulada/);
  assert.equal(await occ(id(30)), undefined);
  assert.equal((await q(`SELECT count(*)::int n FROM sisfogo_roi_records WHERE external_id IN ($1, $2)`, [id(30), id(31)]))[0].n, 0);
  assert.equal((await q(`SELECT count(*)::int n FROM source_record_revisions WHERE external_id = $1`, [id(30)]))[0].n, 0);
});

test("only one sync at a time (advisory lock); a crashed run is closed by the next one", async () => {
  const other = new pg.Client({ connectionString: DB_URL });
  await other.connect();
  await other.query(`SELECT pg_advisory_lock(hashtext('artemis:sync:sisfogo-roi'))`);
  await assert.rejects(sync([[roi(1)]]), S.SisfogoBusyError);
  deps.syncOptions = { ...FAST, fetchJson: servePages([[roi(1)]]) as any };
  assert.equal((await admin.post("/api/admin/connectors/sisfogo/sync", { mode: "incremental" })).status, 409);
  await other.query(`SELECT pg_advisory_unlock(hashtext('artemis:sync:sisfogo-roi'))`);
  await other.end();

  const [{ id: srcId }] = await q(`SELECT id FROM data_sources WHERE key = 'sisfogo-roi'`);
  const [{ id: stale }] = await q(`INSERT INTO source_sync_runs (source_id, status) VALUES ($1, 'em_execucao') RETURNING id`, [srcId]);
  await sync([[roi(1)]], { mode: "incremental" });
  const [s] = await q(`SELECT status, error FROM source_sync_runs WHERE id = $1`, [stale]);
  assert.equal(s.status, "falha");
  assert.match(s.error, /Interrompida/);
});

test("organisation isolation: official rows never appear in an organisation's data or published imports", async () => {
  const mine = await owner.get("/api/fire-occurrences");
  assert.equal(mine.status, 200);
  assert.ok(Array.isArray(mine.body));
  assert.equal(mine.body.length, 0, "an organisation sees only its own imports");
  assert.ok((await q(`SELECT count(*)::int n FROM fire_occurrences WHERE organization_id IS NULL`))[0].n >= 14, "…while official rows do exist");
  const dash = await owner.get("/api/dashboard/summary");
  assert.equal(dash.body.occurrences.total, 0);
  const pub = await anon.get("/api/public/summary");
  assert.equal(pub.body.total, 0, "public lookup of published imports is a separate dataset");
  // the provenance CHECK forbids an org row without a batch, or an official row with an org
  await assert.rejects(q(`INSERT INTO fire_occurrences (organization_id, import_batch_id, data_source_id, external_id) VALUES (1, NULL, 1, 'x')`), /provenance_ck/);
  await assert.rejects(q(`INSERT INTO fire_occurrences (organization_id, import_batch_id, data_source_id, external_id) VALUES (NULL, NULL, NULL, NULL)`), /provenance_ck/);
});

test("status and manual sync endpoints: auth, platform-admin only, audited, no raw data", async () => {
  assert.equal((await anon.get("/api/connectors/sisfogo/status")).status, 401);
  const st = await owner.get("/api/connectors/sisfogo/status");
  assert.equal(st.status, 200);
  assert.equal(st.body.operational, true);
  assert.ok(st.body.counts.total >= 14);
  assert.ok(st.body.runs.length >= 1);
  assert.ok(!JSON.stringify(st.body).includes("localIncendio"), "no raw ROI JSON in the status payload");

  assert.equal((await anon.post("/api/admin/connectors/sisfogo/sync", {})).status, 401);
  assert.equal((await owner.post("/api/admin/connectors/sisfogo/sync", {})).status, 403, "organisation owner is not a platform admin");
  assert.equal((await admin.post("/api/admin/connectors/sisfogo/sync", { mode: "tudo" })).status, 400);
  deps.syncOptions = { ...FAST, fetchJson: servePages([[roi(40)]]) as any };
  const started = await admin.post("/api/admin/connectors/sisfogo/sync", { mode: "incremental" });
  assert.equal(started.status, 202);
  for (let i = 0; i < 50 && !(await occ(id(40))); i++) await new Promise((r) => setTimeout(r, 50));
  const [run] = await q(`SELECT status, trigger, triggered_by FROM source_sync_runs WHERE id = $1`, [started.body.runId]);
  for (let i = 0; i < 50 && run.status === "em_execucao"; i++) await new Promise((r) => setTimeout(r, 50));
  const [done] = await q(`SELECT r.status, r.trigger, u.email FROM source_sync_runs r JOIN users u ON u.id = r.triggered_by WHERE r.id = $1`, [started.body.runId]);
  assert.deepEqual([done.status, done.trigger, done.email], ["sucesso", "manual", "admin@test.dev"]);
  const [log] = await q(`SELECT action, entity_id FROM audit_logs WHERE action = 'sisfogo.sync.iniciada' ORDER BY id DESC LIMIT 1`);
  assert.equal(log.entity_id, String(started.body.runId));
});

test("public summary: filters, Brasília dates, no free-text place names", async () => {
  const s = await anon.get("/api/public/sisfogo/summary");
  assert.equal(s.status, 200);
  assert.ok(s.body.total >= 4);
  assert.ok(s.body.lastCompleteSyncAt);
  assert.match(s.body.timeNote, /horário de Brasília/);
  assert.ok(!JSON.stringify(s.body).includes("anonimizado"), "nomeLocal/subTipo never exposed");
  assert.equal((await anon.get("/api/public/sisfogo/summary?state=XX")).status, 400);
  assert.equal((await anon.get("/api/public/sisfogo/summary?state=SP")).body.total, 0);
});

test("risk analysis: nearby official ROIs counted with provenance; own imports not double counted; switchable", async () => {
  const ref = roi(1).localIncendio;
  const area = await owner.post("/api/areas", {
    name: "Área perto dos ROIs", operationType: "propriedade_rural", municipality: "Teste", state: roi(1).localIncendio.municipio.unidadeFederativa.siglaUnidadeFederativa,
    latitude: ref.latitude + 0.01, longitude: ref.longitude, areaHectares: 100, vegetationCategory: "Vegetação nativa",
  });
  assert.equal(area.status, 201);
  const near = (await q(`SELECT count(*)::int n FROM fire_occurrences WHERE organization_id IS NULL AND source_available AND latitude IS NOT NULL`))[0].n;
  assert.ok(near >= 10);
  const inputs = { temperature: 30, humidity: 40, windSpeed: 10, recentRainfall: 0, vegetationCondition: "dry", nearbyHotspot: false };
  const sources = async (analysisId: number) => q(`SELECT source_key, record_count, detail FROM risk_analysis_sources WHERE analysis_id = $1 ORDER BY source_key`, [analysisId]);

  const a1 = await owner.post(`/api/areas/${area.body.id}/analyses`, { inputs });
  assert.equal(a1.status, 201);
  let s = await sources(a1.body.id);
  const sis = s.find((x) => x.source_key === "sisfogo-roi");
  assert.ok(sis, "Sisfogo listed as a source of the analysis");
  assert.equal(sis.record_count, near);
  assert.equal(sis.detail.radiusKm, 10);
  assert.equal(s.find((x) => x.source_key === "fire_occurrences").record_count, 0);
  const [stored] = await q(`SELECT limitations, data_sources FROM risk_analyses WHERE id = $1`, [a1.body.id]);
  assert.ok(JSON.stringify(stored.limitations).includes(`${near} ROI(s) oficial(is) do Sisfogo`));

  // the organisation imports one of those ROIs itself → it counts once (as its own record)
  const [{ id: orgId }] = await q(`SELECT organization_id AS id FROM monitored_areas WHERE id = $1`, [area.body.id]);
  const [{ id: batchId }] = await q(`INSERT INTO import_batches (organization_id, filename, source_name, source_type, total_rows, valid_rows) VALUES ($1, 'roi.csv', 'Exportação Sisfogo', 'csv', 1, 1) RETURNING id`, [orgId]);
  await q(`INSERT INTO fire_occurrences (import_batch_id, organization_id, occurrence_date, latitude, longitude, source_reference) VALUES ($1, $2, '2026-01-01', $3, $4, 'ROI.TESTE.1')`, [batchId, orgId, ref.latitude, ref.longitude]);
  const a2 = await owner.post(`/api/areas/${area.body.id}/analyses`, { inputs });
  s = await sources(a2.body.id);
  assert.equal(s.find((x) => x.source_key === "fire_occurrences").record_count, 1);
  assert.equal(s.find((x) => x.source_key === "sisfogo-roi").record_count, near - 1);
  assert.equal(s.find((x) => x.source_key === "sisfogo-roi").detail.duplicatesExcluded, 1);

  // another organisation's private records are never read
  const [{ id: otherOrg }] = await q(`SELECT o.id FROM organizations o JOIN organization_members m ON m.organization_id = o.id JOIN users u ON u.id = m.user_id WHERE u.email = 'admin@test.dev'`);
  const [{ id: otherBatch }] = await q(`INSERT INTO import_batches (organization_id, filename, source_name, source_type, total_rows, valid_rows) VALUES ($1, 'x.csv', 'x', 'csv', 1, 1) RETURNING id`, [otherOrg]);
  await q(`INSERT INTO fire_occurrences (import_batch_id, organization_id, occurrence_date, latitude, longitude) VALUES ($1, $2, '2025-05-05', $3, $4)`, [otherBatch, otherOrg, ref.latitude, ref.longitude]);
  const a3 = await owner.post(`/api/areas/${area.body.id}/analyses`, { inputs });
  s = await sources(a3.body.id);
  assert.equal(s.find((x) => x.source_key === "fire_occurrences").record_count, 1, "other organisation's record not counted");

  // switch off
  process.env.RISK_USE_SISFOGO = "false";
  try {
    const a4 = await owner.post(`/api/areas/${area.body.id}/analyses`, { inputs });
    s = await sources(a4.body.id);
    assert.equal(s.find((x) => x.source_key === "sisfogo-roi"), undefined);
    assert.equal(s.find((x) => x.source_key === "fire_occurrences").detail.officialReason, "desativado na configuração (RISK_USE_SISFOGO=false)");
  } finally {
    delete process.env.RISK_USE_SISFOGO;
  }
});

test("map layer endpoint: bbox (PostGIS or lat/lng), pagination, locality filter, no place names", async () => {
  const ref = roi(1).localIncendio;
  const box = (d: number) => [ref.longitude - d, ref.latitude - d, ref.longitude + d, ref.latitude + d].join(",");
  const all = await anon.get(`/api/public/sisfogo/points?bbox=${box(0.5)}`);
  assert.equal(all.status, 200);
  assert.ok(all.body.total >= 10);
  assert.ok(all.body.points.every((p: any) => Math.abs(p.latitude - ref.latitude) <= 0.5));
  assert.match(all.body.points[0].startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "strict ISO-8601 UTC");
  assert.ok(!JSON.stringify(all.body).includes("anonimizado"), "nomeLocal never returned");
  const far = await anon.get("/api/public/sisfogo/points?bbox=-50,-30,-49,-29");
  assert.equal(far.body.total, 0);
  const p1 = await anon.get(`/api/public/sisfogo/points?bbox=${box(0.5)}&limit=3&offset=0`);
  const p2 = await anon.get(`/api/public/sisfogo/points?bbox=${box(0.5)}&limit=3&offset=3`);
  assert.equal(p1.body.points.length, 3);
  assert.equal(p1.body.truncated, true);
  assert.equal(new Set([...p1.body.points, ...p2.body.points].map((p: any) => p.id)).size, 6, "pages do not overlap");
  const type = all.body.localityTypes[0];
  assert.ok(type);
  const typed = await anon.get(`/api/public/sisfogo/points?localityType=${encodeURIComponent(type)}`);
  assert.ok(typed.body.points.every((p: any) => p.localityType === type));
  for (const bad of ["bbox=1,2,3", "bbox=10,0,5,1", "bbox=a,b,c,d", "limit=99999", "state=XX"]) {
    assert.equal((await anon.get(`/api/public/sisfogo/points?${bad}`)).status, 400, bad);
  }
});
