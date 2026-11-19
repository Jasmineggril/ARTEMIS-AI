/**
 * Load the OFFICIAL municipal boundaries of Brazil from IBGE (API de malhas v3)
 * into municipality_boundaries. Idempotent (upsert by IBGE code), one transaction.
 *
 *   npm run db:load-boundaries                      -> qualidade=intermediaria (default)
 *   npm run db:load-boundaries -- --quality minima  -> lighter, more simplified polygons
 *
 * Source: https://servicodados.ibge.gov.br/api/docs/malhas?versao=3
 * The polygons are IBGE's generalised meshes (SIRGAS 2000, lon/lat), adequate
 * for "which municipality is this point in" and for maps; not cadastral limits.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { municipalityBoundaries } from "../shared/schema";
import { areaHa, bbox, centroid, polygons, type BoundaryGeom } from "../shared/geometry";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

export function featureToRow(f: any, quality: string, url: string) {
  const code = String(f?.properties?.codarea ?? "");
  if (!/^\d{7}$/.test(code)) throw new Error(`código IBGE inválido: ${code}`);
  const g = f?.geometry as BoundaryGeom;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) throw new Error(`${code}: geometria ${g?.type ?? "ausente"}`);
  for (const poly of polygons(g)) for (const ring of poly) {
    if (ring.length < 4) throw new Error(`${code}: anel com menos de 4 vértices`);
    for (const [x, y] of ring) if (!Number.isFinite(x) || !Number.isFinite(y) || x < -75 || x > -28 || y < -35 || y > 6) throw new Error(`${code}: coordenada fora do Brasil (${x}, ${y})`);
  }
  const b = bbox(g);
  const [cx, cy] = centroid(g);
  return { ibgeCode: code, boundary: g, minLat: b.minLat, maxLat: b.maxLat, minLng: b.minLng, maxLng: b.maxLng,
    centroidLat: cy, centroidLng: cx, areaKm2: Math.round(areaHa(g)) / 100, quality, source: "IBGE — API de malhas v3", sourceUrl: url };
}

async function main() {
  const quality = arg("quality") ?? "intermediaria";
  if (!["minima", "intermediaria", "maxima"].includes(quality)) throw new Error("--quality minima|intermediaria|maxima");
  const url = `https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=municipio&formato=application/vnd.geo%2Bjson&qualidade=${quality}`;
  let json: any = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 300_000);
      const r = await fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
      if (!r.ok) throw new Error(`IBGE HTTP ${r.status}`);
      json = await r.json(); break;
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 3000 * 3 ** (attempt - 1)));
    }
  }
  const features: any[] = json?.features ?? [];
  if (features.length < 5000) throw new Error(`Resposta do IBGE com ${features.length} municípios (esperado ~5 570). Nada foi gravado.`);
  const rows: ReturnType<typeof featureToRow>[] = [];
  const rejected: string[] = [];
  for (const f of features) { try { rows.push(featureToRow(f, quality, url)); } catch (e) { rejected.push((e as Error).message); } }
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 200) {
      await tx.insert(municipalityBoundaries).values(rows.slice(i, i + 200)).onConflictDoUpdate({
        target: municipalityBoundaries.ibgeCode,
        set: { boundary: sql`excluded.boundary`, minLat: sql`excluded.min_lat`, maxLat: sql`excluded.max_lat`, minLng: sql`excluded.min_lng`, maxLng: sql`excluded.max_lng`,
          centroidLat: sql`excluded.centroid_lat`, centroidLng: sql`excluded.centroid_lng`, areaKm2: sql`excluded.area_km2`, quality: sql`excluded.quality`,
          sourceUrl: sql`excluded.source_url`, loadedAt: sql`now()` },
      });
    }
  });
  const [{ missing }] = (await db.execute<{ missing: number }>(sql`
    SELECT count(*)::int AS missing FROM municipalities m WHERE NOT EXISTS (SELECT 1 FROM municipality_boundaries b WHERE b.ibge_code = m.ibge_code)`)).rows;
  console.log(JSON.stringify({ source: "ibge-malhas", quality, received: features.length, stored: rows.length, rejected: rejected.length, rejectedSample: rejected.slice(0, 5), municipalitiesWithoutBoundary: missing }));
}

if (/load-(ibge-)?boundaries/.test(process.argv[1] ?? "")) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool?.end());
}
