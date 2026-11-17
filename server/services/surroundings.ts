/**
 * What is happening in and around a monitored property, from stored real data:
 *   - INPE satellite hotspots (OBSERVED detections, not confirmed fires)
 *   - Sisfogo ROIs (OFFICIAL records of fires attended by Prevfogo/aderentes)
 *   - the organisation's own imported occurrences
 * Distances are to the property boundary (0 = inside) or, without a boundary,
 * to its point. Several hotspots can be the same fire; nothing is summed across sources.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { inpeFreshness } from "../connectors/inpe";
import { distanceToBoundaryKm, haversineKm, bbox, type BoundaryGeom, type Position } from "@shared/geometry";
import type { MonitoredArea } from "@shared/schema";

export interface SurroundingsOptions { radiusKm: number; days: number }

export function areaShape(a: MonitoredArea): { kind: "poligono" | "ponto"; distance: (p: Position) => number; box: { minLng: number; minLat: number; maxLng: number; maxLat: number } } | null {
  if (a.boundary) {
    const g = a.boundary as BoundaryGeom;
    return { kind: "poligono", distance: (p) => distanceToBoundaryKm(p, g), box: bbox(g) };
  }
  if (a.latitude != null && a.longitude != null) {
    const c: Position = [a.longitude, a.latitude];
    return { kind: "ponto", distance: (p) => haversineKm(c, p), box: { minLng: c[0], maxLng: c[0], minLat: c[1], maxLat: c[1] } };
  }
  return null;
}

export function expandBox(box: { minLng: number; minLat: number; maxLng: number; maxLat: number }, km: number) {
  const dLat = km / 110.574;
  const midLat = (box.minLat + box.maxLat) / 2;
  const dLng = km / (111.32 * Math.max(Math.cos((midLat * Math.PI) / 180), 0.05));
  return { minLng: box.minLng - dLng, maxLng: box.maxLng + dLng, minLat: box.minLat - dLat, maxLat: box.maxLat + dLat };
}

const iso = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

export async function areaSurroundings(orgId: number, a: MonitoredArea, opts: SurroundingsOptions) {
  const shape = areaShape(a);
  if (!shape) return null;
  const b = expandBox(shape.box, opts.radiusKm);
  const round = (d: number) => Math.round(d * 100) / 100;

  // INPE hotspots (observed by satellite)
  const hs = await db.execute<{ id: number; detectedAt: string; satellite: string; latitude: number; longitude: number; frpMw: number | null; municipality: string | null }>(sql`
    SELECT id, ${iso("detected_at")} AS "detectedAt", satellite, latitude, longitude, frp_mw AS "frpMw", municipality
    FROM satellite_hotspots
    WHERE detected_at >= now() - make_interval(days => ${opts.days})
      AND latitude BETWEEN ${b.minLat} AND ${b.maxLat} AND longitude BETWEEN ${b.minLng} AND ${b.maxLng}
    ORDER BY detected_at DESC LIMIT 20000`);
  const hotspots = hs.rows
    .map((h) => ({ ...h, distanceKm: round(shape.distance([h.longitude, h.latitude])) }))
    .filter((h) => h.distanceKm <= opts.radiusKm);
  const fresh = await inpeFreshness();

  // Sisfogo official records
  const ro = await db.execute<{ id: number; roiNumber: string; startedAt: string | null; latitude: number; longitude: number; burnedAreaHa: number | null; municipality: string | null }>(sql`
    SELECT f.id, f.source_reference AS "roiNumber", ${iso("f.occurred_at")} AS "startedAt", f.latitude, f.longitude, f.affected_area AS "burnedAreaHa", f.municipality
    FROM fire_occurrences f JOIN data_sources s ON s.id = f.data_source_id
    WHERE s.key = 'sisfogo-roi' AND f.organization_id IS NULL AND f.source_available AND f.latitude IS NOT NULL
      AND f.latitude BETWEEN ${b.minLat} AND ${b.maxLat} AND f.longitude BETWEEN ${b.minLng} AND ${b.maxLng}
    ORDER BY f.occurred_at DESC NULLS LAST LIMIT 5000`);
  const official = ro.rows
    .map((r) => ({ ...r, distanceKm: round(shape.distance([r.longitude, r.latitude])) }))
    .filter((r) => r.distanceKm <= opts.radiusKm);
  const [sisSync] = (await db.execute<{ at: string | null }>(sql`
    SELECT ${iso("max(r.finished_at)")} AS at FROM source_sync_runs r JOIN data_sources s ON s.id = r.source_id
    WHERE s.key = 'sisfogo-roi' AND r.status = 'sucesso'`)).rows;

  // The organisation's own imported records (never other organisations')
  const im = await db.execute<{ latitude: number; longitude: number; occurredOn: string | null }>(sql`
    SELECT latitude, longitude, occurred_on::text AS "occurredOn" FROM fire_occurrences
    WHERE organization_id = ${orgId} AND latitude IS NOT NULL
      AND latitude BETWEEN ${b.minLat} AND ${b.maxLat} AND longitude BETWEEN ${b.minLng} AND ${b.maxLng} LIMIT 20000`);
  const imported = im.rows.filter((r) => shape.distance([r.longitude, r.latitude]) <= opts.radiusKm);

  const within = (rows: { distanceKm: number }[], km: number) => rows.filter((r) => r.distanceKm <= km).length;
  return {
    reference: { kind: shape.kind, radiusKm: opts.radiusKm, days: opts.days },
    hotspots: {
      nature: "observado",
      note: "Detecções térmicas por satélite (INPE). Não são incêndios confirmados; o mesmo fogo pode gerar várias detecções.",
      lastSyncAt: fresh.lastSuccessAt, fresh: fresh.fresh,
      counts: { inside: within(hotspots, 0), km1: within(hotspots, 1), km5: within(hotspots, 5), radius: hotspots.length },
      nearestKm: hotspots.length ? Math.min(...hotspots.map((h) => h.distanceKm)) : null,
      latestAt: hotspots[0]?.detectedAt ?? null,
      satellites: Array.from(new Set(hotspots.map((h) => h.satellite))).sort(),
      items: hotspots.slice(0, 2000),
    },
    official: {
      nature: "registro_oficial",
      note: "Registros de Ocorrência de Incêndio finalizados (Ibama/Prevfogo — Sisfogo). Cobrem apenas os órgãos aderentes; área queimada é estimativa informada no registro.",
      lastSyncAt: sisSync?.at ?? null,
      counts: { inside: within(official, 0), radius: official.length },
      byYear: Object.entries(official.reduce<Record<string, number>>((m, r) => { const y = r.startedAt?.slice(0, 4) ?? "?"; m[y] = (m[y] ?? 0) + 1; return m; }, {}))
        .map(([year, n]) => ({ year, n })).sort((x, y) => x.year.localeCompare(y.year)),
      items: official.slice(0, 500),
    },
    imported: {
      nature: "informado_pela_organizacao",
      note: "Ocorrências históricas importadas pela sua organização.",
      count: imported.length,
    },
  };
}
