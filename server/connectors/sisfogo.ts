/**
 * Sisfogo (Ibama/Prevfogo) connector.
 *
 * Official public API for Registros de Ocorrência de Incêndio (ROI):
 *   GET https://sisfogo.sistema.gov.br/api/v1/roi/publico?page=&size=
 *
 * - No authentication required.
 * - Rate limit: 10 req/s (peak 20). This connector stays below that.
 * - Only FINALIZADO ROIs are published.
 * - Data is anonymized (no person identifiers, no cause/observations).
 *
 * This connector never invents values: invalid/missing fields are reported
 * and the affected record is skipped rather than filled with defaults.
 */
export const SISFOGO_SOURCE = {
  key: "sisfogo",
  name: "Sisfogo — Registros de Ocorrência de Incêndio (Ibama/Prevfogo)",
  url: "https://sisfogo.sistema.gov.br",
  licence: "Dados públicos (Lei de Acesso à Informação, LGPD). Atribuição ao Ibama/Prevfogo.",
  access: "API HTTPS pública, sem autenticação, somente leitura",
  updateFrequency: "Contínua, conforme finalização de ROIs pelos órgãos aderentes",
} as const;

export const SISFOGO_BASE_URL = "https://sisfogo.sistema.gov.br";
export const SISFOGO_ROI_PATH = "/api/v1/roi/publico";
export const SISFOGO_HEALTH_PATH = "/api/v1/roi/actuator/health/readiness";
export const SISFOGO_MAX_PAGE_SIZE = 500;
export const SISFOGO_RATE_LIMIT_MS = 120; // stay below 10 req/s

export interface SisfogoPage {
  pagina: number;
  tamanhoPagina: number;
  totalItens: number;
  totalPaginas: number;
  itens: any[];
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

export class SisfogoError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export function buildSisfogoUrl(page: number, size: number): string {
  const u = new URL(SISFOGO_BASE_URL + SISFOGO_ROI_PATH);
  u.searchParams.set("page", String(page));
  u.searchParams.set("size", String(Math.min(Math.max(size, 1), SISFOGO_MAX_PAGE_SIZE)));
  return u.toString();
}

export async function fetchSisfogoPage(
  page: number,
  size: number = SISFOGO_MAX_PAGE_SIZE,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = 30000,
): Promise<SisfogoPage> {
  if (!Number.isInteger(page) || page < 1) throw new SisfogoError("page inválido");
  if (!Number.isInteger(size) || size < 1) throw new SisfogoError("size inválido");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(buildSisfogoUrl(page, size), { signal: controller.signal });
    if (!res.ok) {
      throw new SisfogoError(`Sisfogo respondeu HTTP ${res.status}`, res.status);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.itens)) {
      throw new SisfogoError("Resposta do Sisfogo sem campo 'itens' válido");
    }
    return {
      pagina: Number(data.pagina ?? page),
      tamanhoPagina: Number(data.tamanhoPagina ?? size),
      totalItens: Number(data.totalItens ?? data.itens.length),
      totalPaginas: Number(data.totalPaginas ?? 1),
      itens: data.itens,
    };
  } catch (err) {
    if (err instanceof SisfogoError) throw err;
    throw new SisfogoError("Sisfogo indisponível ou sem resposta no tempo limite");
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSisfogoHealth(fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 10000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(SISFOGO_BASE_URL + SISFOGO_HEALTH_PATH, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function isoDatePart(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const d = m[1];
  // basic validity
  const dt = new Date(d + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return null;
  return d;
}

function timePart(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const m = v.match(/T(\d{2}:\d{2})/);
  if (m) return m[1];
  const m2 = v.match(/^(\d{2}:\d{2})/);
  return m2 ? m2[1] : null;
}

export interface NormalizedRoi {
  record: {
    occurrenceDate: string | null;
    occurrenceTime: string | null;
    municipality: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
    occurrenceType: string;
    occurrenceStatus: string;
    affectedArea: number | null;
    cause: null;
    vegetationCondition: string | null;
    notes: null;
    source: string;
    sourceReference: string;
    validationStatus: "válido" | "inválido";
    rawData: any;
    dedupKey: string;
  };
  errors: string[];
}

export function normalizeRoi(roi: any): NormalizedRoi {
  const errors: string[] = [];
  const local = roi?.localIncendio ?? {};
  const muni = local?.municipio ?? {};
  const uf = muni?.unidadeFederativa ?? {};
  const pos = roi?.informacoesPosIncendio ?? {};

  const lat = typeof local.latitude === "number" ? local.latitude : null;
  const lng = typeof local.longitude === "number" ? local.longitude : null;
  if (lat !== null && (lat < -90 || lat > 90)) errors.push("latitude fora da faixa válida");
  if (lng !== null && (lng < -180 || lng > 180)) errors.push("longitude fora da faixa válida");

  const dateSource = roi?.dataInicioIncendio ?? roi?.dataDeteccaoIncendio ?? roi?.dataExtincaoIncendio ?? null;
  const occurrenceDate = isoDatePart(dateSource);
  if (dateSource && !occurrenceDate) errors.push("data de ocorrência inválida");

  const occurrenceTime = timePart(roi?.dataInicioIncendio ?? roi?.dataDeteccaoIncendio ?? null);

  const vegs = Array.isArray(pos?.vegetacoesAtingidas) ? pos.vegetacoesAtingidas.map((v: any) => v?.vegetacao).filter(Boolean) : [];
  const vegetationCondition = vegs.length ? vegs.join("; ") : null;

  const affectedArea = typeof pos?.estimativaAreaQueimada === "number" ? pos.estimativaAreaQueimada : null;
  if (affectedArea !== null && affectedArea < 0) errors.push("área afetada negativa");

  const ref = roi?.numeroRoi || roi?.id;
  const sourceReference = String(ref);

  const validationStatus: "válido" | "inválido" = errors.length ? "inválido" : "válido";

  return {
    record: {
      occurrenceDate,
      occurrenceTime,
      municipality: muni?.nomeMunicipio ?? null,
      state: uf?.siglaUnidadeFederativa ?? null,
      latitude: lat,
      longitude: lng,
      occurrenceType: "incêndio florestal",
      occurrenceStatus: "finalizado",
      affectedArea,
      cause: null,
      vegetationCondition,
      notes: null,
      source: SISFOGO_SOURCE.key,
      sourceReference,
      validationStatus,
      rawData: roi,
      dedupKey: `sisfogo:${sourceReference}`,
    },
    errors,
  };
}