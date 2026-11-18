/**
 * Proof of Value indicators (Cronograma da Prova de Valor), computed only from
 * what was recorded. Nothing is estimated; when the sample is too small the
 * indicator says so instead of declaring the target met or missed.
 *
 *  I1 — analysis time reduction ≥ 30 %:
 *       baseline = median time of the manual procedure (pov_baseline_measurements,
 *       timed in the app by invited evaluators); platform = median
 *       client_duration_ms of analyses in the same period. Analyses faster than
 *       10 s are excluded as non-human (automated tests/scripts) and counted.
 *       Also reported paired by evaluator (same person, both methods).
 *  I2 — ≥ 80 % of alerts AND recommendations validated by invited evaluators:
 *       "validated" = verdict "pertinente" (strict); "parcialmente" is shown apart.
 *  Minimum sample for a verdict: 10 baseline + 10 platform timings; 20 verdicts.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export const POV_TARGETS = { timeReductionPct: 30, validatedPct: 80, minTimings: 10, minVerdicts: 20, humanMinMs: 10_000 };

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

export async function povIndicators(from: Date, to: Date) {
  const base = (await db.execute<{ userId: number; ms: number }>(sql`
    SELECT user_id AS "userId", duration_ms AS ms FROM pov_baseline_measurements WHERE created_at >= ${from} AND created_at < ${to}`)).rows;
  const plat = (await db.execute<{ userId: number | null; ms: number }>(sql`
    SELECT created_by AS "userId", client_duration_ms AS ms FROM risk_analyses
    WHERE client_duration_ms IS NOT NULL AND created_at >= ${from} AND created_at < ${to}`)).rows;
  const human = plat.filter((p) => p.ms >= POV_TARGETS.humanMinMs);
  const bMed = median(base.map((b) => b.ms)), pMed = median(human.map((p) => p.ms));
  const reduction = bMed && pMed != null ? Math.round((1 - pMed / bMed) * 1000) / 10 : null;
  const users = Array.from(new Set(base.map((b) => b.userId))).filter((u) => human.some((p) => p.userId === u));
  const paired = users.map((u) => {
    const b = median(base.filter((x) => x.userId === u).map((x) => x.ms))!, p = median(human.filter((x) => x.userId === u).map((x) => x.ms))!;
    return Math.round((1 - p / b) * 1000) / 10;
  });
  const enoughTime = base.length >= POV_TARGETS.minTimings && human.length >= POV_TARGETS.minTimings;

  const [v] = (await db.execute<{ alertsN: number; alertsOk: number; alertsPartial: number; recN: number; recOk: number; recPartial: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM alerts WHERE NOT is_demo AND evaluation IS NOT NULL AND evaluated_at >= ${from} AND evaluated_at < ${to}) AS "alertsN",
      (SELECT count(*)::int FROM alerts WHERE NOT is_demo AND evaluation = 'pertinente' AND evaluated_at >= ${from} AND evaluated_at < ${to}) AS "alertsOk",
      (SELECT count(*)::int FROM alerts WHERE NOT is_demo AND evaluation = 'parcialmente_pertinente' AND evaluated_at >= ${from} AND evaluated_at < ${to}) AS "alertsPartial",
      (SELECT count(*)::int FROM risk_analyses WHERE recommendation_evaluation IS NOT NULL AND recommendation_evaluated_at >= ${from} AND recommendation_evaluated_at < ${to}) AS "recN",
      (SELECT count(*)::int FROM risk_analyses WHERE recommendation_evaluation = 'pertinente' AND recommendation_evaluated_at >= ${from} AND recommendation_evaluated_at < ${to}) AS "recOk",
      (SELECT count(*)::int FROM risk_analyses WHERE recommendation_evaluation = 'parcialmente_pertinente' AND recommendation_evaluated_at >= ${from} AND recommendation_evaluated_at < ${to}) AS "recPartial"`)).rows;
  const vN = v.alertsN + v.recN, vOk = v.alertsOk + v.recOk;
  const verdict = (enough: boolean, value: number | null, target: number) => !enough || value == null ? "amostra_insuficiente" : value >= target ? "meta_atingida" : "meta_nao_atingida";

  return {
    targets: POV_TARGETS,
    timeReduction: {
      baselineN: base.length, baselineMedianMs: bMed,
      platformN: human.length, platformMedianMs: pMed, platformExcludedFast: plat.length - human.length,
      reductionPct: reduction, pairedEvaluators: paired.length, pairedMedianReductionPct: median(paired),
      status: verdict(enoughTime, reduction, POV_TARGETS.timeReductionPct),
    },
    validation: {
      alerts: { evaluated: v.alertsN, pertinent: v.alertsOk, partial: v.alertsPartial, pertinentPct: pct(v.alertsOk, v.alertsN) },
      recommendations: { evaluated: v.recN, pertinent: v.recOk, partial: v.recPartial, pertinentPct: pct(v.recOk, v.recN) },
      combinedPct: pct(vOk, vN),
      status: verdict(vN >= POV_TARGETS.minVerdicts, pct(vOk, vN), POV_TARGETS.validatedPct),
    },
    method: "docs/artemis/22_PROVA_DE_VALOR_METODOLOGIA.md",
  };
}
