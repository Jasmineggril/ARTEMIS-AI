/**
 * Alerts from DETECTED conditions: an INPE satellite hotspot inside a
 * monitored property or within its configured distance (hotspot_alert_km,
 * measured from the boundary, or from the point when there is no boundary).
 *
 * One open alert per property per local day: later detections the same day
 * update its evidence and occurrence count instead of creating new alerts.
 * A hotspot is a thermal detection, not a confirmed fire — the alert says so.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, alertEvents, monitoredAreas, type MonitoredArea } from "@shared/schema";
import type { RiskRecommendation } from "@shared/risk-engine";
import { areaShape, expandBox } from "./surroundings";
import { OPEN_STATUSES } from "./alert-service";

export interface HotspotAlertResult { areasChecked: number; alertsCreated: number; alertsUpdated: number; areasWithHotspots: number }

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

const RECOMMENDATIONS: RiskRecommendation[] = [
  { priority: "imediata", action: "Verificar no local (ou com vizinhos/brigada) se há fogo ativo.", rationale: "Foco de calor por satélite indica temperatura elevada, mas pode ser outra fonte de calor ou fogo já extinto." },
  { priority: "imediata", action: "Em caso de fogo, acionar o Corpo de Bombeiros (193) e a Defesa Civil (199).", rationale: "A ARTEMIS AI não substitui os serviços de emergência." },
  { priority: "urgente", action: "Revisar aceiros e o acesso de equipes à área.", rationale: "Detecção próxima ao limite da propriedade." },
];

export async function evaluateHotspotAlerts(opts: { windowHours?: number; now?: Date } = {}): Promise<HotspotAlertResult> {
  const windowHours = opts.windowHours ?? 24;
  const now = opts.now ?? new Date();
  const areas = await db.select().from(monitoredAreas)
    .where(and(sql`${monitoredAreas.organizationId} IS NOT NULL`, sql`${monitoredAreas.status} <> 'inativo'`));
  const out: HotspotAlertResult = { areasChecked: 0, alertsCreated: 0, alertsUpdated: 0, areasWithHotspots: 0 };

  for (const area of areas) {
    const shape = areaShape(area);
    if (!shape) continue;
    out.areasChecked++;
    const limitKm = area.hotspotAlertKm ?? 5;
    const b = expandBox(shape.box, limitKm);
    const rows = (await db.execute<{ id: number; detectedAt: Date | string; satellite: string; latitude: number; longitude: number; frpMw: number | null }>(sql`
      SELECT id, detected_at AS "detectedAt", satellite, latitude, longitude, frp_mw AS "frpMw" FROM satellite_hotspots
      WHERE detected_at >= ${new Date(now.getTime() - windowHours * 3_600_000)} AND detected_at <= ${now}
        AND latitude BETWEEN ${b.minLat} AND ${b.maxLat} AND longitude BETWEEN ${b.minLng} AND ${b.maxLng}
      ORDER BY detected_at DESC LIMIT 5000`)).rows;
    const hits = rows
      .map((h) => ({ ...h, detectedAt: new Date(h.detectedAt), distanceKm: Math.round(shape.distance([h.longitude, h.latitude]) * 100) / 100 }))
      .filter((h) => h.distanceKm <= limitKm);
    if (!hits.length) continue;
    out.areasWithHotspots++;
    const r = await upsertHotspotAlert(area, hits, limitKm, shape.kind, now);
    if (r === "created") out.alertsCreated++; else if (r === "updated") out.alertsUpdated++;
  }
  return out;
}

async function upsertHotspotAlert(
  area: MonitoredArea,
  hits: { id: number; detectedAt: Date; satellite: string; distanceKm: number; frpMw: number | null; latitude: number; longitude: number }[],
  limitKm: number, kind: "poligono" | "ponto", now: Date,
): Promise<"created" | "updated" | "unchanged"> {
  const inside = hits.filter((h) => h.distanceKm === 0).length;
  const nearest = Math.min(...hits.map((h) => h.distanceKm));
  const latest = hits.reduce((m, h) => (h.detectedAt > m ? h.detectedAt : m), hits[0].detectedAt);
  const satellites = Array.from(new Set(hits.map((h) => h.satellite))).sort();
  const dedupKey = `area:${area.id}:foco:${DAY.format(now)}`;
  const where = kind === "poligono" ? (inside ? "dentro da propriedade" : `a ${nearest.toLocaleString("pt-BR")} km do limite`) : `a ${nearest.toLocaleString("pt-BR")} km do ponto da área`;
  const when = latest.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const reason = `${hits.length} foco(s) de calor detectado(s) por satélite (INPE): ` +
    (inside ? `${inside} dentro da propriedade${hits.length > inside ? `, ${hits.length - inside} no entorno de até ${limitKm} km` : ""}. ` : `o mais próximo ${where}. `) +
    `Última detecção em ${when} (horário de Brasília; ${satellites.join(", ")}). Foco de calor não é incêndio confirmado.`;
  const evidence = {
    windowStart: new Date(Math.min(...hits.map((h) => h.detectedAt.getTime()))).toISOString(),
    latestAt: latest.toISOString(), count: hits.length, inside, nearestKm: nearest, limitKm, reference: kind, satellites,
    detections: hits.slice(0, 25).map((h) => ({ id: h.id, at: h.detectedAt.toISOString(), satellite: h.satellite, km: h.distanceKm, lat: h.latitude, lng: h.longitude, frpMw: h.frpMw })),
  };
  const severity = inside ? "alto" : nearest <= 1 ? "alto" : "moderado";

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(alerts).where(and(
      eq(alerts.organizationId, area.organizationId!), eq(alerts.dedupKey, dedupKey), inArray(alerts.status, OPEN_STATUSES),
    )).limit(1);
    if (existing) {
      const prev = existing.evidence as { count?: number; latestAt?: string } | null;
      if (prev?.count === hits.length && prev?.latestAt === evidence.latestAt) return "unchanged";
      await tx.update(alerts).set({
        reason, message: reason, evidence, severity, dataReferenceAt: latest, updatedAt: new Date(),
        occurrenceCount: (existing.occurrenceCount ?? 1) + 1,
      }).where(eq(alerts.id, existing.id));
      await tx.insert(alertEvents).values({ alertId: existing.id, fromStatus: existing.status, toStatus: existing.status,
        note: `Novas detecções: ${hits.length} foco(s) no total; mais próximo ${where}.`, userId: null });
      return "updated";
    }
    const [created] = await tx.insert(alerts).values({
      organizationId: area.organizationId, areaId: area.id, kind: "foco_proximo",
      title: `Foco de calor ${inside ? "dentro de" : "perto de"} ${area.name}`,
      message: reason, reason, severity, status: "novo", isResolved: false,
      dataSource: "INPE — Programa Queimadas (focos de calor por satélite)", dataReferenceAt: latest,
      recommendations: RECOMMENDATIONS, evidence, dedupKey, isDemo: false,
    }).returning({ id: alerts.id });
    await tx.insert(alertEvents).values({ alertId: created.id, fromStatus: null, toStatus: "novo",
      note: "Alerta emitido automaticamente após a sincronização do INPE.", userId: null });
    return "created";
  });
}
