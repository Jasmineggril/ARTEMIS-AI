/**
 * ARTEMIS AI — alert lifecycle.
 *
 * Status: novo → reconhecido → em_acompanhamento → resolvido | descartado.
 * Every change writes an alert_events row. Re-analyses that confirm an open
 * alert do not create a new alert: they increment occurrence_count and add an
 * event (de-duplication / anti-spam).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { enqueueAlertDeliveries } from "./notifications";
import { alerts, alertEvents, type AlertStatus, type Alert } from "@shared/schema";
import type { RiskLevel, RiskRecommendation } from "@shared/risk-engine";

export const OPEN_STATUSES: AlertStatus[] = ["novo", "reconhecido", "em_acompanhamento"];

const TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  novo: ["reconhecido", "em_acompanhamento", "resolvido", "descartado"],
  reconhecido: ["em_acompanhamento", "resolvido", "descartado"],
  em_acompanhamento: ["resolvido", "descartado"],
  resolvido: ["em_acompanhamento"], // reopen
  descartado: ["reconhecido"],      // reopen
};

export function canTransition(from: AlertStatus, to: AlertStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: AlertStatus): AlertStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** Levels that generate an alert. Configurable via ALERT_MIN_LEVEL. */
export function shouldAlert(level: RiskLevel): boolean {
  const order: RiskLevel[] = ["baixo", "moderado", "alto", "crítico"];
  const min = (process.env.ALERT_MIN_LEVEL as RiskLevel) ?? "alto";
  const minIdx = order.indexOf(order.includes(min) ? min : "alto");
  return order.indexOf(level) >= minIdx;
}

export async function upsertAlertFromAnalysis(params: {
  organizationId: number;
  areaId: number;
  areaName: string;
  analysisId: number;
  score: number;
  level: RiskLevel;
  topFactors: string[];
  recommendations: RiskRecommendation[];
  dataSource: string;
  dataReferenceAt: Date | null;
  userId: number;
}): Promise<{ alert: Alert; created: boolean }> {
  const dedupKey = `area:${params.areaId}:level:${params.level}`;
  const reason =
    `Análise #${params.analysisId} classificou a área como ${params.level.toUpperCase()} (índice ${params.score}/100).` +
    (params.topFactors.length ? ` Principais fatores: ${params.topFactors.join("; ")}.` : "");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.organizationId, params.organizationId),
          eq(alerts.dedupKey, dedupKey),
          inArray(alerts.status, OPEN_STATUSES),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await tx
        .update(alerts)
        .set({
          occurrenceCount: (existing.occurrenceCount ?? 1) + 1,
          riskAnalysisId: params.analysisId,
          reason,
          recommendations: params.recommendations,
          dataSource: params.dataSource,
          dataReferenceAt: params.dataReferenceAt,
          updatedAt: new Date(),
        })
        .where(eq(alerts.id, existing.id))
        .returning();
      await tx.insert(alertEvents).values({
        alertId: existing.id,
        fromStatus: existing.status,
        toStatus: existing.status,
        note: `Reavaliação: análise #${params.analysisId} confirmou o nível (índice ${params.score}). Alerta não duplicado.`,
        userId: params.userId,
      });
      return { alert: updated, created: false };
    }

    const severity = params.level; // risk-level vocabulary
    const [created] = await tx
      .insert(alerts)
      .values({
        organizationId: params.organizationId,
        areaId: params.areaId,
        riskAnalysisId: params.analysisId,
        title: `Risco ${params.level} — ${params.areaName}`,
        message: reason,
        reason,
        severity,
        status: "novo",
        isResolved: false,
        dataSource: params.dataSource,
        dataReferenceAt: params.dataReferenceAt,
        recommendations: params.recommendations,
        dedupKey,
        isDemo: false,
      })
      .returning();
    await tx.insert(alertEvents).values({
      alertId: created.id,
      fromStatus: null,
      toStatus: "novo",
      note: `Alerta emitido automaticamente a partir da análise #${params.analysisId}.`,
      userId: params.userId,
    });
    await enqueueAlertDeliveries(tx, { id: created.id, organizationId: params.organizationId, severity, kind: created.kind ?? "risco" });
    return { alert: created, created: true };
  });
}

export async function transitionAlert(params: {
  alert: Alert;
  to: AlertStatus;
  note?: string;
  userId: number;
  assignedTo?: number | null;
}): Promise<Alert> {
  const from = (params.alert.status ?? "novo") as AlertStatus;
  if (!canTransition(from, params.to)) {
    throw new TransitionError(from, params.to);
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(alerts)
      .set({
        status: params.to,
        isResolved: params.to === "resolvido" || params.to === "descartado",
        assignedTo: params.assignedTo === undefined ? params.alert.assignedTo : params.assignedTo,
        updatedAt: new Date(),
      })
      .where(eq(alerts.id, params.alert.id))
      .returning();
    await tx.insert(alertEvents).values({
      alertId: params.alert.id,
      fromStatus: from,
      toStatus: params.to,
      note: params.note ?? null,
      userId: params.userId,
    });
    return updated;
  });
}

export class TransitionError extends Error {
  constructor(public readonly from: string, public readonly to: string) {
    super(`Transição de status não permitida: ${from} → ${to}`);
  }
}
