/**
 * INMET stations ↔ monitored properties, series, statistics and the FMA index.
 *
 * Linking criterion (documented in docs/artemis/24_INMET.md):
 *   distance from the station to the property BOUNDARY (0 if inside; to the point
 *   when there is no boundary), geodesic (PostGIS) or haversine (fallback).
 *   Representativeness by distance only — relief, altitude, coast and land use
 *   can make even a close station unrepresentative:
 *     ≤ 25 km  "proxima"        observations are a reasonable reference
 *     ≤ 50 km  "intermediaria"  use with care (regional conditions only)
 *     ≤ 100 km "distante"       context only; not used as the area's observation
 *     > 100 km "nao_representativa"
 *   Availability: share of expected hours with an observation in the 30 days
 *   that end at the station's latest observation.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { hasPostgisGeom } from "../spatial";
import { haversineKm, distanceToBoundaryKm, type BoundaryGeom } from "@shared/geometry";
import { computeFma, FMA_REFERENCE, type FmaDayInput } from "@shared/fire-indices";
import type { MonitoredArea } from "@shared/schema";

export type Representativeness = "proxima" | "intermediaria" | "distante" | "nao_representativa";
export const REPRESENTATIVENESS_KM = { proxima: 25, intermediaria: 50, distante: 100 } as const;
export const representativeness = (km: number): Representativeness =>
  km <= REPRESENTATIVENESS_KM.proxima ? "proxima" : km <= REPRESENTATIVENESS_KM.intermediaria ? "intermediaria" : km <= REPRESENTATIVENESS_KM.distante ? "distante" : "nao_representativa";
export const REPRESENTATIVENESS_NOTE: Record<Representativeness, string> = {
  proxima: "Estação próxima: referência razoável, mas não mede as condições exatas da propriedade.",
  intermediaria: "Estação a distância intermediária: representa condições regionais; use com cautela.",
  distante: "Estação distante: apenas contexto regional; não usada como observação da área.",
  nao_representativa: "Estação a mais de 100 km: não representa a propriedade.",
};

let geomCol: { at: number; ok: boolean } | null = null;
async function stationGeom() {
  if (geomCol && Date.now() - geomCol.at < 300_000) return geomCol.ok;
  const r = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'weather_stations' AND column_name = 'geom' LIMIT 1`);
  geomCol = { at: Date.now(), ok: r.rows.length > 0 };
  return geomCol.ok;
}

export interface LinkedStation {
  id: number; code: string; name: string; state: string | null; latitude: number; longitude: number; altitudeM: number | null; status: string | null;
  distanceKm: number; representativeness: Representativeness; note: string;
  lastObservationAt: string | null; availability30dPct: number | null; method: "postgis" | "haversine";
}

async function availability(ids: number[]) {
  if (!ids.length) return new Map<number, { last: string | null; pct: number | null }>();
  const r = await db.execute<{ id: number; last: string | null; hours: number | null; days: number | null }>(sql`
    WITH last AS (SELECT station_id, max(day) AS d FROM weather_station_daily WHERE station_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) GROUP BY 1)
    SELECT l.station_id AS id, (SELECT to_char(max(observed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM weather_station_observations o WHERE o.station_id = l.station_id) AS last,
      (SELECT sum(hours_observed)::int FROM weather_station_daily d WHERE d.station_id = l.station_id AND d.day > l.d - 30 AND d.day <= l.d) AS hours
    FROM last l`);
  return new Map(r.rows.map((x) => [x.id, { last: x.last, pct: x.hours == null ? null : Math.round((x.hours / (30 * 24)) * 1000) / 10 }]));
}

export async function stationsForArea(area: MonitoredArea, opts: { limit?: number; maxKm?: number } = {}): Promise<LinkedStation[]> {
  const limit = Math.min(opts.limit ?? 5, 20), maxKm = opts.maxKm ?? 150;
  let rows: (Omit<LinkedStation, "representativeness" | "note" | "lastObservationAt" | "availability30dPct" | "method">)[] = [];
  let method: "postgis" | "haversine" = "haversine";
  if (process.env.SPATIAL_FORCE_FALLBACK !== "true" && (await hasPostgisGeom()) && (await stationGeom())) {
    method = "postgis";
    const g = area.boundary ? sql`ST_GeomFromGeoJSON(${JSON.stringify(area.boundary)})::geography` : sql`ST_SetSRID(ST_MakePoint(${area.longitude}, ${area.latitude}), 4326)::geography`;
    rows = (await db.execute<any>(sql`
      WITH a AS (SELECT ${g} AS g)
      SELECT s.id, s.code, s.name, s.state, s.latitude, s.longitude, s.altitude_m AS "altitudeM", s.status,
        round((ST_Distance(s.geom, a.g) / 1000)::numeric, 1)::float8 AS "distanceKm"
      FROM weather_stations s, a WHERE ST_DWithin(s.geom, a.g, ${maxKm * 1000})
      ORDER BY s.geom <-> a.g LIMIT ${limit}`)).rows;
  } else {
    const all = (await db.execute<any>(sql`SELECT id, code, name, state, latitude, longitude, altitude_m AS "altitudeM", status FROM weather_stations`)).rows;
    const dist = (p: [number, number]) => area.boundary ? distanceToBoundaryKm(p, area.boundary as BoundaryGeom) : haversineKm([area.longitude!, area.latitude!], p);
    rows = all.map((s: any) => ({ ...s, distanceKm: Math.round(dist([s.longitude, s.latitude]) * 10) / 10 }))
      .filter((s: any) => s.distanceKm <= maxKm).sort((a: any, b: any) => a.distanceKm - b.distanceKm).slice(0, limit);
  }
  const av = await availability(rows.map((r) => r.id));
  return rows.map((r) => {
    const rep = representativeness(r.distanceKm);
    return { ...r, representativeness: rep, note: REPRESENTATIVENESS_NOTE[rep], lastObservationAt: av.get(r.id)?.last ?? null, availability30dPct: av.get(r.id)?.pct ?? null, method };
  });
}

// ── Series and statistics ───────────────────────────────────────────────────
export type DailyRow = {
  day: string; hoursObserved: number; hoursPrecipitation: number; temperatureMeanC: number | null; temperatureMaxC: number | null; temperatureMinC: number | null;
  humidityMeanPct: number | null; humidityMinPct: number | null; humidity13hPct: number | null; windMeanMs: number | null; windMaxMs: number | null; wind13hMs: number | null;
  gustMaxMs: number | null; precipitationMm: number | null; flaggedHours: number;
};
export async function dailySeries(stationId: number, from: string, to: string): Promise<DailyRow[]> {
  return (await db.execute<DailyRow>(sql`
    SELECT day::text AS day, hours_observed AS "hoursObserved", hours_precipitation AS "hoursPrecipitation",
      round(temperature_mean_c::numeric, 1)::float8 AS "temperatureMeanC", temperature_max_c AS "temperatureMaxC", temperature_min_c AS "temperatureMinC",
      round(humidity_mean_pct::numeric, 1)::float8 AS "humidityMeanPct", humidity_min_pct AS "humidityMinPct", humidity_13h_pct AS "humidity13hPct",
      round(wind_mean_ms::numeric, 2)::float8 AS "windMeanMs", wind_max_ms AS "windMaxMs", wind_13h_ms AS "wind13hMs", gust_max_ms AS "gustMaxMs",
      round(precipitation_mm::numeric, 1)::float8 AS "precipitationMm", flagged_hours AS "flaggedHours"
    FROM weather_station_daily WHERE station_id = ${stationId} AND day >= ${from}::date AND day <= ${to}::date ORDER BY day`)).rows;
}
export async function hourlySeries(stationId: number, fromIso: string, toIso: string) {
  return (await db.execute(sql`
    SELECT to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:00:00"Z"') AS "observedAt", temperature_c AS "temperatureC", humidity_pct AS "humidityPct",
      wind_speed_ms AS "windSpeedMs", wind_gust_ms AS "windGustMs", precipitation_mm AS "precipitationMm", pressure_hpa AS "pressureHpa", quality_flags AS "qualityFlags",
      raw_file_name AS "rawFile", raw_line AS "rawLine"
    FROM weather_station_observations WHERE station_id = ${stationId} AND observed_at >= ${fromIso}::timestamptz AND observed_at < ${toIso}::timestamptz
    ORDER BY observed_at LIMIT 2000`)).rows;
}

export function describe(values: (number | null)[]) {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mean: null, min: null, max: null, p10: null, p50: null, p90: null, std: null };
  const q = (p: number) => { const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const std = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, v.length - 1));
  const r = (x: number) => Math.round(x * 100) / 100;
  return { n: v.length, mean: r(mean), min: r(v[0]), max: r(v[v.length - 1]), p10: r(q(0.1)), p50: r(q(0.5)), p90: r(q(0.9)), std: r(std) };
}

export function periodSummary(rows: DailyRow[], from: string, to: string) {
  const expectedDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const rainDays = rows.filter((r) => r.precipitationMm != null);
  return {
    from, to, expectedDays, daysWithData: rows.length,
    availabilityPct: Math.round((rows.reduce((s, r) => s + r.hoursObserved, 0) / (expectedDays * 24)) * 1000) / 10,
    temperatureMax: describe(rows.map((r) => r.temperatureMaxC)), temperatureMean: describe(rows.map((r) => r.temperatureMeanC)),
    humidityMin: describe(rows.map((r) => r.humidityMinPct)), humidity13h: describe(rows.map((r) => r.humidity13hPct)),
    windMax: describe(rows.map((r) => r.windMaxMs)), gustMax: describe(rows.map((r) => r.gustMaxMs)),
    precipitationTotalMm: rainDays.length ? Math.round(rainDays.reduce((s, r) => s + (r.precipitationMm ?? 0), 0) * 10) / 10 : null,
    daysWithoutRain: rainDays.filter((r) => (r.precipitationMm ?? 0) < 1).length,
    daysHumidityBelow30: rows.filter((r) => r.humidityMinPct != null && r.humidityMinPct < 30).length,
    flaggedHours: rows.reduce((s, r) => s + r.flaggedHours, 0),
  };
}

/** A day's rain total is complete when at least 22 of its 24 hours were observed. */
export const RAIN_COMPLETE_HOURS = 22;

export async function fmaSeries(stationId: number, from: string, to: string) {
  // warm-up: 120 days before the window, so the accumulation usually starts after a reset by rain
  const warm = new Date(Date.parse(from) - 120 * 86_400_000).toISOString().slice(0, 10);
  const rows = await dailySeries(stationId, warm, to);
  // every calendar day of the window, so days without any data appear as "sem dados"
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const input: FmaDayInput[] = [];
  for (let t = Date.parse(warm + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10), r = byDay.get(day);
    input.push({ day, humidity13hPct: r?.humidity13hPct ?? null, precipitationMm: r?.precipitationMm ?? null, precipitationComplete: (r?.hoursPrecipitation ?? 0) >= RAIN_COMPLETE_HOURS });
  }
  const all = computeFma(input);
  return { reference: FMA_REFERENCE, requirements: `UR às 13 h locais e chuva diária com ≥ ${RAIN_COMPLETE_HOURS} h observadas`, days: all.filter((d) => d.day >= from && d.day <= to) };
}

/** Latest observation of a station, with its age — used by the risk engine. */
export async function latestObservation(stationId: number) {
  const [o] = (await db.execute<{ observedAt: string; temperatureC: number | null; humidityPct: number | null; windSpeedMs: number | null }>(sql`
    SELECT observed_at AS "observedAt", temperature_c AS "temperatureC", humidity_pct AS "humidityPct", wind_speed_ms AS "windSpeedMs"
    FROM weather_station_observations WHERE station_id = ${stationId} ORDER BY observed_at DESC LIMIT 1`)).rows;
  if (!o) return null;
  const [rain] = (await db.execute<{ mm: number | null; hours: number }>(sql`
    SELECT sum(precipitation_mm)::float8 AS mm, count(precipitation_mm)::int AS hours FROM weather_station_observations
    WHERE station_id = ${stationId} AND observed_at > ${o.observedAt}::timestamptz - interval '72 hours' AND observed_at <= ${o.observedAt}::timestamptz`)).rows;
  return { ...o, observedAt: new Date(o.observedAt).toISOString(), precipitation72hMm: rain?.hours >= 48 ? Math.round((rain.mm ?? 0) * 10) / 10 : null, precipitationHours72h: rain?.hours ?? 0 };
}

/**
 * INMET context for a risk analysis: nearest station ≤ 50 km and its latest
 * observation if at most 3 h old. Otherwise says why INMET was not used.
 */
export async function inmetContextForArea(area: MonitoredArea, now = new Date()) {
  const { INMET_MAX_KM, INMET_MAX_AGE_H } = await import("./risk-service");
  try {
    const [st] = await stationsForArea(area, { limit: 1, maxKm: INMET_MAX_KM });
    if (!st) return { station: null, observation: null, usable: false, reason: `nenhuma estação do INMET a até ${INMET_MAX_KM} km da área.` };
    const station = { code: st.code, name: st.name, distanceKm: st.distanceKm, representativeness: st.representativeness };
    const ob = await latestObservation(st.id);
    if (!ob) return { station, observation: null, usable: false, reason: `estação ${st.code} a ${st.distanceKm} km sem observações carregadas.` };
    const ageH = (now.getTime() - Date.parse(ob.observedAt)) / 3_600_000;
    if (ageH > INMET_MAX_AGE_H) {
      return { station, observation: ob, usable: false,
        reason: `última observação disponível da estação ${st.code} (${st.distanceKm} km) é de ${new Date(ob.observedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} — ${Math.round(ageH / 24)} dia(s) atrás. ` +
          "Os dados públicos do INMET chegam por arquivo mensal; a API horária exige token do INMET. Usado o Open-Meteo para as condições atuais." };
    }
    return { station, observation: ob, usable: true, reason: "" };
  } catch (e) {
    return { station: null, observation: null, usable: false, reason: `falha ao consultar estações do INMET (${e instanceof Error ? e.message : String(e)}).` };
  }
}
