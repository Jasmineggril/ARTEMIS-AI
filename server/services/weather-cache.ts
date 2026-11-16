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

export type CachedWeather = RiskWeather & { cached: boolean; fetchedAt: string };

export async function getRiskWeatherCached(latitude: number, longitude: number): Promise<CachedWeather> {
  const ttlMin = Number(process.env.WEATHER_CACHE_MINUTES ?? 30);
  const since = new Date(Date.now() - ttlMin * 60_000);
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
  const w = await fetchRiskWeather(latitude, longitude);
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
