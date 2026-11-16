/**
 * ARTEMIS AI — risk analysis orchestration (predictive module).
 *
 * Builds engine inputs with per-field provenance, runs the Python service
 * (FastAPI) and falls back to the TypeScript transparent rule engine when it is
 * unavailable. Never fills a missing meteorological value with a default.
 */
import { z } from "zod";
import { calculateRisk, type RiskInput, type RiskFactor, type RiskRecommendation, type RiskLevel } from "@shared/risk-engine";
import { DECISION_SUPPORT_DISCLAIMER } from "@shared/identity";
import { fetchRiskWeather, OPEN_METEO_SOURCE, type FetchLike, type RiskWeather } from "../connectors/open-meteo";

export const analysisRequestSchema = z.object({
  useLiveWeather: z.boolean().default(false),
  inputs: z
    .object({
      temperature: z.number().min(-20).max(60).optional(),
      humidity: z.number().min(0).max(100).optional(),
      windSpeed: z.number().min(0).max(200).optional(),
      recentRainfall: z.number().min(0).max(2000).optional(),
      vegetationCondition: z.enum(["very_dry", "dry", "moderate", "humid"]),
      // omitted = check INPE satellite detections automatically (when data is fresh)
      nearbyHotspot: z.boolean().optional(),
      hotspotDistance: z.number().min(0).max(1000).optional(),
      historicalOccurrences: z.number().int().min(0).max(100000).optional(),
      dataQuality: z.enum(["poor", "regular", "good", "excellent"]).optional(),
    })
    .strict(),
  notes: z.string().max(2000).optional(),
});
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

type FieldOrigin = "manual" | "open-meteo" | "base-historica-organizacao" | "inpe-queimadas" | "nao-verificado";

export interface Provenance {
  field: string;
  origin: FieldOrigin;
  referenceAt?: string;
}

export interface EngineOutput {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  recommendations: RiskRecommendation[];
  engineType: string;
  modelVersion: string;
  isExperimental: boolean;
  datasetType: string;
}

export class MissingInputError extends Error {
  constructor(public readonly missing: string[], public readonly connectorError?: string) {
    super(`Dados obrigatórios ausentes: ${missing.join(", ")}`);
  }
}

const VEG_TO_NUM: Record<string, 0 | 1 | 2 | 3> = { very_dry: 0, dry: 1, moderate: 2, humid: 3 };
const QUALITY_TO_NUM: Record<string, 0 | 1 | 2 | 3> = { poor: 0, regular: 1, good: 2, excellent: 3 };
const FIELD_LABEL: Record<string, string> = {
  temperature: "temperatura",
  humidity: "umidade relativa",
  windSpeed: "velocidade do vento",
  recentRainfall: "precipitação 72 h",
};

export function normalizeLevel(level: string): RiskLevel {
  const l = level.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (l === "critico") return "crítico";
  if (l === "alto" || l === "moderado" || l === "baixo") return l;
  throw new Error(`Nível de risco desconhecido: ${level}`);
}

/** Satellite detections around the area, computed by the caller from satellite_hotspots. */
export interface HotspotContext {
  fresh: boolean;
  lastSyncAt: Date | null;
  nearestKm: number | null;
  count: number;
  radiusKm: number;
  windowHours: number;
}

export type WeatherProvider = (lat: number, lng: number) => Promise<RiskWeather & { cached?: boolean }>;

export interface ResolvedInputs {
  engineInput: RiskInput;
  pythonPayload: Record<string, unknown>;
  provenance: Provenance[];
  weather: (RiskWeather & { cached?: boolean }) | null;
  hotspots: HotspotContext | null;
  hotspotOrigin: "manual" | "inpe-queimadas" | "nao-verificado";
  connectorError?: string;
  qualityLabel: string;
}

/**
 * Merge manual inputs with live weather. Manual values always win (the user
 * may hold on-site measurements); live data fills only what is missing.
 */
export async function resolveInputs(
  req: AnalysisRequest,
  area: { latitude: number | null; longitude: number | null },
  historicalCount: number | null,
  fetchImpl?: FetchLike,
  ctx: { hotspots?: HotspotContext | null; weatherProvider?: WeatherProvider } = {},
): Promise<ResolvedInputs> {
  const i = req.inputs;
  const provenance: Provenance[] = [];
  let weather: (RiskWeather & { cached?: boolean }) | null = null;
  let connectorError: string | undefined;

  const meteoFields = ["temperature", "humidity", "windSpeed", "recentRainfall"] as const;
  const needsWeather = meteoFields.some((f) => i[f] === undefined);

  if (req.useLiveWeather && needsWeather) {
    if (area.latitude == null || area.longitude == null) {
      connectorError = "Área sem coordenadas: não é possível consultar dados meteorológicos.";
    } else {
      try {
        weather = ctx.weatherProvider && !fetchImpl
          ? await ctx.weatherProvider(area.latitude, area.longitude)
          : await fetchRiskWeather(area.latitude, area.longitude, fetchImpl);
      } catch (err) {
        connectorError = err instanceof Error ? err.message : "Falha no conector meteorológico.";
      }
    }
  }

  const values: Record<(typeof meteoFields)[number], number | undefined> = {
    temperature: i.temperature,
    humidity: i.humidity,
    windSpeed: i.windSpeed,
    recentRainfall: i.recentRainfall,
  };
  const fromWeather: Record<(typeof meteoFields)[number], number | undefined> = {
    temperature: weather?.temperature,
    humidity: weather?.humidity,
    windSpeed: weather?.windSpeed,
    recentRainfall: weather?.precipitation72h,
  };

  const missing: string[] = [];
  for (const f of meteoFields) {
    if (values[f] !== undefined) {
      provenance.push({ field: f, origin: "manual" });
    } else if (fromWeather[f] !== undefined) {
      values[f] = fromWeather[f];
      provenance.push({ field: f, origin: "open-meteo", referenceAt: weather!.referenceAt });
    } else {
      missing.push(FIELD_LABEL[f]);
    }
  }
  if (missing.length > 0) throw new MissingInputError(missing, connectorError);

  let historical = i.historicalOccurrences;
  if (historical !== undefined) {
    provenance.push({ field: "historicalOccurrences", origin: "manual" });
  } else if (historicalCount !== null) {
    historical = historicalCount;
    provenance.push({ field: "historicalOccurrences", origin: "base-historica-organizacao" });
  } else {
    historical = 0;
  }
  provenance.push({ field: "vegetationCondition", origin: "manual" });

  // Nearby hotspot: user statement wins; otherwise fresh INPE detections; otherwise unverified.
  let nearbyHotspot: boolean;
  let hotspotDistance: number | undefined = i.hotspotDistance;
  let hotspotOrigin: ResolvedInputs["hotspotOrigin"];
  const hs = ctx.hotspots ?? null;
  if (i.nearbyHotspot !== undefined) {
    nearbyHotspot = i.nearbyHotspot;
    hotspotOrigin = "manual";
    provenance.push({ field: "nearbyHotspot", origin: "manual" });
  } else if (hs && hs.fresh) {
    nearbyHotspot = hs.count > 0;
    hotspotDistance = hs.nearestKm ?? undefined;
    hotspotOrigin = "inpe-queimadas";
    provenance.push({ field: "nearbyHotspot", origin: "inpe-queimadas", referenceAt: hs.lastSyncAt?.toISOString() });
  } else {
    nearbyHotspot = false;
    hotspotOrigin = "nao-verificado";
    provenance.push({ field: "nearbyHotspot", origin: "nao-verificado" });
  }

  // Data quality: explicit user statement wins; otherwise derived from origins.
  const derivedQuality = weather ? "good" : "regular";
  const quality = i.dataQuality ?? derivedQuality;

  const engineInput: RiskInput = {
    temperature: values.temperature!,
    humidity: values.humidity!,
    windSpeed: values.windSpeed!,
    recentRainfall: values.recentRainfall!,
    vegetationCondition: VEG_TO_NUM[i.vegetationCondition],
    nearbyHotspot,
    hotspotDistance: nearbyHotspot ? (hotspotDistance ?? 0) : 0,
    historicalOccurrences: historical,
    dataQuality: QUALITY_TO_NUM[quality],
  };

  const pythonPayload = {
    temperature: engineInput.temperature,
    humidity: engineInput.humidity,
    wind_speed: engineInput.windSpeed,
    recent_rainfall: engineInput.recentRainfall,
    vegetation_condition: i.vegetationCondition,
    nearby_hotspot: nearbyHotspot,
    hotspot_distance: nearbyHotspot ? (hotspotDistance ?? null) : null,
    historical_occurrences: historical,
    data_quality: quality,
  };

  const qualityLabel = { poor: "ruim", regular: "regular", good: "boa", excellent: "excelente" }[quality];
  return { engineInput, pythonPayload, provenance, weather, hotspots: hs, hotspotOrigin, connectorError, qualityLabel };
}

function runTsEngine(input: RiskInput, engineType: string): EngineOutput {
  const r = calculateRisk(input, false);
  return {
    score: r.score,
    level: r.level,
    factors: r.factors,
    recommendations: r.recommendations,
    engineType,
    modelVersion: `ts-${r.calculationVersion}`,
    isExperimental: false,
    datasetType: "rule-based",
  };
}

export async function runEngine(
  resolved: ResolvedInputs,
  fetchImpl: typeof fetch = fetch,
): Promise<EngineOutput> {
  const mode = (process.env.RISK_ENGINE ?? "python").toLowerCase();
  if (mode === "ts") return runTsEngine(resolved.engineInput, "transparent-rule-engine-ts");

  const base = process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8000";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetchImpl(`${base}/analyze-risk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(resolved.pythonPayload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`python HTTP ${res.status}`);
    const d = await res.json();
    if (typeof d?.score !== "number" || d.score < 0 || d.score > 100) throw new Error("python invalid score");
    return {
      score: Math.round(d.score),
      level: normalizeLevel(String(d.level)),
      factors: Array.isArray(d.factors) ? d.factors : [],
      recommendations: Array.isArray(d.recommendations) ? d.recommendations : [],
      engineType: String(d.model_type ?? "unknown"),
      modelVersion: String(d.model_version ?? "unknown"),
      isExperimental: Boolean(d.is_experimental) || d.dataset_type === "synthetic",
      datasetType: String(d.dataset_type ?? "unknown"),
    };
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", msg: "python_engine_unavailable", err: String(err) }));
    return runTsEngine(resolved.engineInput, "transparent-rule-engine-ts-fallback");
  } finally {
    clearTimeout(timer);
  }
}

export function buildLimitations(resolved: ResolvedInputs, engine: EngineOutput): string[] {
  const out: string[] = [
    "Limiares do motor de regras documentados, porém ainda não calibrados com dados reais de incêndio da área.",
  ];
  if (engine.isExperimental) {
    out.push("Resultado do modelo supervisionado EXPERIMENTAL, treinado com dataset sintético. Não usar como base operacional.");
  }
  if (engine.engineType.endsWith("ts-fallback")) {
    out.push("Serviço Python indisponível: utilizado o motor de regras TypeScript equivalente (fallback).");
  }
  if (resolved.provenance.some((p) => p.origin === "manual" && ["temperature", "humidity", "windSpeed", "recentRainfall"].includes(p.field))) {
    out.push("Uma ou mais variáveis meteorológicas foram informadas manualmente e não foram verificadas pela plataforma.");
  }
  if (resolved.weather) {
    out.push("Dados do Open-Meteo são estimativas de modelo numérico para a coordenada, não medições de estação no local.");
  }
  if (resolved.connectorError) {
    out.push(`Conector meteorológico: ${resolved.connectorError}`);
  }
  out.push("Condição da vegetação informada pelo usuário (não há índice de vegetação por satélite integrado).");
  if (resolved.hotspotOrigin === "inpe-queimadas" && resolved.hotspots) {
    const h = resolved.hotspots;
    out.push(`Proximidade de focos calculada com detecções do INPE num raio de ${h.radiusKm} km nas últimas ${h.windowHours} h ` +
      `(${h.count} detecção(ões); última sincronização ${h.lastSyncAt?.toISOString() ?? "—"}). Várias detecções podem ser do mesmo fogo.`);
  } else if (resolved.hotspotOrigin === "nao-verificado") {
    out.push("Proximidade de focos NÃO verificada: dados do INPE ausentes ou desatualizados. Considerada ausente — informe manualmente se houver foco conhecido.");
  } else {
    out.push("Proximidade de focos informada pelo usuário.");
  }
  if (resolved.weather?.cached) out.push("Dados meteorológicos reaproveitados do cache local (consulta ao Open-Meteo de até 30 min atrás).");
  out.push("Focos de calor detectados por satélite não equivalem a incêndios confirmados.");
  out.push(DECISION_SUPPORT_DISCLAIMER);
  return out;
}

export function buildDataSources(resolved: ResolvedInputs) {
  const sources: { key: string; name: string; referenceAt?: string; url?: string; licence?: string }[] = [];
  if (resolved.provenance.some((p) => p.origin === "manual")) {
    sources.push({ key: "manual", name: "Entrada manual do usuário" });
  }
  if (resolved.weather) {
    sources.push({
      key: OPEN_METEO_SOURCE.key,
      name: OPEN_METEO_SOURCE.name,
      referenceAt: resolved.weather.referenceAt,
      url: OPEN_METEO_SOURCE.url,
      licence: OPEN_METEO_SOURCE.licence,
    });
  }
  if (resolved.hotspotOrigin === "inpe-queimadas" && resolved.hotspots) {
    sources.push({ key: "inpe-queimadas", name: "INPE — Programa Queimadas (focos de calor por satélite)", referenceAt: resolved.hotspots.lastSyncAt?.toISOString(), url: "https://terrabrasilis.dpi.inpe.br/queimadas/portal/" });
  }
  if (resolved.provenance.some((p) => p.origin === "base-historica-organizacao")) {
    sources.push({ key: "fire_occurrences", name: "Ocorrências históricas importadas pela organização (raio de 10 km)" });
  }
  return sources;
}

/** Haversine distance in km. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
