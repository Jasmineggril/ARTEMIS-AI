/**
 * INMET weather stations (official observations).
 *   GET /api/weather-stations                         public: stations, status, latest observation, availability (30 d)
 *   GET /api/weather-stations/:code/daily?from&to     public: daily series + descriptive statistics (≤ 400 days)
 *   GET /api/weather-stations/:code/hourly?from&to    public: hourly observations with quality flags (≤ 31 days)
 *   GET /api/weather-stations/:code/compare?aFrom&aTo&bFrom&bTo  public: two periods side by side
 *   GET /api/weather-stations/:code/fma?from&to       public: Fórmula de Monte Alegre (daily)
 *   GET /api/connectors/inmet/status                  public: coverage, volume, last runs
 *   GET /api/areas/:id/weather-stations               member: stations linked to the property (distance, representativeness)
 *   GET /api/areas/:id/weather-history?from&to        member: history of the nearest representative station
 */
import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { monitoredAreas, sourceSyncRuns, weatherStations } from "@shared/schema";
import { requireOrg, rateLimit, idParam } from "./security";
import { INMET_SOURCE_KEY, inmetSourceId } from "./connectors/inmet";
import { dailySeries, fmaSeries, hourlySeries, periodSummary, stationsForArea, REPRESENTATIVENESS_KM } from "./services/inmet-stations";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");
const range = (maxDays: number) => z.object({ from: DAY, to: DAY }).refine((r) => r.from <= r.to, "Início depois do fim.")
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= maxDays, `Intervalo máximo de ${maxDays} dias.`);

async function stationByCode(code: string) {
  if (!/^[A-Za-z]\d{3}$/.test(code)) return null;
  const sourceId = await inmetSourceId();
  const [s] = await db.select().from(weatherStations).where(and(eq(weatherStations.sourceId, sourceId), eq(weatherStations.code, code.toUpperCase())));
  return s ?? null;
}
const publicStation = (s: typeof weatherStations.$inferSelect) => ({ code: s.code, name: s.name, state: s.state, latitude: s.latitude, longitude: s.longitude, altitudeM: s.altitudeM, status: s.status, utcOffsetHours: s.utcOffsetHours });

export function registerInmetRoutes(app: Express) {
  const limiter = rateLimit({ windowMs: 60_000, max: 120, key: "inmet-public" });
  const bad = (res: any, e: z.ZodError) => res.status(400).json({ message: e.issues[0].message });

  app.get("/api/weather-stations", limiter, async (req, res, next) => {
    try {
      const uf = typeof req.query.state === "string" && /^[A-Za-z]{2}$/.test(req.query.state) ? req.query.state.toUpperCase() : null;
      const rows = (await db.execute(sql`
        WITH last AS (SELECT station_id, max(day) AS d FROM weather_station_daily GROUP BY 1)
        SELECT s.code, s.name, s.state, s.latitude, s.longitude, s.altitude_m AS "altitudeM", s.status,
          l.d::text AS "lastDay",
          (SELECT round(sum(hours_observed)::numeric / (30 * 24) * 100, 1)::float8 FROM weather_station_daily d WHERE d.station_id = s.id AND d.day > l.d - 30 AND d.day <= l.d) AS "availability30dPct"
        FROM weather_stations s JOIN data_sources ds ON ds.id = s.source_id AND ds.key = ${INMET_SOURCE_KEY}
        LEFT JOIN last l ON l.station_id = s.id
        ${uf ? sql`WHERE s.state = ${uf}` : sql``}
        ORDER BY s.state, s.name`)).rows;
      res.json({ source: "INMET — estações automáticas", nature: "medido_estacao", stations: rows });
    } catch (e) { next(e); }
  });

  app.get("/api/weather-stations/:code/daily", limiter, async (req, res, next) => {
    try {
      const q = range(400).safeParse(req.query); if (!q.success) return bad(res, q.error);
      const s = await stationByCode(req.params.code); if (!s) return res.status(404).json({ message: "Estação não encontrada." });
      const rows = await dailySeries(s.id, q.data.from, q.data.to);
      res.json({ station: publicStation(s), nature: "medido_estacao", unit: { temperature: "°C", humidity: "%", wind: "m/s", precipitation: "mm" },
        note: "Dia local da estação (UTC" + s.utcOffsetHours + "). Chuva diária = soma das horas observadas; dias com menos de 22 h têm total incompleto.",
        summary: periodSummary(rows, q.data.from, q.data.to), days: rows });
    } catch (e) { next(e); }
  });

  app.get("/api/weather-stations/:code/hourly", limiter, async (req, res, next) => {
    try {
      const q = range(31).safeParse(req.query); if (!q.success) return bad(res, q.error);
      const s = await stationByCode(req.params.code); if (!s) return res.status(404).json({ message: "Estação não encontrada." });
      const to = new Date(Date.parse(q.data.to) + 86_400_000).toISOString();
      res.json({ station: publicStation(s), timezone: "UTC", units: { temperatureC: "°C", humidityPct: "%", windSpeedMs: "m/s", precipitationMm: "mm/h", pressureHpa: "hPa" },
        hours: await hourlySeries(s.id, `${q.data.from}T00:00:00Z`, to) });
    } catch (e) { next(e); }
  });

  app.get("/api/weather-stations/:code/compare", limiter, async (req, res, next) => {
    try {
      const q = z.object({ aFrom: DAY, aTo: DAY, bFrom: DAY, bTo: DAY }).safeParse(req.query); if (!q.success) return bad(res, q.error);
      const { aFrom, aTo, bFrom, bTo } = q.data;
      for (const [f, t] of [[aFrom, aTo], [bFrom, bTo]]) if (f > t || (Date.parse(t) - Date.parse(f)) / 86_400_000 > 400) return res.status(400).json({ message: "Períodos inválidos (máx. 400 dias cada)." });
      const s = await stationByCode(req.params.code); if (!s) return res.status(404).json({ message: "Estação não encontrada." });
      const [a, b] = await Promise.all([dailySeries(s.id, aFrom, aTo), dailySeries(s.id, bFrom, bTo)]);
      res.json({ station: publicStation(s), a: periodSummary(a, aFrom, aTo), b: periodSummary(b, bFrom, bTo) });
    } catch (e) { next(e); }
  });

  app.get("/api/weather-stations/:code/fma", limiter, async (req, res, next) => {
    try {
      const q = range(400).safeParse(req.query); if (!q.success) return bad(res, q.error);
      const s = await stationByCode(req.params.code); if (!s) return res.status(404).json({ message: "Estação não encontrada." });
      res.json({ station: publicStation(s), nature: "calculado", index: "FMA", ...(await fmaSeries(s.id, q.data.from, q.data.to)),
        limits: ["Índice calculado pela plataforma a partir das observações do INMET; não calibrado pela ARTEMIS para a região.",
          "Representa as condições no local da estação, não de uma propriedade.", "Não é integrado à pontuação do motor de risco (exibido à parte)."] });
    } catch (e) { next(e); }
  });

  let statusCache: { at: number; body: unknown } | null = null;
  app.get("/api/connectors/inmet/status", limiter, async (_req, res, next) => {
    try {
      if (statusCache && Date.now() - statusCache.at < 60_000) return res.json(statusCache.body);
      const sourceId = await inmetSourceId();
      const [t] = (await db.execute(sql`
        SELECT (SELECT count(*)::int FROM weather_stations WHERE source_id = ${sourceId}) AS stations,
          (SELECT count(*)::int FROM weather_stations WHERE source_id = ${sourceId} AND status = 'Operante') AS "stationsOperating",
          (SELECT count(DISTINCT station_id)::int FROM weather_station_daily) AS "stationsWithData",
          -- from the daily aggregates (same totals, ~1/17 of the rows): each observation is counted in exactly one local day
          (SELECT coalesce(sum(hours_observed), 0)::bigint FROM weather_station_daily) AS observations,
          (SELECT coalesce(sum(flagged_hours), 0)::bigint FROM weather_station_daily) AS "flaggedObservations",
          (SELECT to_char(min(observed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') FROM weather_station_observations) AS "firstObservation",
          (SELECT to_char(max(observed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') FROM weather_station_observations) AS "lastObservation"`)).rows;
      const runs = await db.select({ id: sourceSyncRuns.id, status: sourceSyncRuns.status, startedAt: sourceSyncRuns.startedAt, finishedAt: sourceSyncRuns.finishedAt,
        params: sourceSyncRuns.params, recordsRead: sourceSyncRuns.recordsRead, recordsInserted: sourceSyncRuns.recordsInserted, recordsUpdated: sourceSyncRuns.recordsUpdated,
        recordsRejected: sourceSyncRuns.recordsRejected, rejectionReasons: sourceSyncRuns.rejectionReasons, error: sourceSyncRuns.error })
        .from(sourceSyncRuns).where(eq(sourceSyncRuns.sourceId, sourceId)).orderBy(desc(sourceSyncRuns.id)).limit(10);
      const body = { ...t, runs: runs.map((r) => ({ ...r, params: { ...(r.params as any), rawFile: undefined } })),
        access: { archive: "Portal de dados históricos (ZIP anual por estação) — atualizado ~1×/mês", hourlyApi: "API horária exige token do INMET — não configurado" } };
      statusCache = { at: Date.now(), body };
      res.json(body);
    } catch (e) { next(e); }
  });

  app.get("/api/areas/:id/weather-stations", requireOrg(), async (req, res, next) => {
    try {
      const id = idParam(req.params.id);
      const [area] = id ? await db.select().from(monitoredAreas).where(and(eq(monitoredAreas.id, id), eq(monitoredAreas.organizationId, req.ctx!.organizationId))) : [];
      if (!area) return res.status(404).json({ message: "Área não encontrada." });
      res.json({ criteria: { distance: area.boundary ? "até o limite da propriedade" : "até o ponto da área", thresholdsKm: REPRESENTATIVENESS_KM },
        stations: await stationsForArea(area, { limit: 5, maxKm: 150 }) });
    } catch (e) { next(e); }
  });

  app.get("/api/areas/:id/weather-history", requireOrg(), async (req, res, next) => {
    try {
      const q = range(400).safeParse(req.query); if (!q.success) return bad(res, q.error);
      const id = idParam(req.params.id);
      const [area] = id ? await db.select().from(monitoredAreas).where(and(eq(monitoredAreas.id, id), eq(monitoredAreas.organizationId, req.ctx!.organizationId))) : [];
      if (!area) return res.status(404).json({ message: "Área não encontrada." });
      const stations = await stationsForArea(area, { limit: 3, maxKm: REPRESENTATIVENESS_KM.intermediaria });
      const st = stations.find((s) => s.lastObservationAt) ?? null;
      if (!st) return res.json({ station: null, message: `Nenhuma estação do INMET com dados a até ${REPRESENTATIVENESS_KM.intermediaria} km da área.`, days: [], summary: null, fma: null });
      const [days, fma] = await Promise.all([dailySeries(st.id, q.data.from, q.data.to), fmaSeries(st.id, q.data.from, q.data.to)]);
      res.json({ station: st, nature: "medido_estacao", summary: periodSummary(days, q.data.from, q.data.to), days, fma });
    } catch (e) { next(e); }
  });
}
