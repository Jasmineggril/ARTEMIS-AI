/**
 * Historical fire occurrences around a point, for the risk engine's
 * `historicalOccurrences` input. Two clearly separated sources:
 *
 *   1. the organisation's OWN imported records (organization_id = org);
 *   2. official public Sisfogo ROIs (organization_id IS NULL, data_source = sisfogo-roi),
 *      only when enabled (RISK_USE_SISFOGO, default on) AND the integration is
 *      operational (at least one complete real sync).
 *
 * Never reads another organisation's rows. An official ROI the organisation
 * already imported itself (same ROI number, or same date within 1 km) is not
 * counted twice. INPE hotspots are NOT counted here: they feed the separate
 * "nearby hotspot" input, and a hotspot and a ROI may be the same fire.
 *
 * The engine's weights and thresholds are unchanged; only the input count can
 * now include official records. Every analysis stores the breakdown.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { SISFOGO_SOURCE_KEY } from "../connectors/sisfogo";

export const HISTORY_RADIUS_KM = 10;
const DUPLICATE_KM = 1;

export interface HistoryContext {
  radiusKm: number;
  orgCount: number;
  officialCount: number;
  duplicatesExcluded: number;
  officialIncluded: boolean;
  /** Why official records were not considered (when officialIncluded is false). */
  officialReason: string | null;
  officialLastCompleteAt: Date | null;
  officialRange: { first: string; last: string } | null;
  total: number;
}

const haversine = (latCol: string, lngCol: string) => `2 * 6371 * asin(sqrt(power(sin(radians(${latCol} - $LAT) / 2), 2) + cos(radians($LAT)) * cos(radians(${latCol})) * power(sin(radians(${lngCol} - $LNG) / 2), 2)))`;

export function officialRecordsEnabled(): boolean {
  return (process.env.RISK_USE_SISFOGO ?? "true").toLowerCase() !== "false";
}

export async function historyContext(orgId: number, latitude: number, longitude: number, radiusKm = HISTORY_RADIUS_KM): Promise<HistoryContext> {
  // Coordinates are interpolated as numeric literals below: refuse anything else.
  if (![latitude, longitude, radiusKm].every(Number.isFinite)) throw new Error("Coordenadas inválidas.");
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));
  const dist = (t: string) => sql.raw(haversine(`${t}.latitude`, `${t}.longitude`).replaceAll("$LAT", String(latitude)).replaceAll("$LNG", String(longitude)));
  const box = (t: string) => sql`${sql.raw(t)}.latitude BETWEEN ${latitude - dLat} AND ${latitude + dLat} AND ${sql.raw(t)}.longitude BETWEEN ${longitude - dLng} AND ${longitude + dLng}`;

  const own = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM fire_occurrences o
    WHERE o.organization_id = ${orgId} AND o.latitude IS NOT NULL AND ${box("o")} AND ${dist("o")} <= ${radiusKm}`);
  const orgCount = Number(own.rows[0]?.n ?? 0);

  const base: Omit<HistoryContext, "officialIncluded" | "officialReason" | "total"> = {
    radiusKm, orgCount, officialCount: 0, duplicatesExcluded: 0, officialLastCompleteAt: null, officialRange: null,
  };
  if (!officialRecordsEnabled()) {
    return { ...base, officialIncluded: false, officialReason: "desativado na configuração (RISK_USE_SISFOGO=false)", total: orgCount };
  }

  const complete = await db.execute<{ at: Date | null }>(sql`
    SELECT max(r.finished_at) AS at FROM source_sync_runs r JOIN data_sources s ON s.id = r.source_id
    WHERE s.key = ${SISFOGO_SOURCE_KEY} AND r.status = 'sucesso'
      AND r.params->>'mode' = 'completa' AND r.progress->>'stoppedBecause' = 'fim_da_lista'`);
  const lastComplete = complete.rows[0]?.at ? new Date(complete.rows[0].at) : null;
  if (!lastComplete) {
    return { ...base, officialIncluded: false, officialReason: "Sisfogo ainda sem sincronização completa", total: orgCount };
  }

  const official = await db.execute<{ n: number; dup: number; first: string | null; last: string | null }>(sql`
    WITH near AS (
      SELECT f.id, f.occurred_on, f.latitude, f.longitude, f.source_reference
      FROM fire_occurrences f JOIN data_sources s ON s.id = f.data_source_id
      WHERE s.key = ${SISFOGO_SOURCE_KEY} AND f.organization_id IS NULL AND f.source_available
        AND f.latitude IS NOT NULL AND ${box("f")} AND ${dist("f")} <= ${radiusKm}
    ), flagged AS (
      SELECT n.*, EXISTS (
        SELECT 1 FROM fire_occurrences o
        WHERE o.organization_id = ${orgId}
          AND (o.source_reference = n.source_reference
            OR (o.occurred_on = n.occurred_on AND o.latitude IS NOT NULL
                AND 2 * 6371 * asin(sqrt(power(sin(radians(o.latitude - n.latitude) / 2), 2) + cos(radians(n.latitude)) * cos(radians(o.latitude)) * power(sin(radians(o.longitude - n.longitude) / 2), 2))) <= ${DUPLICATE_KM}))
      ) AS dup
      FROM near n
    )
    SELECT count(*) FILTER (WHERE NOT dup)::int AS n, count(*) FILTER (WHERE dup)::int AS dup,
           min(occurred_on) FILTER (WHERE NOT dup)::text AS first, max(occurred_on) FILTER (WHERE NOT dup)::text AS last
    FROM flagged`);
  const o = official.rows[0];
  const officialCount = Number(o?.n ?? 0);
  return {
    ...base,
    officialCount,
    duplicatesExcluded: Number(o?.dup ?? 0),
    officialIncluded: true,
    officialReason: null,
    officialLastCompleteAt: lastComplete,
    officialRange: o?.first && o?.last ? { first: o.first, last: o.last } : null,
    total: orgCount + officialCount,
  };
}
