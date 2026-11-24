/**
 * Which municipality (official IBGE boundary, migration 0016) contains a point.
 * PostGIS: GiST bbox filter (&&) + ST_Covers; the 3 IBGE polygons with
 * self-intersections are repaired on the fly with ST_MakeValid. Fallback:
 * bbox columns + exact point-in-polygon (shared/geometry.ts).
 * Returns null when boundaries are not loaded or the point is outside Brazil.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { hasPostgisGeom } from "../spatial";
import { pointInBoundary, type BoundaryGeom } from "@shared/geometry";

export interface MunicipalityHit { ibgeCode: string; name: string; state: string; method: "postgis" | "poligono" }

let geomCol: { at: number; ok: boolean } | null = null;
async function boundaryGeom(): Promise<boolean> {
  if (geomCol && Date.now() - geomCol.at < 300_000) return geomCol.ok;
  const r = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'municipality_boundaries' AND column_name = 'geom' LIMIT 1`);
  geomCol = { at: Date.now(), ok: r.rows.length > 0 };
  return geomCol.ok;
}

export async function municipalityAt(lat: number, lng: number): Promise<MunicipalityHit | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (process.env.SPATIAL_FORCE_FALLBACK !== "true" && (await hasPostgisGeom()) && (await boundaryGeom())) {
    const r = await db.execute<{ ibgeCode: string; name: string; state: string }>(sql`
      WITH p AS (SELECT ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326) AS g)
      SELECT b.ibge_code AS "ibgeCode", m.name, m.state FROM municipality_boundaries b JOIN municipalities m USING (ibge_code), p
      WHERE b.geom && p.g AND ST_Covers(CASE WHEN ST_IsValid(b.geom) THEN b.geom ELSE ST_MakeValid(b.geom) END, p.g)
      ORDER BY b.area_km2 LIMIT 1`);
    const h = r.rows[0];
    return h ? { ...h, method: "postgis" } : null;
  }
  const cands = await db.execute<{ ibgeCode: string; name: string; state: string; boundary: BoundaryGeom }>(sql`
    SELECT b.ibge_code AS "ibgeCode", m.name, m.state, b.boundary FROM municipality_boundaries b JOIN municipalities m USING (ibge_code)
    WHERE ${lat} BETWEEN b.min_lat AND b.max_lat AND ${lng} BETWEEN b.min_lng AND b.max_lng ORDER BY b.area_km2`);
  const h = cands.rows.find((c) => pointInBoundary([lng, lat], c.boundary));
  return h ? { ibgeCode: h.ibgeCode, name: h.name, state: h.state, method: "poligono" } : null;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Compares the municipality/UF the user declared with the official boundary at the point. */
export async function checkDeclaredMunicipality(lat: number, lng: number, declared: { municipality?: string | null; state?: string | null }) {
  const hit = await municipalityAt(lat, lng);
  if (!hit) return { status: "indisponivel" as const, official: null, message: "Limites municipais oficiais não carregados ou ponto fora do Brasil." };
  const sameUf = !declared.state || declared.state.toUpperCase() === hit.state;
  const sameName = !declared.municipality || norm(declared.municipality) === norm(hit.name);
  return sameUf && sameName
    ? { status: "confere" as const, official: hit, message: `Localização dentro de ${hit.name}/${hit.state} (limite oficial IBGE).` }
    : { status: "diverge" as const, official: hit, message: `A localização fica em ${hit.name}/${hit.state} pelo limite oficial do IBGE, mas o cadastro informa ${declared.municipality ?? "—"}/${declared.state ?? "—"}.` };
}
