/**
 * Sisfogo (Ibama/Prevfogo) — public Registros de Ocorrência de Incêndio (ROI).
 * READ-ONLY client: only GET requests to the public endpoint, never writes.
 *
 *   GET {base}/api/v1/roi/publico?page=<1..>&size=<n>
 *
 * Contract verified against the live API on 16/11/2026 (read-only queries,
 * docs/artemis/11_SISFOGO.md §2):
 *   - envelope { pagina, tamanhoPagina, totalItens, totalPaginas, itens[] };
 *   - 1-based pages (page=0 answers like page=1); newest ROI first;
 *     a page past the end answers 200 with itens = [];
 *   - dates are nested in `datasIncendio` and are UTC instants ("…Z");
 *   - absent values are OMITTED (not null), e.g. estimativaAreaQueimada
 *     appears in roughly a quarter of the records;
 *   - the server needs ~1 s per record: size=20 ≈ 18 s, size=50 ≈ 51 s,
 *     size>=100 → HTTP 502 from the gateway after 60 s.
 *
 * This module has no database access (see server/services/sisfogo-sync.ts).
 */
import crypto from "node:crypto";

export const SISFOGO_SOURCE_KEY = "sisfogo-roi";
export const SISFOGO_ROI_PATH = "/api/v1/roi/publico";
export const SISFOGO_HEALTH_PATH = "/api/v1/roi/actuator/health/readiness";
/** Hosts documented by Ibama. Any other base URL is refused (SSRF guard). */
export const SISFOGO_ALLOWED_HOSTS = ["sisfogo.sistema.gov.br", "sisfogo.hom.ibama.gov.br"] as const;
export const SISFOGO_DEFAULT_PAGE_SIZE = 20;
/** Largest size that answered in the live tests (≈51 s); 100+ times out. */
export const SISFOGO_MAX_PAGE_SIZE = 50;

export function sisfogoBaseUrl(raw = process.env.SISFOGO_BASE_URL ?? "https://sisfogo.sistema.gov.br"): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("SISFOGO_BASE_URL inválida.");
  }
  if (u.protocol !== "https:" || !(SISFOGO_ALLOWED_HOSTS as readonly string[]).includes(u.hostname) || u.port || u.username || u.password) {
    throw new Error(`SISFOGO_BASE_URL deve ser https://${SISFOGO_ALLOWED_HOSTS.join(" ou https://")} (sem porta, usuário ou caminho).`);
  }
  return u.origin;
}

export function clampPageSize(size: unknown): number {
  const n = Math.trunc(Number(size));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), SISFOGO_MAX_PAGE_SIZE) : SISFOGO_DEFAULT_PAGE_SIZE;
}

export function sisfogoPageUrl(page: number, size: number = SISFOGO_DEFAULT_PAGE_SIZE, base = sisfogoBaseUrl()): string {
  if (!Number.isInteger(page) || page < 1) throw new Error("page inválido (inicia em 1).");
  const u = new URL(SISFOGO_ROI_PATH, base);
  u.searchParams.set("page", String(page));
  u.searchParams.set("size", String(clampPageSize(size)));
  return u.toString();
}

// ── Page envelope ────────────────────────────────────────────────────────────

export interface SisfogoPage { page: number; totalPages: number; totalItems: number; items: unknown[] }

export class SisfogoContractError extends Error {}

const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** Strict: the documented and observed envelope, or a clear error naming what came instead. */
export function parseSisfogoPage(body: unknown, requestedPage: number): SisfogoPage {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new SisfogoContractError(`Resposta do Sisfogo não é um objeto JSON (${Array.isArray(b) ? "lista" : typeof b}).`);
  const missing = ["itens", "totalPaginas", "totalItens"].filter((k) => !(k in b));
  if (missing.length) {
    throw new SisfogoContractError(`Resposta do Sisfogo fora do contrato: faltam ${missing.join(", ")}. Campos recebidos: ${Object.keys(b).slice(0, 10).join(", ") || "nenhum"}.`);
  }
  if (!Array.isArray(b.itens)) throw new SisfogoContractError('"itens" não é uma lista.');
  if (!isInt(b.totalPaginas) || !isInt(b.totalItens)) throw new SisfogoContractError('"totalPaginas"/"totalItens" não são inteiros.');
  return { page: isInt(b.pagina) ? b.pagina : requestedPage, totalPages: b.totalPaginas, totalItems: b.totalItens, items: b.itens };
}

// ── HTTP with timeout, retry and backoff ──────────────────────────────────────

export type FetchJson = (url: string, signal: AbortSignal) => Promise<{ status: number; retryAfter: string | null; json: unknown }>;

const MAX_BODY_BYTES = 20 * 1024 * 1024;

export const defaultFetchJson: FetchJson = async (url, signal) => {
  const res = await fetch(url, { signal, headers: { Accept: "application/json", "User-Agent": "ARTEMIS-AI/1.0 (leitura de dados públicos)" }, redirect: "error" });
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new Error("Resposta maior que o limite.");
  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Resposta maior que o limite.");
  let json: unknown = null;
  if (res.ok) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new SisfogoContractError("Sisfogo devolveu conteúdo que não é JSON.");
    }
  }
  return { status: res.status, retryAfter: res.headers.get("retry-after"), json };
};

export class SisfogoHttpError extends Error {
  constructor(message: string, readonly status: number | null, readonly attempts: number) {
    super(message);
  }
}

export interface RetryPolicy {
  timeoutMs: number;
  attempts: number;
  /** Base delay; attempt n waits base * 3^(n-1) ± 20 %, or Retry-After when given. */
  baseDelayMs: number;
  maxDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY: RetryPolicy = {
  timeoutMs: Number(process.env.SISFOGO_TIMEOUT_MS ?? 120_000),
  attempts: 4,
  baseDelayMs: 5_000,
  maxDelayMs: 120_000,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function retryDelay(attempt: number, retryAfter: string | null, p: RetryPolicy, rand = Math.random): number {
  const ra = retryAfter == null ? NaN : /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra, p.maxDelayMs);
  const base = p.baseDelayMs * 3 ** (attempt - 1);
  return Math.min(Math.round(base * (0.8 + rand() * 0.4)), p.maxDelayMs);
}

function describeNetworkError(err: unknown): string {
  if ((err as any)?.name === "AbortError" || (err as any)?.name === "TimeoutError") return "sem resposta no tempo limite";
  const c = (err as any)?.cause;
  const code = typeof c?.code === "string" && c.code !== "0" ? c.code : null;
  return code ?? c?.message ?? (err instanceof Error ? err.message : String(err));
}

/**
 * GET one page with timeout and retries (429/5xx/timeouts/network). 4xx other
 * than 429 and contract errors fail immediately: retrying cannot fix them.
 */
export async function fetchSisfogoPage(
  page: number,
  size: number,
  opts: { fetchJson?: FetchJson; retry?: Partial<RetryPolicy>; base?: string; onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void } = {},
): Promise<SisfogoPage & { attempts: number }> {
  const p = { ...DEFAULT_RETRY, ...opts.retry };
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const url = sisfogoPageUrl(page, size, opts.base ?? sisfogoBaseUrl());
  let lastReason = "";
  let lastStatus: number | null = null;
  for (let attempt = 1; attempt <= p.attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), p.timeoutMs);
    let retryAfter: string | null = null;
    try {
      const res = await fetchJson(url, controller.signal);
      lastStatus = res.status;
      if (res.status === 200) return { ...parseSisfogoPage(res.json, page), attempts: attempt };
      if (!RETRYABLE.has(res.status)) {
        throw new SisfogoHttpError(`Sisfogo respondeu HTTP ${res.status} (página ${page}).`, res.status, attempt);
      }
      retryAfter = res.retryAfter;
      lastReason = res.status === 429 ? "HTTP 429 (limite de requisições)" : `HTTP ${res.status}`;
    } catch (err) {
      if (err instanceof SisfogoHttpError || err instanceof SisfogoContractError) throw err;
      lastStatus = null;
      lastReason = describeNetworkError(err);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < p.attempts) {
      const waitMs = retryDelay(attempt, retryAfter, p);
      opts.onRetry?.({ attempt, waitMs, reason: lastReason });
      await p.sleep(waitMs);
    }
  }
  throw new SisfogoHttpError(`Sisfogo indisponível após ${p.attempts} tentativas (${lastReason}; página ${page}).`, lastStatus, p.attempts);
}

// ── Normalisation (live contract) ─────────────────────────────────────────────

export interface NormalizedRoi {
  externalId: string;
  roiNumber: string;
  roiStatus: string;
  rectified: boolean | null;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  startedAt: Date;
  detectedAt: Date | null;
  dispatchAt: Date | null;
  firstAttackAt: Date | null;
  controlledAt: Date | null;
  extinguishedAt: Date | null;
  /** Date and HH:MM of startedAt in Brasília time (display/compatibility; startedAt is the exact instant). */
  startedOnBrasilia: string;
  startedTimeBrasilia: string;
  municipality: string | null;
  state: string | null;
  biome: string | null;
  latitude: number | null;
  longitude: number | null;
  placeName: string | null;
  localityType: string | null;
  areaClassification: string | null;
  legalAmazon: boolean | null;
  hadCombat: boolean | null;
  responseLevel: string | null;
  institutionName: string | null;
  institutionAcronym: string | null;
  /** informacoesPosIncendio.estimativaAreaQueimada — an ESTIMATE in hectares, often absent. */
  burnedAreaHa: number | null;
  vegetation: string | null;
  structuresHit: string | null;
  contentHash: string;
  raw: unknown;
}

export type RoiRejection =
  | "sem_identificador"
  | "identificador_invalido"
  | "sem_numero_roi"
  | "status_nao_finalizado"
  | "sem_data_inicio"
  | "data_inicio_invalida";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

/**
 * ISO-8601 instant WITH an explicit zone ("Z" or ±hh:mm). A value without a
 * zone is not guessed: it returns null and the caller records a warning.
 */
export function parseInstant(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || (s ?? 0) > 59) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null; // e.g. 31/02
  return new Date(t);
}

const BRASILIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function brasiliaParts(d: Date): { date: string; time: string } {
  const p = Object.fromEntries(BRASILIA.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Generous box around Brazil's territory (incl. oceanic islands). */
const BR_BOX = { minLat: -34.9, maxLat: 5.4, minLng: -74.1, maxLng: -28.5 };

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as any)[k])]));
  return v;
}
export const contentHash = (roi: unknown) => crypto.createHash("sha256").update(JSON.stringify(canonical(roi))).digest("hex");

const list = (arr: unknown, key: string) =>
  Array.isArray(arr) ? Array.from(new Set(arr.map((x: any) => str(x?.[key])).filter((x): x is string => !!x))) : [];

export function normalizeRoi(roi: any):
  | { ok: true; row: NormalizedRoi; warnings: string[] }
  | { ok: false; reason: RoiRejection; externalId: string | null } {
  const rawId = str(roi?.id);
  if (!rawId) return { ok: false, reason: "sem_identificador", externalId: null };
  if (!UUID.test(rawId)) return { ok: false, reason: "identificador_invalido", externalId: null };
  const externalId = rawId.toLowerCase();
  const roiNumber = str(roi?.numeroRoi);
  if (!roiNumber) return { ok: false, reason: "sem_numero_roi", externalId };
  const roiStatus = str(roi?.statusRoi);
  if (!roiStatus || roiStatus.toUpperCase() !== "FINALIZADO") return { ok: false, reason: "status_nao_finalizado", externalId };

  const dates = roi?.datasIncendio ?? {};
  if (dates.dataInicioIncendio === undefined || dates.dataInicioIncendio === null) return { ok: false, reason: "sem_data_inicio", externalId };
  const startedAt = parseInstant(dates.dataInicioIncendio);
  if (!startedAt) return { ok: false, reason: "data_inicio_invalida", externalId };

  const warnings: string[] = [];
  const optInstant = (v: unknown, name: string) => {
    if (v === undefined || v === null) return null;
    const d = parseInstant(v);
    if (!d) warnings.push(`${name}_invalida`);
    return d;
  };
  const detectedAt = optInstant(dates.dataDeteccaoIncendio, "data_deteccao");
  const dispatchAt = optInstant(dates.dataInicioDeslocamento, "data_deslocamento");
  const firstAttackAt = optInstant(dates.dataPrimeiroAtaque, "data_primeiro_ataque");
  const controlledAt = optInstant(dates.dataControleIncendio, "data_controle");
  const extinguishedAt = optInstant(dates.dataExtincaoIncendio, "data_extincao");
  if (extinguishedAt && extinguishedAt < startedAt) warnings.push("extincao_antes_do_inicio");

  const local = roi?.localIncendio ?? {};
  const mun = local?.municipio ?? {};
  let latitude = num(local.latitude);
  let longitude = num(local.longitude);
  if (latitude === null || longitude === null) {
    if (latitude !== null || longitude !== null) warnings.push("coordenada_incompleta");
    latitude = null;
    longitude = null;
  } else if (latitude < BR_BOX.minLat || latitude > BR_BOX.maxLat || longitude < BR_BOX.minLng || longitude > BR_BOX.maxLng) {
    warnings.push("coordenada_fora_do_brasil");
    latitude = null;
    longitude = null;
  }

  const uf = str(mun?.unidadeFederativa?.siglaUnidadeFederativa)?.toUpperCase() ?? null;
  const state = uf && /^[A-Z]{2}$/.test(uf) ? uf : null;
  if (uf && !state) warnings.push("uf_invalida");

  const pos = roi?.informacoesPosIncendio ?? {};
  let burnedAreaHa = num(pos.estimativaAreaQueimada);
  if (pos.estimativaAreaQueimada !== undefined && burnedAreaHa === null) warnings.push("area_nao_numerica");
  if (burnedAreaHa !== null && burnedAreaHa < 0) { warnings.push("area_negativa"); burnedAreaHa = null; }

  const vegs = list(pos.vegetacoesAtingidas, "vegetacao");
  const structures = list(pos.estruturasAtingidas, "estrutura");
  const br = brasiliaParts(startedAt);

  return {
    ok: true,
    warnings,
    row: {
      externalId,
      roiNumber,
      roiStatus: roiStatus.toUpperCase(),
      rectified: bool(roi?.retificado),
      sourceCreatedAt: optInstant(roi?.dataHoraCriacao, "data_criacao"),
      sourceUpdatedAt: optInstant(roi?.dataHoraUltimaAtualizacao, "data_atualizacao"),
      startedAt,
      detectedAt,
      dispatchAt,
      firstAttackAt,
      controlledAt,
      extinguishedAt,
      startedOnBrasilia: br.date,
      startedTimeBrasilia: br.time,
      municipality: str(mun?.nomeMunicipio),
      state,
      biome: str(local?.bioma?.nomeBioma),
      latitude,
      longitude,
      placeName: str(local?.nomeLocal),
      localityType: str(local?.tipoLocalidade?.localidade),
      areaClassification: str(local?.classificacaoArea?.area),
      legalAmazon: bool(local?.isAmazoniaLegal) ?? bool(mun?.isAmazoniaLegal),
      hadCombat: bool(roi?.houveCombate),
      responseLevel: str(local?.nivelAcionamentoRoi),
      institutionName: str(roi?.instituicaoResponsavel?.nome),
      institutionAcronym: str(roi?.instituicaoResponsavel?.sigla),
      burnedAreaHa,
      vegetation: vegs.length ? vegs.join("; ") : null,
      structuresHit: structures.length ? structures.join("; ") : null,
      contentHash: contentHash(roi),
      raw: roi,
    },
  };
}
