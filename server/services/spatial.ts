/**
 * Spatial queries "points near a monitored area", done in the database.
 *
 *  - With PostGIS (migration 0008 created `geom geography` + GiST indexes):
 *    ST_DWithin on the indexed column filters in the database and ST_Distance
 *    gives the geodesic distance to the boundary (0 inside the polygon).
 *  - Without PostGIS: bounding-box prefilter in SQL (btree on lat/lng) and the
 *    exact distance in TypeScript (shared/geometry.ts). Same results within
 *    0.5 % (verified by tests/integration/spatial.test.ts).
 *
 * The mode in use is reported (`spatialMode()`) so results can say how they
 * were computed. Inputs are always passed as bound parameters.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { hasPostgisGeom, resetSpatialCache } from "../spatial";
import { areaShape, expandBox } from "./surroundings";
import type { MonitoredArea } from "@shared/schema";

export type SpatialMode = "postgis" | "haversine";

/** Reuses the PostGIS detector of server/spatial.ts (geom columns of migration 0008). */
export async function spatialMode(): Promise<SpatialMode> {
  if (process.env.SPATIAL_FORCE_FALLBACK === "true") return "haversine";
  return (await hasPostgisGeom()) ? "postgis" : "haversine";
}
export function resetSpatialModeCache() { resetSpatialCache(); }

/** The area as a PostGIS geography: its boundary polygon, or its point. */
function areaGeography(a: MonitoredArea): SQL | null {
  if (a.boundary) return sql`ST_GeomFromGeoJSON(${JSON.stringify(a.boundary)})::geography`;
  if (a.latitude != null && a.longitude != null) return sql`ST_SetSRID(ST_MakePoint(${a.longitude}, ${a.latitude}), 4326)::geography`;
  return null;
}

const round2 = (d: number) => Math.round(d * 100) / 100;

export interface NearQuery {
  /** Table holding the points (both have latitude/longitude and, with PostGIS, geom). */
  table: "satellite_hotspots" | "fire_occurrences";
  /** Extra SQL condition on alias `t` (always parameterised). */
  where: SQL;
  radiusKm: number;
  /** Columns to return, on alias `t`. Must include latitude and longitude. */
  columns: SQL;
  orderBy?: SQL;
  limit: number;
}

/**
 * Rows of `table` within `radiusKm` of the area, each with `distanceKm`
 * (0 = inside the polygon). Returns null when the area has no geometry.
 */
export async function pointsNearArea<T extends { latitude: number; longitude: number }>(
  area: MonitoredArea, q: NearQuery,
): Promise<{ mode: SpatialMode; rows: (T & { distanceKm: number })[] } | null> {
  const shape = areaShape(area);
  if (!shape) return null;
  const mode = await spatialMode();
  const table = sql.raw(q.table);
  const order = q.orderBy ?? sql`1`;
  if (mode === "postgis") {
    const g = areaGeography(area)!;
    const res = await db.execute<T & { distanceKm: number }>(sql`
      WITH a AS (SELECT ${g} AS g)
      SELECT ${q.columns}, round((ST_Distance(t.geom, a.g) / 1000)::numeric, 2)::float8 AS "distanceKm"
      FROM ${table} t, a
      WHERE t.geom IS NOT NULL AND ST_DWithin(t.geom, a.g, ${q.radiusKm * 1000}) AND ${q.where}
      ORDER BY ${order} LIMIT ${q.limit}`);
    return { mode, rows: res.rows.map((r) => ({ ...r, distanceKm: Number(r.distanceKm) })) as (T & { distanceKm: number })[] };
  }
  const b = expandBox(shape.box, q.radiusKm);
  const res = await db.execute<T>(sql`
    SELECT ${q.columns} FROM ${table} t
    WHERE t.latitude BETWEEN ${b.minLat} AND ${b.maxLat} AND t.longitude BETWEEN ${b.minLng} AND ${b.maxLng} AND ${q.where}
    ORDER BY ${order} LIMIT ${q.limit * 4}`);
  const rows = res.rows
    .map((r) => ({ ...r, distanceKm: round2(shape.distance([r.longitude, r.latitude])) }))
    .filter((r) => r.distanceKm <= q.radiusKm)
    .slice(0, q.limit) as (T & { distanceKm: number })[];
  return { mode, rows };
}
