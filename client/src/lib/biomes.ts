import { PRODUCT_NAME } from "@shared/identity";

export type BrazilianBiome = "Amazônia" | "Cerrado" | "Mata Atlântica" | "Caatinga" | "Pampa" | "Pantanal";

export type BrazilianLocationContext = {
  municipality: string;
  state: string;
  biome: BrazilianBiome;
};

type BiomeReference = {
  biome: BrazilianBiome;
  municipality: string;
  latitude: number;
  longitude: number;
};

const BIOME_REFERENCES: BiomeReference[] = [
  { biome: "Amazônia", municipality: "Manaus", latitude: -3.119, longitude: -60.021 },
  { biome: "Amazônia", municipality: "Belém", latitude: -1.455, longitude: -48.503 },
  { biome: "Amazônia", municipality: "Porto Velho", latitude: -8.760, longitude: -63.899 },
  { biome: "Cerrado", municipality: "Brasília", latitude: -15.793, longitude: -47.882 },
  { biome: "Cerrado", municipality: "Goiânia", latitude: -16.686, longitude: -49.264 },
  { biome: "Cerrado", municipality: "Cuiabá", latitude: -15.601, longitude: -56.097 },
  { biome: "Mata Atlântica", municipality: "São Paulo", latitude: -23.556, longitude: -46.633 },
  { biome: "Mata Atlântica", municipality: "Rio de Janeiro", latitude: -22.906, longitude: -43.172 },
  { biome: "Mata Atlântica", municipality: "Curitiba", latitude: -25.429, longitude: -49.271 },
  { biome: "Caatinga", municipality: "Fortaleza", latitude: -3.731, longitude: -38.526 },
  { biome: "Caatinga", municipality: "Recife", latitude: -8.047, longitude: -34.877 },
  { biome: "Caatinga", municipality: "Salvador", latitude: -12.977, longitude: -38.501 },
  { biome: "Pampa", municipality: "Porto Alegre", latitude: -30.034, longitude: -51.217 },
  { biome: "Pantanal", municipality: "Campo Grande", latitude: -20.469, longitude: -54.620 },
  { biome: "Pantanal", municipality: "Corumbá", latitude: -19.008, longitude: -57.652 },
];

const LOCATION_REFERENCES: BrazilianLocationContext[] = [
  { municipality: "Unaí", state: "MG", biome: "Cerrado" },
  { municipality: "Sinop", state: "MT", biome: "Amazônia" },
  { municipality: "Corumbá", state: "MS", biome: "Pantanal" },
  { municipality: "Santarém", state: "PA", biome: "Amazônia" },
  { municipality: "Brasília", state: "DF", biome: "Cerrado" },
  { municipality: "Manaus", state: "AM", biome: "Amazônia" },
  { municipality: "Barreiras", state: "BA", biome: "Cerrado" },
  { municipality: "Goiânia", state: "GO", biome: "Cerrado" },
  { municipality: "Cuiabá", state: "MT", biome: "Cerrado" },
  { municipality: "Fortaleza", state: "CE", biome: "Caatinga" },
  { municipality: "Recife", state: "PE", biome: "Caatinga" },
  { municipality: "Salvador", state: "BA", biome: "Caatinga" },
  { municipality: "Porto Alegre", state: "RS", biome: "Pampa" },
];

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceKm(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const earthRadiusKm = 6371;
  const latitudeDifference = toRadians(latitudeB - latitudeA);
  const longitudeDifference = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDifference / 2) * Math.sin(latitudeDifference / 2) +
    Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDifference / 2) * Math.sin(longitudeDifference / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getClosestBiome(latitude: number, longitude: number): BrazilianBiome {
  return BIOME_REFERENCES.reduce((closest, candidate) => {
    const candidateDistance = distanceKm(latitude, longitude, candidate.latitude, candidate.longitude);
    if (!closest || candidateDistance < closest.distance) {
      return { biome: candidate.biome, distance: candidateDistance };
    }
    return closest;
  }, null as null | { biome: BrazilianBiome; distance: number })?.biome ?? "Cerrado";
}

export function getBiomeLabel(biome: BrazilianBiome) {
  return `Análise Preditiva de Focos no bioma ${biome}`;
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Returns a location context only from city-level matches (high-confidence).
 * Unlike getLocationContextFromText, this never uses state-level heuristics,
 * so it is safe to call when deciding whether to overwrite an existing location.
 */
export function getCityLevelLocationContext(text: string): BrazilianLocationContext | null {
  const normalizedText = normalizeText(text);
  const byCity = LOCATION_REFERENCES.find((location) => {
    const cityNorm = normalizeText(location.municipality);
    return new RegExp(`\\b${cityNorm}\\b`).test(normalizedText);
  });
  return byCity ?? null;
}

/**
 * Returns a location context from explicit text mentions.
 * City-level matches (from LOCATION_REFERENCES) are high-confidence.
 * State-level fallbacks are lower-confidence; they require distinctive
 * multi-word phrases to avoid false positives with common Portuguese words.
 */
export function getLocationContextFromText(text: string): BrazilianLocationContext | null {
  const normalizedText = normalizeText(text);

  // High-confidence: specific city name found (word-boundary check to avoid
  // partial matches like "fortalecimento" → "Fortaleza").
  const byCity = LOCATION_REFERENCES.find((location) => {
    const cityNorm = normalizeText(location.municipality);
    return new RegExp(`\\b${cityNorm}\\b`).test(normalizedText);
  });
  if (byCity) return byCity;

  // State-level fallbacks — ordered longest-match first to avoid prefix collisions.
  // Use multi-word or distinctive patterns only to minimise false positives.
  if (normalizedText.includes("mato grosso do sul")) return { municipality: "Corumbá", state: "MS", biome: "Pantanal" };
  if (normalizedText.includes("mato grosso")) return { municipality: "Cuiabá", state: "MT", biome: "Cerrado" };
  if (normalizedText.includes("amazonas")) return { municipality: "Manaus", state: "AM", biome: "Amazônia" };
  if (normalizedText.includes("distrito federal")) return { municipality: "Brasília", state: "DF", biome: "Cerrado" };

  // "Bahia" is distinctive; check word boundary to avoid partial matches.
  if (/\bbahia\b/.test(normalizedText)) return { municipality: "Barreiras", state: "BA", biome: "Cerrado" };

  // "Pará" (state) vs "para" (preposition) differ only in the accent.
  // Check the ORIGINAL text (before accent stripping) so the bare preposition
  // does not trigger a false match. Accept "Pará" (with accent) or
  // the explicit city "Santarém" / "santarém".
  const lowerOriginal = text.toLowerCase();
  if (/\bpar[aá]\b/.test(lowerOriginal) && lowerOriginal.includes("pará")) {
    return { municipality: "Santarém", state: "PA", biome: "Amazônia" };
  }
  if (normalizedText.includes("santarem")) {
    return { municipality: "Santarém", state: "PA", biome: "Amazônia" };
  }

  return null;
}

export function buildContextualIntro(context: BrazilianLocationContext) {
  const locationLabel = `${context.municipality} - ${context.state}`;
  return [
    `📍 Localização identificada: ${locationLabel}`,
    `🌿 Bioma predominante: ${context.biome}`,
    `🌎 Legislação aplicável: Código Florestal Brasileiro, normas ambientais e protocolos de prevenção de incêndios`,
    `🔥 Situação ambiental: Exibindo análise preditiva de focos de calor para o bioma ${context.biome}.`,
    `🤖 ${PRODUCT_NAME}: Analisando riscos de incêndio para o bioma ${context.biome} em ${context.municipality}.`,
  ].join("\n");
}
