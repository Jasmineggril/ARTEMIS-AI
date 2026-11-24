/**
 * Alerts for PERSISTENT official fire-risk conditions (INPE model 2.2) in monitored properties.
 * Operational rules — defaults below, documented in docs/artemis/26_INPE_RISCO_FOGO.md; to be
 * reviewed by the invited experts during the pilot (they are not calibrated):
 *
 *   R1 persistence: observed RF of the property > 0.70 (class alto or crítico) on each of the
 *      last RISK_ALERT_DAYS (default 3) observed days → severity "alto"; "crítico" when the last
 *      2 observed days are > 0.95.
 *   R2 forecast: no R1, but INPE's forecast for one of the next 3 days is > 0.95 (crítico)
 *      → severity "moderado", worded as a forecast.
 *
 * Wording always says this is a CONDITION (meteorological index), not a hotspot nor a confirmed fire.
 * Deduplication: one open alert of this kind per property; a new episode is created only after
 * the previous one was closed. Each alert is written with its evidence and enqueued for e-mail
 * through the same delivery log as the other alerts.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { alertEvents, alerts, monitoredAreas } from "@shared/schema";
import { RF_CLASS_LABEL, rfClass } from "@shared/inpe-fire-risk";
import { OPEN_STATUSES } from "./alert-service";
import { enqueueAlertDeliveries } from "./notifications";
import type { RiskRecommendation } from "@shared/risk-engine";

export const RISK_ALERT_DAYS = Math.max(2, Number(process.env.RISK_ALERT_DAYS ?? 3));
const ALTO = 0.7, CRITICO = 0.95;

const RECOMMENDATIONS: RiskRecommendation[] = [
  { priority: "urgente", action: "Evitar qualquer uso de fogo (queima de restos, limpeza de pasto) enquanto durar a condição.", rationale: "O índice oficial do INPE indica vegetação muito propícia a queimar." },
  { priority: "urgente", action: "Conferir aceiros, acessos e a prontidão da brigada ou dos vizinhos.", rationale: "Em risco alto ou crítico um foco se espalha mais rápido." },
  { priority: "imediata", action: "Em caso de fogo, acionar o Corpo de Bombeiros (193) e a Defesa Civil (199).", rationale: "A ARTEMIS AI não substitui os serviços de emergência." },
];

export interface RiskAlertResult { areasChecked: number; created: number; updated: number; unchanged: number }

export async function evaluateRiskAlerts(opts: { days?: number } = {}): Promise<RiskAlertResult> {
  const days = opts.days ?? RISK_ALERT_DAYS;
  const out: RiskAlertResult = { areasChecked: 0, created: 0, updated: 0, unchanged: 0 };
  const areas = await db.select().from(monitoredAreas).where(and(sql`${monitoredAreas.organizationId} IS NOT NULL`, sql`${monitoredAreas.status} <> 'inativo'`));
  for (const area of areas) {
    const obs = (await db.execute<{ day: string; mean: number | null }>(sql`
      SELECT valid_day::text AS day, value_mean AS mean FROM fire_risk_values
      WHERE index_key = 'inpe_rf_oficial' AND product = 'observado' AND target_type = 'area' AND target_id = ${area.id}
      ORDER BY valid_day DESC LIMIT ${days}`)).rows;
    if (!obs.length) continue;
    out.areasChecked++;
    const consecutive = obs.length === days && obs.every((o, i) => o.mean != null && o.mean > ALTO && (i === 0 || Date.parse(obs[i - 1].day) - Date.parse(o.day) === 86_400_000));
    const fc = (await db.execute<{ day: string; mean: number | null }>(sql`
      SELECT DISTINCT ON (valid_day) valid_day::text AS day, value_mean AS mean FROM fire_risk_values
      WHERE index_key = 'inpe_rf_oficial' AND product = 'previsto' AND target_type = 'area' AND target_id = ${area.id} AND valid_day > ${obs[0].day}::date
      ORDER BY valid_day, issued_on DESC NULLS LAST LIMIT 3`)).rows;
    const fcCritical = fc.filter((f) => f.mean != null && f.mean > CRITICO);
    if (!consecutive && !fcCritical.length) continue;

    const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
    const v = (x: number | null) => (x == null ? "—" : x.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
    let severity: string, reason: string;
    if (consecutive) {
      severity = obs.slice(0, 2).every((o) => (o.mean ?? 0) > CRITICO) ? "crítico" : "alto";
      reason = `Risco de fogo ${severity === "crítico" ? "crítico" : "alto ou crítico"} na área por ${days} dias seguidos segundo o índice oficial do INPE ` +
        `(${obs.slice().reverse().map((o) => `${fmt(o.day)}: ${v(o.mean)} — ${RF_CLASS_LABEL[rfClass(o.mean!)]}`).join("; ")}). ` +
        "O índice combina dias sem chuva, temperatura alta e umidade baixa com o tipo de vegetação." +
        (fcCritical.length ? ` A previsão do INPE mantém risco crítico em ${fcCritical.map((f) => fmt(f.day)).join(", ")}.` : "");
    } else {
      severity = "moderado";
      reason = `Previsão do INPE de risco de fogo crítico para a área em ${fcCritical.map((f) => `${fmt(f.day)} (${v(f.mean)})`).join(", ")}. ` +
        `Último observado (${fmt(obs[0].day)}): ${v(obs[0].mean)}${obs[0].mean != null ? ` — ${RF_CLASS_LABEL[rfClass(obs[0].mean)]}` : ""}. Previsões podem mudar.`;
    }
    reason += " Condição de risco (índice meteorológico), não indica foco de calor nem incêndio confirmado.";
    const evidence = { index: "inpe_rf_oficial", modelVersion: "2.2", rule: consecutive ? "R1_persistencia" : "R2_previsao", observed: obs, forecast: fc, thresholds: { alto: ALTO, critico: CRITICO, days } };
    const r = await upsert(area, severity, reason, evidence, obs[0].day);
    out[r]++;
  }
  return out;
}

async function upsert(area: typeof monitoredAreas.$inferSelect, severity: string, reason: string, evidence: Record<string, unknown>, refDay: string): Promise<"created" | "updated" | "unchanged"> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(alerts).where(and(eq(alerts.organizationId, area.organizationId!), eq(alerts.areaId, area.id),
      eq(alerts.kind, "risco_oficial"), inArray(alerts.status, OPEN_STATUSES))).limit(1);
    if (existing) {
      const prev = existing.evidence as { observed?: { day: string }[]; rule?: string } | null;
      if (prev?.observed?.[0]?.day === refDay && prev?.rule === evidence.rule && existing.severity === severity) return "unchanged";
      await tx.update(alerts).set({ reason, message: reason, severity, evidence, dataReferenceAt: new Date(refDay + "T18:00:00Z"), updatedAt: new Date(),
        occurrenceCount: (existing.occurrenceCount ?? 1) + 1 }).where(eq(alerts.id, existing.id));
      await tx.insert(alertEvents).values({ alertId: existing.id, fromStatus: existing.status, toStatus: existing.status, userId: null,
        note: `Condição atualizada com o risco oficial de ${refDay}: severidade ${severity}.` });
      return "updated";
    }
    const [created] = await tx.insert(alerts).values({
      organizationId: area.organizationId!, areaId: area.id, kind: "risco_oficial", title: `Risco de fogo ${severity} (INPE) — ${area.name}`,
      message: reason, reason, severity, status: "novo", isResolved: false, dataSource: "INPE — Risco de Fogo, modelo 2.2 (observado e previsto)",
      dataReferenceAt: new Date(refDay + "T18:00:00Z"), recommendations: RECOMMENDATIONS, evidence, dedupKey: `area:${area.id}:risco_oficial:${refDay}`, isDemo: false,
    }).returning({ id: alerts.id });
    await tx.insert(alertEvents).values({ alertId: created.id, fromStatus: null, toStatus: "novo", userId: null, note: "Alerta emitido automaticamente a partir do risco de fogo oficial do INPE." });
    await enqueueAlertDeliveries(tx, { id: created.id, organizationId: area.organizationId!, severity, kind: "risco_oficial" });
    return "created";
  });
}
