/**
 * Open-Meteo with a persistent cache in weather_data (kind = 'atual').
 * A value fetched less than WEATHER_CACHE_MINUTES ago (default 30) for the same
 * coordinate rounded to ~1 km is reused instead of calling the API again.
 * Cache misses are stored with source, observation time and fetch time.
 */
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { weatherData } from "@shared/schema";
import { fetchRiskWeather, OPEN_METEO_SOURCE, type RiskWeather } from "../connectors/open-meteo";

export type CachedWeather = RiskWeather & { cached: boolean; fetchedAt: string; stale?: boolean };

/** When the API fails, a stored value up to this old may be used — stated in the analysis limitations. */
const STALE_MAX_MIN = Number(process.env.WEATHER_STALE_MAX_MINUTES ?? 180);

async function lookup(latitude: number, longitude: number, maxAgeMin: number) {
  const since = new Date(Date.now() - maxAgeMin * 60_000);
  const [hit] = await db
    .select()
    .from(weatherData)
    .where(and(
      eq(weatherData.sourceKey, OPEN_METEO_SOURCE.key),
      eq(weatherData.kind, "atual"),
      sql`round(${weatherData.latitude}::numeric, 2) = round(${latitude}::numeric, 2)`,
      sql`round(${weatherData.longitude}::numeric, 2) = round(${longitude}::numeric, 2)`,
      gte(weatherData.fetchedAt, since),
      isNotNull(weatherData.precipitation72h),
    ))
    .orderBy(desc(weatherData.fetchedAt))
    .limit(1);
  if (hit && hit.temperature != null && hit.humidity != null && hit.windSpeed != null && hit.observedAt) {
    return {
      temperature: hit.temperature, humidity: hit.humidity, windSpeed: hit.windSpeed,
      precipitation72h: hit.precipitation72h!, referenceAt: hit.observedAt.toISOString(),
      source: OPEN_METEO_SOURCE.key, cached: true, fetchedAt: hit.fetchedAt.toISOString(),
    };
  }
  return null;
}

export async function getRiskWeatherCached(latitude: number, longitude: number): Promise<CachedWeather> {
  const fresh = await lookup(latitude, longitude, Number(process.env.WEATHER_CACHE_MINUTES ?? 30));
  if (fresh) return fresh;
  let w: RiskWeather;
  try {
    w = await fetchRiskWeather(latitude, longitude);
  } catch (err) {
    const old = await lookup(latitude, longitude, STALE_MAX_MIN);
    if (old) return { ...old, stale: true };
    throw err;
  }
  const fetchedAt = new Date();
  try {
    await db.insert(weatherData).values({
      latitude, longitude, temperature: w.temperature, humidity: w.humidity, windSpeed: w.windSpeed,
      precipitation72h: w.precipitation72h, sourceKey: OPEN_METEO_SOURCE.key, kind: "atual",
      observedAt: new Date(w.referenceAt), fetchedAt,
    });
  } catch (err) {
    // Cache write failure must not fail the analysis; the value itself is valid.
    console.warn(JSON.stringify({ level: "warn", msg: "weather_cache_write_failed", err: String(err) }));
  }
  return { ...w, cached: false, fetchedAt: fetchedAt.toISOString() };
}
