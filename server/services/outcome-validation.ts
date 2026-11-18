/**
 * Retrospective check of analyses and alerts against LATER, INDEPENDENT
 * observations (evidence of verifiable results, TRL 7–9):
 *
 *   analyses  for each analysis whose follow-up window has ended: did INPE detect a
 *             hotspot, or did the Sisfogo publish a ROI, within R km of the property
 *             in the next W days? Rates are grouped by risk level. If the index is
 *             informative, higher levels should be followed by events more often.
 *             Analyses made while a hotspot was already nearby are reported apart:
 *             persistence of an ongoing fire would otherwise inflate the result.
 *   alerts    hotspot alerts later matched by an official Sisfogo ROI (lower bound of
 *             "a fire was attended"), and expert verdicts (pertinent / partly / not).
 *
 * This is NOT a calibrated accuracy: the Sisfogo covers only adherent agencies and a
 * hotspot is not a confirmed fire. The report states sample sizes and these limits.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { monitoredAreas, type MonitoredArea } from "@shared/schema";
import { areaShape } from "./surroundings";
import { pointsNearArea } from "./spatial";

export interface OutcomeOptions { from: Date; to: Date; windowDays: number; radiusKm: number; organizationId?: number }
const LEVELS = ["baixo", "moderado", "alto", "crítico"] as const;

interface Row { level: string; n: number; withHotspot: number; withRoi: number }
const empty = (): Record<string, Row> => Object.fromEntries(LEVELS.map((l) => [l, { level: l, n: 0, withHotspot: 0, withRoi: 0 }]));

export async function evaluateOutcomes(o: OutcomeOptions) {
  const until = new Date(Math.min(o.to.getTime(), Date.now() - o.windowDays * 86_400_000)); // only closed windows
  const analyses = (await db.execute<{ id: number; areaId: number; level: string; createdAt: Date | string; nearby: boolean | null }>(sql`
    SELECT a.id, a.area_id AS "areaId", a.level, a.created_at AS "createdAt", (a.input_data->>'nearbyHotspot')::boolean AS nearby
    FROM risk_analyses a
    WHERE a.created_at >= ${o.from} AND a.created_at <= ${until} AND a.area_id IS NOT NULL
      ${o.organizationId ? sql`AND a.organization_id = ${o.organizationId}` : sql``}
    ORDER BY a.created_at LIMIT 5000`)).rows;

  const areaIds = Array.from(new Set(analyses.map((a) => a.areaId)));
  const areas = new Map<number, MonitoredArea>();
  if (areaIds.length) {
    for (const a of await db.select().from(monitoredAreas).where(sql`${monitoredAreas.id} IN (${sql.join(areaIds.map((i) => sql`${i}`), sql`, `)})`)) areas.set(a.id, a);
  }

  const all = empty();
  const clean = empty(); // no hotspot nearby at analysis time
  let skipped = 0;
  for (const a of analyses) {
    const area = areas.get(a.areaId);
    const shape = area ? areaShape(area) : null;
    if (!shape || !(a.level in all)) { skipped++; continue; }
    const start = new Date(a.createdAt);
    const end = new Date(start.getTime() + o.windowDays * 86_400_000);
    const hs = await pointsNearArea<{ latitude: number; longitude: number }>(area!, {
      table: "satellite_hotspots", radiusKm: o.radiusKm, limit: 1, columns: sql`t.latitude, t.longitude`,
      where: sql`t.detected_at > ${start} AND t.detected_at <= ${end}`,
    });
    const ro = await pointsNearArea<{ latitude: number; longitude: number }>(area!, {
      table: "fire_occurrences", radiusKm: o.radiusKm, limit: 1, columns: sql`t.latitude, t.longitude`,
      where: sql`t.organization_id IS NULL AND t.occurred_at > ${start} AND t.occurred_at <= ${end}
        AND t.data_source_id = (SELECT id FROM data_sources WHERE key = 'sisfogo-roi')`,
    });
    const hit = (q: typeof hs) => (q?.rows.length ?? 0) > 0;
    const h = hit(hs), r = hit(ro);
    for (const t of a.nearby ? [all] : [all, clean]) {
      t[a.level].n++;
      if (h) t[a.level].withHotspot++;
      if (r) t[a.level].withRoi++;
    }
  }
  const rate = (x: number, n: number) => (n ? Math.round((x / n) * 1000) / 10 : null);
  const table = (t: Record<string, Row>) => LEVELS.map((l) => ({ ...t[l], hotspotRatePct: rate(t[l].withHotspot, t[l].n), roiRatePct: rate(t[l].withRoi, t[l].n) }));

  // Alerts: official confirmation and expert verdicts
  const [al] = (await db.execute<{ total: number; hotspotTotal: number; matched: number; evaluated: number; pertinent: number; partial: number; notPertinent: number }>(sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE a.kind = 'foco_proximo')::int AS "hotspotTotal",
      count(*) FILTER (WHERE a.kind = 'foco_proximo' AND EXISTS (
        SELECT 1 FROM fire_occurrences f JOIN data_sources s ON s.id = f.data_source_id
        WHERE s.key = 'sisfogo-roi' AND f.organization_id IS NULL
          AND f.occurred_at BETWEEN a.created_at - interval '2 days' AND a.created_at + make_interval(days => ${o.windowDays})
          AND f.latitude BETWEEN (a.evidence->'detections'->0->>'lat')::float8 - ${o.radiusKm / 110.574} AND (a.evidence->'detections'->0->>'lat')::float8 + ${o.radiusKm / 110.574}
          AND f.longitude BETWEEN (a.evidence->'detections'->0->>'lng')::float8 - ${o.radiusKm / 100} AND (a.evidence->'detections'->0->>'lng')::float8 + ${o.radiusKm / 100}
      ))::int AS matched,
      count(a.evaluation)::int AS evaluated,
      count(*) FILTER (WHERE a.evaluation = 'pertinente')::int AS pertinent,
      count(*) FILTER (WHERE a.evaluation = 'parcialmente_pertinente')::int AS partial,
      count(*) FILTER (WHERE a.evaluation = 'nao_pertinente')::int AS "notPertinent"
    FROM alerts a
    WHERE NOT a.is_demo AND a.created_at >= ${o.from} AND a.created_at <= ${o.to}
      ${o.organizationId ? sql`AND a.organization_id = ${o.organizationId}` : sql``}`)).rows;
  const [riskAlerts] = (await db.execute<{ evaluated: number; pertinent: number }>(sql`
    SELECT count(evaluation)::int AS evaluated, count(*) FILTER (WHERE evaluation = 'pertinente')::int AS pertinent
    FROM alerts WHERE NOT is_demo AND kind = 'risco' AND created_at >= ${o.from} AND created_at <= ${o.to}
      ${o.organizationId ? sql`AND organization_id = ${o.organizationId}` : sql``}`)).rows;

  return {
    period: { from: o.from.toISOString(), to: o.to.toISOString(), evaluatedUntil: until.toISOString() },
    method: { windowDays: o.windowDays, radiusKm: o.radiusKm },
    analyses: { total: analyses.length - skipped, skippedWithoutGeometry: skipped, byLevel: table(all), withoutNearbyHotspotAtAnalysis: table(clean) },
    alerts: {
      total: al?.total ?? 0,
      hotspotAlerts: al?.hotspotTotal ?? 0,
      hotspotAlertsMatchedBySisfogo: al?.matched ?? 0,
      evaluated: al?.evaluated ?? 0,
      pertinent: al?.pertinent ?? 0, partiallyPertinent: al?.partial ?? 0, notPertinent: al?.notPertinent ?? 0,
      pertinentPct: al?.evaluated ? Math.round(((al.pertinent) / al.evaluated) * 1000) / 10 : null,
      riskAlertsEvaluated: riskAlerts?.evaluated ?? 0, riskAlertsPertinent: riskAlerts?.pertinent ?? 0,
    },
    limits: [
      "Foco de calor é detecção por satélite, não incêndio confirmado; o Sisfogo cobre apenas órgãos aderentes.",
      "Só entram análises cuja janela de acompanhamento já terminou.",
      "Taxas com poucas análises por nível não têm significância estatística; veja o número de casos (n).",
      "Não é uma acurácia calibrada do modelo.",
    ],
  };
}
