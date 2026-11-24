/**
 * Operations and evidence report for a period, computed only from what the
 * running system recorded: heartbeats, request metrics, sync runs, audit log,
 * analyses, alerts, feedback and SUS answers. Used by the admin panel and
 * exported as the evidence package of the maturity dossier.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { evaluateOutcomes } from "./outcome-validation";
import { deliveryStats } from "./notifications";
import { povIndicators } from "./pov";

const iso = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
const one = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)).rows[0] ?? {}) as T;

export async function operationsReport(from: Date, to: Date) {
  // Availability: minutes with a healthy heartbeat / minutes observed since the first heartbeat in the window.
  const av = await one<{ firstAt: string | null; minutes: number; healthy: number; dbDown: number; engineDown: number; inpeStale: number; sisStale: number }>(sql`
    WITH w AS (SELECT * FROM ops_heartbeats WHERE at >= ${from} AND at < ${to}),
    m AS (SELECT date_trunc('minute', at) AS minute, bool_or(db_ok AND risk_engine_ok) AS ok, bool_or(db_ok) AS db, bool_or(risk_engine_ok) AS eng,
                 bool_or(inpe_fresh) AS inpe, bool_or(sisfogo_fresh) AS sis FROM w GROUP BY 1)
    SELECT ${iso("(SELECT min(at) FROM w)")} AS "firstAt", count(*)::int AS minutes, count(*) FILTER (WHERE ok)::int AS healthy,
      count(*) FILTER (WHERE NOT db)::int AS "dbDown", count(*) FILTER (WHERE NOT eng)::int AS "engineDown",
      count(*) FILTER (WHERE inpe IS FALSE)::int AS "inpeStale", count(*) FILTER (WHERE sis IS FALSE)::int AS "sisStale" FROM m`);
  const observedStart = av.firstAt ? new Date(av.firstAt) : null;
  const expected = observedStart ? Math.max(1, Math.floor((Math.min(to.getTime(), Date.now()) - observedStart.getTime()) / 60_000)) : 0;
  // Outages: gaps between heartbeats longer than 3 minutes, or unhealthy streaks.
  const gaps = (await db.execute<{ from: string; to: string; minutes: number }>(sql`
    WITH h AS (SELECT at, lag(at) OVER (ORDER BY at) AS prev FROM ops_heartbeats WHERE at >= ${from} AND at < ${to})
    SELECT ${iso("prev")} AS "from", ${iso("at")} AS "to", round(extract(epoch FROM at - prev) / 60)::int AS minutes
    FROM h WHERE at - prev > interval '3 minutes' ORDER BY at DESC LIMIT 50`)).rows as { from: string; to: string; minutes: number; ongoing?: boolean }[];
  // An outage still going on has no "next" heartbeat: report it up to the end of the window (or now).
  const [lastHb] = (await db.execute<{ at: string | null }>(sql`SELECT ${iso("max(at)")} AS at FROM ops_heartbeats WHERE at >= ${from} AND at < ${to}`)).rows;
  const windowEnd = Math.min(to.getTime(), Date.now());
  if (lastHb?.at && windowEnd - Date.parse(lastHb.at) > 3 * 60_000) {
    gaps.unshift({ from: lastHb.at, to: new Date(windowEnd).toISOString(), minutes: Math.round((windowEnd - Date.parse(lastHb.at)) / 60_000), ongoing: to.getTime() >= Date.now() });
  }

  const api = await one<{ requests: number; e5: number; e4: number; p95w: number | null; p95max: number | null; p50w: number | null }>(sql`
    SELECT coalesce(sum(requests),0)::int AS requests, coalesce(sum(errors_5xx),0)::int AS e5, coalesce(sum(errors_4xx),0)::int AS e4,
      round(sum(p95_ms::numeric * requests) / nullif(sum(requests),0))::int AS p95w, max(p95_ms) AS p95max,
      round(sum(p50_ms::numeric * requests) / nullif(sum(requests),0))::int AS p50w
    FROM ops_request_metrics WHERE minute >= ${from} AND minute < ${to} AND route LIKE '/api/%'`);
  const routes = (await db.execute(sql`
    SELECT route, sum(requests)::int AS requests, sum(errors_5xx)::int AS "errors5xx",
      round(sum(p95_ms::numeric * requests) / nullif(sum(requests),0))::int AS "p95Ms", max(max_ms) AS "maxMs"
    FROM ops_request_metrics WHERE minute >= ${from} AND minute < ${to} AND route LIKE '/api/%'
    GROUP BY route ORDER BY sum(requests) DESC LIMIT 15`)).rows;

  const syncs = (await db.execute(sql`
    SELECT s.key, s.name, count(r.id)::int AS runs, count(r.id) FILTER (WHERE r.status = 'sucesso')::int AS ok,
      count(r.id) FILTER (WHERE r.status = 'falha')::int AS failed,
      ${iso("max(r.finished_at) FILTER (WHERE r.status = 'sucesso')")} AS "lastSuccessAt",
      coalesce(sum(r.records_inserted),0)::int AS inserted, coalesce(sum(r.records_updated),0)::int AS updated
    FROM data_sources s LEFT JOIN source_sync_runs r ON r.source_id = s.id AND r.started_at >= ${from} AND r.started_at < ${to}
    WHERE s.key IN ('inpe-queimadas', 'sisfogo-roi') GROUP BY s.key, s.name ORDER BY s.key`)).rows;

  const usage = await one<Record<string, number | null>>(sql`
    SELECT
      (SELECT count(DISTINCT user_id)::int FROM audit_logs WHERE user_id IS NOT NULL AND created_at >= ${from} AND created_at < ${to}) AS "activeUsers",
      (SELECT count(DISTINCT user_id)::int FROM audit_logs WHERE action = 'auth.login' AND created_at >= ${from} AND created_at < ${to}) AS "usersWithLogin",
      (SELECT count(*)::int FROM users WHERE created_at >= ${from} AND created_at < ${to}) AS "newUsers",
      (SELECT count(DISTINCT organization_id)::int FROM audit_logs WHERE organization_id IS NOT NULL AND created_at >= ${from} AND created_at < ${to}) AS "activeOrganizations",
      (SELECT count(*)::int FROM monitored_areas WHERE created_at >= ${from} AND created_at < ${to}) AS "newAreas",
      (SELECT count(*)::int FROM monitored_areas WHERE boundary IS NOT NULL) AS "areasWithBoundary",
      (SELECT count(*)::int FROM risk_analyses WHERE created_at >= ${from} AND created_at < ${to}) AS analyses,
      (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY client_duration_ms) FROM risk_analyses WHERE client_duration_ms IS NOT NULL AND created_at >= ${from} AND created_at < ${to}) AS "medianAnalysisMs",
      (SELECT count(*)::int FROM risk_analyses WHERE client_duration_ms IS NOT NULL AND created_at >= ${from} AND created_at < ${to}) AS "timedAnalyses",
      (SELECT count(*)::int FROM alerts WHERE NOT is_demo AND organization_id IS NOT NULL AND created_at >= ${from} AND created_at < ${to}) AS alerts,
      (SELECT count(*)::int FROM alerts WHERE NOT is_demo AND kind = 'foco_proximo' AND created_at >= ${from} AND created_at < ${to}) AS "hotspotAlerts",
      (SELECT count(*)::int FROM alerts WHERE NOT is_demo AND status IN ('resolvido','descartado') AND updated_at >= ${from} AND updated_at < ${to}) AS "alertsClosed",
      (SELECT count(*)::int FROM audit_logs WHERE action = 'report.viewed' AND created_at >= ${from} AND created_at < ${to}) AS "reportsViewed"`);

  const feedback = await one<{ total: number; problems: number; open: number; avgRating: number | null }>(sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE category = 'problema')::int AS problems,
      count(*) FILTER (WHERE status IN ('novo','em_analise'))::int AS open, round(avg(rating)::numeric, 2)::float8 AS "avgRating"
    FROM user_feedback WHERE created_at >= ${from} AND created_at < ${to}`);
  const sus = await one<{ n: number; mean: number | null; median: number | null }>(sql`
    SELECT count(*)::int AS n, round(avg(score)::numeric, 1)::float8 AS mean,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY score)::float8 AS median
    FROM sus_responses WHERE created_at >= ${from} AND created_at < ${to}`);

  const outcomes = await evaluateOutcomes({ from, to, windowDays: 7, radiusKm: 10 });
  const notifications = await deliveryStats(from, to);
  const proofOfValue = await povIndicators(from, to);

  return {
    generatedAt: new Date().toISOString(),
    period: { from: from.toISOString(), to: to.toISOString() },
    availability: {
      measuredSince: av.firstAt, expectedMinutes: expected, minutesWithHeartbeat: av.minutes ?? 0, healthyMinutes: av.healthy ?? 0,
      availabilityPct: expected ? Math.round(((av.healthy ?? 0) / expected) * 10000) / 100 : null,
      minutesDbDown: av.dbDown ?? 0, minutesEngineDown: av.engineDown ?? 0,
      minutesInpeStale: av.inpeStale ?? 0, minutesSisfogoStale: av.sisStale ?? 0,
      gaps,
      note: "Minutos sem registro contam como indisponíveis. Uma queda total do servidor aparece como intervalo (gap).",
    },
    api: {
      requests: api.requests ?? 0, errors5xx: api.e5 ?? 0, errors4xx: api.e4 ?? 0,
      errorRate5xxPct: api.requests ? Math.round(((api.e5 ?? 0) / api.requests) * 10000) / 100 : null,
      p50Ms: api.p50w, p95Ms: api.p95w, worstMinuteP95Ms: api.p95max, routes,
    },
    syncs,
    usage,
    feedback,
    sus: { ...sus, note: "Escala SUS 0–100; referência usual: ≥ 68 acima da média (Bangor et al., 2008)." },
    outcomes,
    proofOfValue,
    notifications: { ...notifications, note: "Envios por e-mail. 'bloqueado_configuracao' = não enviado porque o SMTP não está configurado." },
  };
}
