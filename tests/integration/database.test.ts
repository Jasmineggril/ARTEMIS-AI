/**
 * ARTEMIS AI — database-level tests (migrations, integrity, generated columns,
 * connection failure). Uses its own database derived from TEST_DATABASE_URL
 * (suffix "_db"), which is DROPPED and recreated on every run.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import pg from "pg";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE || !/test/i.test(new URL(BASE).pathname)) {
  console.error("TEST_DATABASE_URL ausente ou sem 'test' no nome — testes não executados.");
  process.exit(1);
}
const u = new URL(BASE);
const DB_NAME = `${u.pathname.slice(1)}_db`;
const DB_URL = (() => { const x = new URL(BASE); x.pathname = `/${DB_NAME}`; return x.toString(); })();
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";

let c: pg.Client;
let migrate: (o?: { upTo?: string }) => Promise<string[]>;
const q = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows;

before(async () => {
  const admin = new pg.Client({ connectionString: (() => { const x = new URL(BASE); x.pathname = "/postgres"; return x.toString(); })() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${DB_NAME}"`);
  await admin.end();
  // Optional: a superuser creates PostGIS (as the Docker init script does), so
  // migration 0008 takes the geography path. Without it, those tests are skipped.
  if (process.env.TEST_SUPERUSER_URL) {
    const su = new pg.Client({ connectionString: (() => { const x = new URL(process.env.TEST_SUPERUSER_URL!); x.pathname = `/${DB_NAME}`; return x.toString(); })() });
    await su.connect();
    await su.query("CREATE EXTENSION IF NOT EXISTS postgis");
    await su.end();
  }
  const origLog = console.log;
  console.log = (...a: unknown[]) => { if (process.env.TEST_VERBOSE) origLog(...a); };
  ({ runMigrations: migrate } = await import("../../server/migrate"));
  c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
});

after(async () => {
  await c?.end();
  const { pool } = await import("../../server/db");
  await pool?.end();
});

test("0004 aborts and changes nothing when an orphan reading exists", async () => {
  await migrate({ upTo: "0003_public_batches.sql" });
  await q(`INSERT INTO readings (sensor_id, value, unit) VALUES (9999, 1, 'x')`);
  await assert.rejects(migrate({ upTo: "0004_integrity.sql" }), /leitura\(s\) sem sensor/);
  const applied = await q(`SELECT name FROM _drizzle_migrations ORDER BY id`);
  assert.equal(applied.at(-1).name, "0003_public_batches.sql", "0004 must not be recorded");
  const t = await q(`SELECT data_type FROM information_schema.columns WHERE table_name='users' AND column_name='created_at'`);
  assert.equal(t[0].data_type, "timestamp without time zone", "transaction rolled back: no type change");
  await q(`DELETE FROM readings WHERE sensor_id = 9999`); // test fixture cleanup only
});

test("0004/0005 preserve legacy rows, clear dangling nullable refs and keep instants", async () => {
  const [u1] = await q(`INSERT INTO users (email, password, name, created_at) VALUES ('legacy@test.dev','x','Legado', '2025-03-01 12:00:00') RETURNING id`);
  const [org] = await q(`INSERT INTO organizations (name, slug) VALUES ('Org Legada','org-legada') RETURNING id`);
  const [area] = await q(`INSERT INTO monitored_areas (name, operation_type, municipality, state, latitude, longitude, organization_id, created_by) VALUES ('Área L','outro','Goiás','GO',-15.9339871,-50.1404302,$1,$2) RETURNING id`, [org.id, u1.id]);
  await q(`INSERT INTO risk_analyses (area_id, score, level, organization_id) VALUES ($1, 60, 'alto', $2)`, [area.id, org.id]);
  await q(`INSERT INTO risk_analyses (area_id, score, level, organization_id) VALUES (424242, 10, 'baixo', $1)`, [org.id]); // dangling area
  await q(`INSERT INTO alerts (sensor_id, title, message, severity, organization_id) VALUES (777, 't', 'm', 'alto', $1)`, [org.id]); // dangling sensor
  const [b] = await q(`INSERT INTO import_batches (filename, organization_id, imported_by) VALUES ('f.csv', $1, $2) RETURNING id`, [org.id, u1.id]);
  await q(`INSERT INTO fire_occurrences (import_batch_id, organization_id, occurrence_date, occurrence_time, municipality, state, latitude, longitude) VALUES ($1,$2,'2025-08-10','14:30','Goiás','GO',-15.93,-50.14)`, [b.id, org.id]);

  await migrate();
  const applied = (await q(`SELECT name FROM _drizzle_migrations ORDER BY id`)).map((r) => r.name);
  assert.ok(applied.includes("0004_integrity.sql") && applied.includes("0005_occurrences_dedup_indexes.sql"));

  const [user] = await q(`SELECT extract(epoch from created_at)::bigint AS e FROM users WHERE id=$1`, [u1.id]);
  assert.equal(Number(user.e), Date.parse("2025-03-01T12:00:00Z") / 1000, "same instant, interpreted as UTC");
  const [a] = await q(`SELECT latitude FROM monitored_areas WHERE id=$1`, [area.id]);
  assert.ok(Math.abs(a.latitude - -15.9339871) < 1e-5, "coordinate preserved through float4 -> float8");
  const ras = await q(`SELECT area_id, area_snapshot FROM risk_analyses ORDER BY id`);
  assert.equal(ras[0].area_id, area.id);
  assert.equal(ras[0].area_snapshot.name, "Área L");
  assert.equal(ras[1].area_id, null, "dangling area cleared, row kept");
  assert.equal(ras[1].area_snapshot.deletedAreaId, 424242);
  const [al] = await q(`SELECT sensor_id FROM alerts`);
  assert.equal(al.sensor_id, null);
  const [o] = await q(`SELECT occurred_on::text AS d, occurred_hour AS h, dedup_key FROM fire_occurrences`);
  assert.deepEqual([o.d, o.h], ["2025-08-10", 14]);
  assert.match(o.dedup_key, /^[0-9a-f]{32}$/);
});

test("foreign keys enforce the documented delete rules", async () => {
  const [s] = await q(`INSERT INTO sensors (name, type, location) VALUES ('S1','t','l') RETURNING id`);
  await q(`INSERT INTO readings (sensor_id, value, unit) VALUES ($1, 1, 'C')`, [s.id]);
  await q(`DELETE FROM sensors WHERE id=$1`, [s.id]);
  assert.equal((await q(`SELECT count(*)::int n FROM readings WHERE sensor_id=$1`, [s.id]))[0].n, 0, "readings cascade");
  await assert.rejects(q(`INSERT INTO readings (sensor_id, value, unit) VALUES (31337, 1, 'C')`), /foreign key/);

  const [usr] = await q(`INSERT INTO users (email, password, name) VALUES ('fk@test.dev','x','FK') RETURNING id`);
  await q(`INSERT INTO denuncias (user_id, titulo, descricao, categoria) VALUES ($1,'t','descrição longa','c')`, [usr.id]);
  await q(`INSERT INTO user_stats (user_id) VALUES ($1)`, [usr.id]);
  await assert.rejects(q(`INSERT INTO user_stats (user_id) VALUES ($1)`, [usr.id]), /user_stats_user_uq/);
  await q(`DELETE FROM users WHERE id=$1`, [usr.id]);
  assert.equal((await q(`SELECT user_id FROM denuncias WHERE titulo='t'`))[0].user_id, null, "report kept, anonymised");
  assert.equal((await q(`SELECT count(*)::int n FROM user_stats WHERE user_id=$1`, [usr.id]))[0].n, 0);

  const [area] = await q(`SELECT id FROM monitored_areas LIMIT 1`);
  await q(`DELETE FROM monitored_areas WHERE id=$1`, [area.id]);
  const [ra] = await q(`SELECT area_id, area_snapshot FROM risk_analyses WHERE area_snapshot->>'name' = 'Área L'`);
  assert.equal(ra.area_id, null);
  assert.equal(ra.area_snapshot.name, "Área L", "analysis stays traceable after area deletion");
});

test("check constraints reject impossible values", async () => {
  await assert.rejects(q(`INSERT INTO sensors (name, type, location, latitude) VALUES ('x','t','l', 91)`), /sensors_coords_ck/);
  await assert.rejects(q(`INSERT INTO weather_data (latitude, longitude, humidity) VALUES (0, 0, 140)`), /weather_data_coords_ck/);
  const [b] = await q(`SELECT id, organization_id FROM import_batches LIMIT 1`);
  await assert.rejects(q(`INSERT INTO fire_occurrences (import_batch_id, organization_id, latitude) VALUES ($1,$2,-100)`, [b.id, b.organization_id]), /fire_occurrences_coords_ck/);
  await assert.rejects(q(`INSERT INTO risk_analyses (score, level) VALUES (101, 'crítico')`), /risk_analyses_score_ck/);
});

test("generated columns and per-organization de-duplication", async () => {
  const [b] = await q(`SELECT id, organization_id FROM import_batches LIMIT 1`);
  const ins = (org: number, date: string | null, time: string | null) =>
    q(`INSERT INTO fire_occurrences (import_batch_id, organization_id, occurrence_date, occurrence_time, municipality, state, latitude, longitude) VALUES ($1,$2,$3,$4,' Cavalcante ','go',-13.79712,-47.45678) RETURNING occurred_hour`, [b.id, org, date, time]);
  await ins(b.organization_id, "2025-09-01", "9h");
  await assert.rejects(ins(b.organization_id, "2025-09-01", "23:00"), /fire_occurrences_org_dedup_uq/, "same date/place/type = duplicate");
  const [other] = await q(`INSERT INTO organizations (name, slug) VALUES ('Outra','outra-org') RETURNING id`);
  const [b2] = await q(`INSERT INTO import_batches (filename, organization_id) VALUES ('g.csv',$1) RETURNING id`, [other.id]);
  await q(`INSERT INTO fire_occurrences (import_batch_id, organization_id, occurrence_date, municipality, state, latitude, longitude) VALUES ($1,$2,'2025-09-01',' Cavalcante ','go',-13.79712,-47.45678)`, [b2.id, other.id]);
  // unknown date never collides
  await ins(b.organization_id, null, null);
  await ins(b.organization_id, null, null);
  const times = ["07", "7:5", "24:00", "abc", "23h59"];
  const got: (number | null)[] = [];
  for (const [k, t] of times.entries()) {
    const [r] = await ins(b.organization_id, `2025-10-0${k + 1}`, t);
    got.push(r.occurred_hour);
  }
  assert.deepEqual(got, [7, 7, null, null, 23], "hour parsed only from valid 0–23 prefixes");
});

test("schema drift: every column declared in shared/schema.ts exists in the database with the declared type family", async () => {
  const schema = await import("../../shared/schema");
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const cols = await q(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'`);
  const db = new Map(cols.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type as string]));
  const family = (t: string) => t.replace(/ without time zone| with time zone/, "").replace(/character varying|character/, "text-ish");
  const problems: string[] = [];
  for (const v of Object.values(schema)) {
    if (!v || typeof v !== "object" || !(Symbol.for("drizzle:IsDrizzleTable") in (v as object))) continue;
    const cfg = getTableConfig(v as any);
    for (const col of cfg.columns) {
      const key = `${cfg.name}.${col.name}`;
      const actual = db.get(key);
      if (!actual) { problems.push(`ausente: ${key}`); continue; }
      const declared = col.getSQLType().toLowerCase();
      const ok =
        (declared.startsWith("timestamp") && actual === (declared.includes("with time zone") ? "timestamp with time zone" : "timestamp without time zone")) ||
        (declared === "double precision" && actual === "double precision") ||
        (declared === "serial" && actual === "integer") ||
        (declared === "bigserial" && actual === "bigint") ||
        (declared.endsWith("[]") && actual === "ARRAY") ||
        (declared.startsWith("char") && actual === "character") ||
        family(declared) === family(actual) || declared === actual;
      if (!ok) problems.push(`${key}: schema=${declared} banco=${actual}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("connection failure: API reports 503 and refuses writes, never falls back to memory", () => {
  const script = `
    process.env.DATABASE_URL = "postgresql://nobody:x@127.0.0.1:9/none";
    process.env.NODE_ENV = "test";
    const { createApp } = await import("./server/app.ts");
    const { httpServer } = await createApp();
    await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
    const base = "http://127.0.0.1:" + httpServer.address().port;
    const h = await fetch(base + "/api/health");
    const s = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ana", email: "ana@test.dev", password: "senhaForte1", acceptPrivacy: true }) });
    const body = await s.json();
    console.log("RESULT " + JSON.stringify({ health: h.status, signup: s.status, msg: body.message }));
    process.exit(0);`;
  const r = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 60_000, env: { ...process.env, RATE_LIMIT_DISABLED: "true" } });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
  assert.ok(line, `no result: ${r.stderr}`);
  const res = JSON.parse(line!.slice(7));
  assert.equal(res.health, 503);
  assert.equal(res.signup, 500);
  assert.equal(res.msg, "Erro interno. Tente novamente mais tarde.", "no internal details leaked");
});

const POSTGIS = Boolean(process.env.TEST_SUPERUSER_URL);

test("0008/0016/0018 add geography/geometry columns + GiST indexes when PostGIS exists", { skip: !POSTGIS && "TEST_SUPERUSER_URL não definido" }, async () => {
  const cols = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='geom' ORDER BY 1`);
  assert.deepEqual(cols.map((r) => r.table_name), ["fire_occurrences", "municipality_boundaries", "satellite_hotspots", "weather_stations"]);
  const idx = await q(`SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%gist%' AND indexname LIKE '%geom%' ORDER BY 1`);
  assert.equal(idx.length, 4);
});

test("PostGIS distance agrees with the haversine fallback (within 0.5%)", { skip: !POSTGIS && "TEST_SUPERUSER_URL não definido" }, async () => {
  const [src] = await q(`SELECT id FROM data_sources WHERE key='inpe-queimadas'`);
  const pts = [[-14.0, -47.0], [-14.05, -47.03], [-14.2, -47.4], [-15.79, -47.88]];
  for (const [i, [lat, lng]] of pts.entries()) {
    await q(`INSERT INTO satellite_hotspots (source_id, external_id, satellite, detected_at, latitude, longitude) VALUES ($1, $2, 'TESTE', now(), $3, $4)`, [src.id, `t${i}`, lat, lng]);
  }
  const rows = await q(`
    SELECT external_id,
      ST_Distance(geom, ST_SetSRID(ST_MakePoint(-47.0, -14.0), 4326)::geography) / 1000 AS gis_km,
      2 * 6371 * asin(sqrt(power(sin(radians(latitude - -14.0) / 2), 2) + cos(radians(-14.0)) * cos(radians(latitude)) * power(sin(radians(longitude - -47.0) / 2), 2))) AS hav_km
    FROM satellite_hotspots WHERE satellite = 'TESTE' ORDER BY external_id`);
  for (const r of rows.slice(1)) {
    const rel = Math.abs(r.gis_km - r.hav_km) / r.gis_km;
    assert.ok(rel < 0.005, `${r.external_id}: PostGIS ${r.gis_km.toFixed(3)} km vs haversine ${r.hav_km.toFixed(3)} km`);
  }
  const within = await q(`SELECT count(*)::int n FROM satellite_hotspots WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(-47.0, -14.0), 4326)::geography, 10000)`);
  assert.equal(within[0].n, 2, "ST_DWithin 10 km finds the 2 nearby detections");
  const plan = (await q(`EXPLAIN SELECT 1 FROM satellite_hotspots WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(-47.0, -14.0), 4326)::geography, 10000)`)).map((r) => r["QUERY PLAN"]).join(" ");
  assert.ok(/geom_gix|Seq Scan/.test(plan));
});
