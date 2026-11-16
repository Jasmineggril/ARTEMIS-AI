/**
 * Detects whether PostGIS geography columns are available (migration 0008).
 * Cached for 5 minutes so enabling PostGIS later is picked up without restart.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

let cache: { at: number; value: boolean } | null = null;

export async function hasPostgisGeom(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 300_000) return cache.value;
  try {
    const r = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'satellite_hotspots' AND column_name = 'geom' LIMIT 1`);
    cache = { at: Date.now(), value: r.rows.length > 0 };
  } catch {
    cache = { at: Date.now(), value: false };
  }
  return cache.value;
}

export function resetSpatialCache() {
  cache = null;
}
