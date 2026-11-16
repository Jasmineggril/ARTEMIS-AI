/**
 * Open-Meteo connector (https://open-meteo.com).
 *
 * - Access: public HTTPS API, no key. Licence: data CC BY 4.0 (attribution
 *   "Weather data by Open-Meteo.com"); free tier is for non-commercial use —
 *   commercial operation requires reviewing their terms / paid plan.
 * - Data: model-based current conditions and hourly precipitation. These are
 *   NOT on-site station measurements.
 * - On failure this connector returns an error; it never fabricates values.
 */

export const OPEN_METEO_SOURCE = {
  key: "open-meteo",
  name: "Open-Meteo (previsão/reanálise meteorológica)",
  url: "https://open-meteo.com/en/docs",
  licence: "CC BY 4.0 — atribuição obrigatória; uso comercial requer revisão dos termos",
  access: "API HTTPS pública, sem chave",
  updateFrequency: "Condições atuais a cada 15 min; precipitação horária",
} as const;

export interface RiskWeather {
  temperature: number;      // °C
  humidity: number;         // %
  windSpeed: number;        // km/h
  precipitation72h: number; // mm, sum of the last 72 hourly values up to now
  referenceAt: string;      // ISO time of the "current" block
  source: typeof OPEN_METEO_SOURCE.key;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

export class ConnectorError extends Error {
  constructor(message: string, public readonly source: string) {
    super(message);
  }
}

export function buildOpenMeteoUrl(latitude: number, longitude: number): string {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,wind_speed_10m");
  url.searchParams.set("hourly", "precipitation");
  url.searchParams.set("past_days", "3");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timezone", "UTC");
  return url.toString();
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Validates and converts the API payload. Exported for tests. */
export function parseOpenMeteo(payload: any): RiskWeather {
  const cur = payload?.current;
  if (!cur || !isFiniteNumber(cur.temperature_2m) || !isFiniteNumber(cur.relative_humidity_2m) || !isFiniteNumber(cur.wind_speed_10m)) {
    throw new ConnectorError("Resposta do Open-Meteo sem variáveis atuais válidas.", OPEN_METEO_SOURCE.key);
  }
  if (cur.relative_humidity_2m < 0 || cur.relative_humidity_2m > 100 || cur.wind_speed_10m < 0) {
    throw new ConnectorError("Valores fora de faixa física na resposta do Open-Meteo.", OPEN_METEO_SOURCE.key);
  }
  const refTime = String(cur.time ?? "");
  const refMs = Date.parse(refTime.endsWith("Z") ? refTime : `${refTime}Z`);
  if (!Number.isFinite(refMs)) {
    throw new ConnectorError("Horário de referência ausente na resposta do Open-Meteo.", OPEN_METEO_SOURCE.key);
  }

  const times: string[] = payload?.hourly?.time ?? [];
  const values: unknown[] = payload?.hourly?.precipitation ?? [];
  if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length || times.length === 0) {
    throw new ConnectorError("Série horária de precipitação ausente ou inconsistente.", OPEN_METEO_SOURCE.key);
  }
  const windowStart = refMs - 72 * 3600 * 1000;
  let sum = 0;
  let counted = 0;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i].endsWith("Z") ? times[i] : `${times[i]}Z`);
    const v = values[i];
    if (t > windowStart && t <= refMs && isFiniteNumber(v)) {
      sum += v;
      counted++;
    }
  }
  if (counted < 48) {
    // less than 2/3 of the window available: do not pretend we know 72h rainfall
    throw new ConnectorError("Série de precipitação incompleta para a janela de 72 h.", OPEN_METEO_SOURCE.key);
  }

  return {
    temperature: cur.temperature_2m,
    humidity: cur.relative_humidity_2m,
    windSpeed: cur.wind_speed_10m,
    precipitation72h: Math.round(sum * 10) / 10,
    referenceAt: new Date(refMs).toISOString(),
    source: OPEN_METEO_SOURCE.key,
  };
}

export async function fetchRiskWeather(
  latitude: number,
  longitude: number,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = 6000,
): Promise<RiskWeather> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(buildOpenMeteoUrl(latitude, longitude), { signal: controller.signal });
    if (!res.ok) throw new ConnectorError(`Open-Meteo respondeu HTTP ${res.status}.`, OPEN_METEO_SOURCE.key);
    return parseOpenMeteo(await res.json());
  } catch (err) {
    if (err instanceof ConnectorError) throw err;
    throw new ConnectorError("Open-Meteo indisponível ou sem resposta no tempo limite.", OPEN_METEO_SOURCE.key);
  } finally {
    clearTimeout(timer);
  }
}
