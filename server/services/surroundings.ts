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
import { pointsNearArea } from "./spatial";

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

  // INPE hotspots (observed by satellite)
  const hs = await pointsNearArea<{ id: number; detectedAt: string; satellite: string; latitude: number; longitude: number; frpMw: number | null; municipality: string | null }>(a, {
    table: "satellite_hotspots", radiusKm: opts.radiusKm, limit: 20000,
    columns: sql`t.id, ${iso("t.detected_at")} AS "detectedAt", t.satellite, t.latitude, t.longitude, t.frp_mw AS "frpMw", t.municipality`,
    where: sql`t.detected_at >= now() - make_interval(days => ${opts.days})`,
    orderBy: sql`t.detected_at DESC`,
  });
  const hotspots = hs!.rows;
  const fresh = await inpeFreshness();

  // Sisfogo official records
  const ro = await pointsNearArea<{ id: number; roiNumber: string; startedAt: string | null; latitude: number; longitude: number; burnedAreaHa: number | null; municipality: string | null }>(a, {
    table: "fire_occurrences", radiusKm: opts.radiusKm, limit: 5000,
    columns: sql`t.id, t.source_reference AS "roiNumber", ${iso("t.occurred_at")} AS "startedAt", t.latitude, t.longitude, t.affected_area AS "burnedAreaHa", t.municipality`,
    where: sql`t.organization_id IS NULL AND t.source_available AND t.latitude IS NOT NULL
      AND t.data_source_id = (SELECT id FROM data_sources WHERE key = 'sisfogo-roi')`,
    orderBy: sql`t.occurred_at DESC NULLS LAST`,
  });
  const official = ro!.rows;
  const [sisSync] = (await db.execute<{ at: string | null }>(sql`
    SELECT ${iso("max(r.finished_at)")} AS at FROM source_sync_runs r JOIN data_sources s ON s.id = r.source_id
    WHERE s.key = 'sisfogo-roi' AND r.status = 'sucesso'`)).rows;

  // The organisation's own imported records (never other organisations')
  const im = await pointsNearArea<{ latitude: number; longitude: number; occurredOn: string | null }>(a, {
    table: "fire_occurrences", radiusKm: opts.radiusKm, limit: 20000,
    columns: sql`t.latitude, t.longitude, t.occurred_on::text AS "occurredOn"`,
    where: sql`t.organization_id = ${orgId} AND t.latitude IS NOT NULL`,
  });
  const imported = im!.rows;

  const within = (rows: { distanceKm: number }[], km: number) => rows.filter((r) => r.distanceKm <= km).length;
  return {
    reference: { kind: shape.kind, radiusKm: opts.radiusKm, days: opts.days, spatialMode: hs!.mode },
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
