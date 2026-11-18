/**
 * Geospatial correctness on a REAL PostgreSQL: the PostGIS path (ST_DWithin +
 * ST_Distance on GiST-indexed geography) and the fallback path (bbox + exact
 * TypeScript distance) must select the same points and agree on distances.
 * Also checks that the PostGIS query actually uses the GiST index.
 *
 * Needs TEST_SUPERUSER_URL (to CREATE EXTENSION postgis in the test database);
 * without it, only the fallback path runs. Own database (suffix "_spatial").
 * The points are a CONTROLLED set with known expected answers (not real data).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const BASE = process.env.TEST_DATABASE_URL;
if (!BASE || !/test/i.test(new URL(BASE).pathname)) { console.error("TEST_DATABASE_URL ausente ou sem 'test'."); process.exit(1); }
const DB_NAME = `${new URL(BASE).pathname.slice(1)}_spatial`;
const withDb = (u: string, name: string) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString(); };
const DB_URL = withDb(BASE, DB_NAME);
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";
const SU = process.env.TEST_SUPERUSER_URL;

let c: pg.Client;
let close: () => Promise<void>;
// Square property of ~1 km side near Alto Paraíso de Goiás (lng, lat).
const d = 0.009;
const square = { type: "Polygon", coordinates: [[[-47.51, -14.13], [-47.51 + d, -14.13], [-47.51 + d, -14.13 + d], [-47.51, -14.13 + d], [-47.51, -14.13]]] };
const area: any = { id: 1, boundary: square, latitude: -14.1255, longitude: -47.5055 };
const pointArea: any = { id: 2, boundary: null, latitude: -14.1255, longitude: -47.5055 };

// Controlled points (distances on the R = 6371 km sphere): inside, 1 km, 4.9 km, 5.1 km, 20 km, and one far away.
const pts: [string, number, number][] = [
  ["dentro", -14.1255, -47.5055],
  ["1km_leste", -14.1255, -47.51 + d + 0.00927],
  ["4_9km_norte", -14.13 + d + 0.04407, -47.5055],
  ["5_1km_norte", -14.13 + d + 0.04587, -47.5055],
  ["20km_sul", -14.13 - 0.1809, -47.5055],
  ["longe", -3.1, -60.0],
];

before(async () => {
  const a = new pg.Client({ connectionString: withDb(BASE!, "postgres") });
  await a.connect(); await a.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); await a.query(`CREATE DATABASE "${DB_NAME}"`); await a.end();
  if (SU) { const s = new pg.Client({ connectionString: withDb(SU, DB_NAME) }); await s.connect(); await s.query("CREATE EXTENSION IF NOT EXISTS postgis"); await s.end(); }
  const origLog = console.log; console.log = (...x: unknown[]) => { if (process.env.TEST_VERBOSE) origLog(...x); };
  const { runMigrations } = await import("../../server/migrate"); await runMigrations();
  c = new pg.Client({ connectionString: DB_URL }); await c.connect();
  const [{ id: src }] = (await c.query(`SELECT id FROM data_sources WHERE key = 'inpe-queimadas'`)).rows;
  for (const [name, lat, lng] of pts) {
    await c.query(`INSERT INTO satellite_hotspots (source_id, external_id, satellite, detected_at, latitude, longitude) VALUES ($1, $2, 'TESTE', now() - interval '1 hour', $3, $4)`, [src, `teste-${name}`, lat, lng]);
  }
  const { pool } = await import("../../server/db");
  close = async () => { await c.end(); await pool?.end(); console.log = origLog; };
});
after(async () => { await close?.(); });

async function near(a: any, radiusKm: number, force: boolean) {
  const { pointsNearArea, resetSpatialModeCache } = await import("../../server/services/spatial");
  const { sql } = await import("drizzle-orm");
  process.env.SPATIAL_FORCE_FALLBACK = force ? "true" : "false";
  resetSpatialModeCache();
  const r = await pointsNearArea<{ externalId: string; latitude: number; longitude: number }>(a, {
    table: "satellite_hotspots", radiusKm, limit: 100,
    columns: sql`t.external_id AS "externalId", t.latitude, t.longitude`,
    where: sql`t.satellite = 'TESTE'`, orderBy: sql`t.external_id`,
  });
  return r!;
}
const names = (r: { rows: { externalId: string }[] }) => r.rows.map((x) => x.externalId.replace("teste-", "")).sort();

test("fallback: polygon distance is to the boundary (0 inside) and the 5 km limit is respected", async () => {
  const r = await near(area, 5, true);
  assert.equal(r.mode, "haversine");
  assert.deepEqual(names(r), ["1km_leste", "4_9km_norte", "dentro"]);
  const byName = Object.fromEntries(r.rows.map((x) => [x.externalId.replace("teste-", ""), x.distanceKm]));
  assert.equal(byName.dentro, 0);
  assert.ok(Math.abs(byName["1km_leste"] - 1) < 0.05, `1 km → ${byName["1km_leste"]}`);
  assert.ok(Math.abs(byName["4_9km_norte"] - 4.9) < 0.05, `4.9 km → ${byName["4_9km_norte"]}`);
});

test("PostGIS: same points and distances as the fallback (within 1 %: PostGIS uses the WGS84 spheroid, the fallback a sphere), polygon and point areas", { skip: !SU && "TEST_SUPERUSER_URL não definido" }, async () => {
  for (const [a, km] of [[area, 5], [area, 25], [pointArea, 5], [pointArea, 25]] as const) {
    const pg_ = await near(a, km, false), fb = await near(a, km, true);
    assert.equal(pg_.mode, "postgis");
    assert.deepEqual(names(pg_), names(fb), `raio ${km} km, ${a.boundary ? "polígono" : "ponto"}`);
    for (const x of pg_.rows) {
      const y = fb.rows.find((z) => z.externalId === x.externalId)!;
      const tol = Math.max(0.01, y.distanceKm * 0.01);
      assert.ok(Math.abs(x.distanceKm - y.distanceKm) <= tol, `${x.externalId}: postgis ${x.distanceKm} × fallback ${y.distanceKm}`);
    }
  }
});

test("PostGIS: the ST_DWithin query uses the GiST index on a large table", { skip: !SU && "TEST_SUPERUSER_URL não definido" }, async () => {
  const [{ id: src }] = (await c.query(`SELECT id FROM data_sources WHERE key = 'inpe-queimadas'`)).rows;
  // 50 000 controlled points spread over Brazil, so the planner prefers the index.
  await c.query(`INSERT INTO satellite_hotspots (source_id, external_id, satellite, detected_at, latitude, longitude)
    SELECT $1, 'volume-' || g, 'VOLUME', now() - (g % 72) * interval '1 hour', -33 + (g % 3800) * 0.01, -73 + (g / 3800.0) * 3.3
    FROM generate_series(1, 50000) g`, [src]);
  await c.query("ANALYZE satellite_hotspots");
  const plan = (await c.query(`EXPLAIN SELECT id FROM satellite_hotspots t
    WHERE ST_DWithin(t.geom, ST_GeomFromGeoJSON($1)::geography, 5000)`, [JSON.stringify(square)])).rows.map((r) => r["QUERY PLAN"]).join("\n");
  assert.match(plan, /satellite_hotspots_geom_gix/, plan);
});
