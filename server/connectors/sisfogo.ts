/**
 * Sisfogo (Ibama/Prevfogo) — public Registros de Ocorrência de Incêndio (ROI).
 *
 *   GET https://sisfogo.sistema.gov.br/api/v1/roi/publico?page=<1..>&size=<1..500>
 *
 * According to Ibama's documentation (see docs/artemis/11_SISFOGO.md): no
 * authentication, 10 req/s limit, only FINALIZADO ROIs, anonymised data.
 * The endpoint and the field mapping below had NOT been checked against a
 * live response when this was written (the host was unreachable from the
 * development environment). The connector is therefore strict: if the
 * response does not have the documented shape it fails loudly instead of
 * guessing, and every stored record keeps the original JSON in `raw`.
 *
 * Adapted from the `feature/sisfogo-integration` branch; stores into its own
 * table (sisfogo_roi_records) and reuses source_sync_runs like the INPE sync.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { dataSources, sisfogoRoiRecords, sourceSyncRuns } from "@shared/schema";

export const SISFOGO_SOURCE_KEY = "sisfogo-roi";
export const SISFOGO_BASE_URL = process.env.SISFOGO_BASE_URL ?? "https://sisfogo.sistema.gov.br";
export const SISFOGO_ROI_PATH = "/api/v1/roi/publico";
export const SISFOGO_MAX_PAGE_SIZE = 500;
export const SISFOGO_MIN_INTERVAL_MS = 150; // < 7 req/s, below the documented 10 req/s
const MAX_PAGE_BYTES = 20 * 1024 * 1024;

export function sisfogoPageUrl(page: number, size: number = SISFOGO_MAX_PAGE_SIZE): string {
  if (!Number.isInteger(page) || page < 1) throw new Error("page inválido (inicia em 1).");
  const u = new URL(SISFOGO_ROI_PATH, SISFOGO_BASE_URL);
  u.searchParams.set("page", String(page));
  u.searchParams.set("size", String(Math.min(Math.max(Math.trunc(size) || 1, 1), SISFOGO_MAX_PAGE_SIZE)));
  return u.toString();
}

export interface SisfogoPage { page: number; totalPages: number; totalItems: number | null; items: unknown[] }

/** Validates the documented page envelope ({ itens, totalPaginas, ... }). */
export function parseSisfogoPage(body: unknown, requestedPage: number): SisfogoPage {
  if (!body || typeof body !== "object" || !Array.isArray((body as any).itens)) {
    const keys = body && typeof body === "object" ? Object.keys(body).slice(0, 10).join(", ") : typeof body;
    throw new Error(`Resposta do Sisfogo fora do formato documentado (sem "itens"). Campos recebidos: ${keys || "nenhum"}.`);
  }
  const b = body as any;
  const totalPages = Number.isInteger(b.totalPaginas) && b.totalPaginas >= 0 ? b.totalPaginas : null;
  if (totalPages === null) throw new Error('Resposta do Sisfogo sem "totalPaginas" válido.');
  return {
    page: Number.isInteger(b.pagina) ? b.pagina : requestedPage,
    totalPages,
    totalItems: Number.isInteger(b.totalItens) ? b.totalItens : null,
    items: b.itens,
  };
}

// ── Normalisation ────────────────────────────────────────────────────────────

export interface NormalizedRoi {
  externalId: string;
  roiNumber: string | null;
  roiStatus: string | null;
  rectified: boolean | null;
  startedOn: string | null;
  startedLocalTime: string | null;
  detectedOn: string | null;
  extinguishedOn: string | null;
  municipality: string | null;
  state: string | null;
  biome: string | null;
  latitude: number | null;
  longitude: number | null;
  burnedAreaHa: number | null;
  vegetation: string | null;
  raw: unknown;
}

export type RoiRejection = "sem_identificador" | "status_nao_finalizado";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "2026-08-12T14:30:00" → "2026-08-12" (calendar-checked). */
export function localDate(v: unknown): string | null {
  const m = typeof v === "string" ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "2026-08-12T14:30:00" → "14:30" (local time as published, no zone assumed). */
export function localTime(v: unknown): string | null {
  const m = typeof v === "string" ? v.match(/T([01]\d|2[0-3]):([0-5]\d)/) : null;
  return m ? `${m[1]}:${m[2]}` : null;
}

/**
 * Maps one ROI. Out-of-range values become NULL (never replaced by a guess);
 * records without an identifier, or not FINALIZADO, are rejected.
 */
export function normalizeRoi(roi: any): { ok: true; row: NormalizedRoi; warnings: string[] } | { ok: false; reason: RoiRejection } {
  const externalId = str(roi?.id);
  if (!externalId) return { ok: false, reason: "sem_identificador" };
  const status = str(roi?.statusRoi);
  if (status && status.toUpperCase() !== "FINALIZADO") return { ok: false, reason: "status_nao_finalizado" };

  const warnings: string[] = [];
  const local = roi?.localIncendio ?? {};
  const mun = local?.municipio ?? {};
  const pos = roi?.informacoesPosIncendio ?? {};

  let latitude = num(local.latitude);
  let longitude = num(local.longitude);
  if (latitude !== null && (latitude < -90 || latitude > 90)) { warnings.push("latitude_invalida"); latitude = null; }
  if (longitude !== null && (longitude < -180 || longitude > 180)) { warnings.push("longitude_invalida"); longitude = null; }
  if ((latitude === null) !== (longitude === null)) { latitude = null; longitude = null; warnings.push("coordenada_incompleta"); }

  let burnedAreaHa = num(pos.estimativaAreaQueimada);
  if (burnedAreaHa !== null && burnedAreaHa < 0) { warnings.push("area_negativa"); burnedAreaHa = null; }

  const uf = str(mun?.unidadeFederativa?.siglaUnidadeFederativa)?.toUpperCase() ?? null;
  const state = uf && /^[A-Z]{2}$/.test(uf) ? uf : null;
  if (uf && !state) warnings.push("uf_invalida");

  const vegs = Array.isArray(pos.vegetacoesAtingidas)
    ? pos.vegetacoesAtingidas.map((v: any) => str(v?.vegetacao)).filter(Boolean)
    : [];

  return {
    ok: true,
    warnings,
    row: {
      externalId,
      roiNumber: str(roi?.numeroRoi),
      roiStatus: status,
      rectified: typeof roi?.retificado === "boolean" ? roi.retificado : null,
      startedOn: localDate(roi?.dataInicioIncendio),
      startedLocalTime: localTime(roi?.dataInicioIncendio),
      detectedOn: localDate(roi?.dataDeteccaoIncendio),
      extinguishedOn: localDate(roi?.dataExtincaoIncendio),
      municipality: str(mun?.nomeMunicipio),
      state,
      biome: str(local?.bioma?.nomeBioma),
      latitude,
      longitude,
      burnedAreaHa,
      vegetation: vegs.length ? vegs.join("; ") : null,
      raw: roi,
    },
  };
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export type FetchJson = (url: string) => Promise<{ ok: boolean; status: number; json: unknown }>;

export const defaultFetchJson: FetchJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return { ok: false, status: res.status, json: null };
    const text = await res.text();
    if (text.length > MAX_PAGE_BYTES) throw new Error("Página maior que o limite.");
    try {
      return { ok: true, status: res.status, json: JSON.parse(text) };
    } catch {
      throw new Error("Sisfogo devolveu conteúdo que não é JSON.");
    }
  } catch (err) {
    if ((err as any)?.name === "AbortError") throw new Error("Sisfogo não respondeu no tempo limite (60 s).");
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

export interface SisfogoSyncResult {
  runId: number;
  status: "sucesso" | "falha";
  pages: number;
  read: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  rejectionReasons: Record<string, number>;
  error?: string;
}

async function sourceId(): Promise<number> {
  const [s] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, SISFOGO_SOURCE_KEY));
  if (!s) throw new Error("Fonte 'sisfogo-roi' não cadastrada (aplique a migração 0010).");
  return s.id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pulls pages 1..maxPages (or until the last page) and upserts by ROI id.
 * Each page is its own transaction, so a failure keeps the pages already
 * stored (upserts are idempotent; re-running continues safely). The run is
 * marked 'falha' with the page where it stopped.
 */
export async function syncSisfogo(opts: { maxPages?: number; pageSize?: number; fetchJson?: FetchJson; intervalMs?: number } = {}): Promise<SisfogoSyncResult> {
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 2000, 10_000));
  const pageSize = opts.pageSize ?? SISFOGO_MAX_PAGE_SIZE;
  const interval = opts.intervalMs ?? SISFOGO_MIN_INTERVAL_MS;
  const srcId = await sourceId();
  const [run] = await db.insert(sourceSyncRuns).values({ sourceId: srcId, params: { maxPages, pageSize, url: sisfogoPageUrl(1, pageSize) } }).returning();

  const out: SisfogoSyncResult = { runId: run.id, status: "sucesso", pages: 0, read: 0, inserted: 0, updated: 0, unchanged: 0, rejected: 0, rejectionReasons: {} };
  const reject = (reason: string) => { out.rejected++; out.rejectionReasons[reason] = (out.rejectionReasons[reason] ?? 0) + 1; };

  let page = 1;
  let totalPages = 1;
  try {
    while (page <= totalPages && page <= maxPages) {
      if (page > 1) await sleep(interval);
      const res = await fetchJson(sisfogoPageUrl(page, pageSize));
      if (!res.ok) throw new Error(res.status === 429 ? "Sisfogo limitou as requisições (HTTP 429)." : `Sisfogo respondeu HTTP ${res.status}.`);
      const p = parseSisfogoPage(res.json, page);
      totalPages = p.totalPages;
      out.read += p.items.length;

      const rows: (NormalizedRoi & { sourceId: number; syncRunId: number })[] = [];
      const seen = new Set<string>();
      for (const item of p.items) {
        const n = normalizeRoi(item);
        if (!n.ok) { reject(n.reason); continue; }
        if (seen.has(n.row.externalId)) { reject("duplicado_na_pagina"); continue; }
        seen.add(n.row.externalId);
        n.warnings.forEach((w) => (out.rejectionReasons[`campo_descartado:${w}`] = (out.rejectionReasons[`campo_descartado:${w}`] ?? 0) + 1));
        rows.push({ ...n.row, sourceId: srcId, syncRunId: run.id });
      }

      if (rows.length) {
        await db.transaction(async (tx) => {
          const res = await tx
            .insert(sisfogoRoiRecords)
            .values(rows)
            .onConflictDoUpdate({
              target: [sisfogoRoiRecords.sourceId, sisfogoRoiRecords.externalId],
              set: {
                roiNumber: sql`excluded.roi_number`, roiStatus: sql`excluded.roi_status`, rectified: sql`excluded.rectified`,
                startedOn: sql`excluded.started_on`, startedLocalTime: sql`excluded.started_local_time`,
                detectedOn: sql`excluded.detected_on`, extinguishedOn: sql`excluded.extinguished_on`,
                municipality: sql`excluded.municipality`, state: sql`excluded.state`, biome: sql`excluded.biome`,
                latitude: sql`excluded.latitude`, longitude: sql`excluded.longitude`,
                burnedAreaHa: sql`excluded.burned_area_ha`, vegetation: sql`excluded.vegetation`,
                raw: sql`excluded.raw`, lastSeenAt: sql`now()`, syncRunId: sql`excluded.sync_run_id`,
              },
              // rectified ROIs change; untouched ones are left alone
              setWhere: sql`${sisfogoRoiRecords.raw}::text IS DISTINCT FROM excluded.raw::text`,
            })
            .returning({ inserted: sql<boolean>`(xmax = 0)` });
          res.forEach((r) => (r.inserted ? out.inserted++ : out.updated++));
          out.unchanged += rows.length - res.length;
        });
      }
      out.pages = page;
      page++;
    }
    await db.update(sourceSyncRuns).set({
      status: "sucesso", finishedAt: new Date(), recordsRead: out.read, recordsInserted: out.inserted,
      recordsUpdated: out.updated, recordsRejected: out.rejected, rejectionReasons: out.rejectionReasons,
      params: { maxPages, pageSize, pagesRead: out.pages, totalPages, truncated: totalPages > maxPages },
    }).where(eq(sourceSyncRuns.id, run.id));
    await db.update(dataSources).set({ lastUpdate: new Date() }).where(eq(dataSources.key, SISFOGO_SOURCE_KEY));
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const c = (err as any)?.cause;
    const cause = typeof c?.code === "string" && c.code !== "0" ? c.code : c?.message;
    const detail = msg === "fetch failed" ? `Sisfogo inacessível (${cause ?? "erro de rede"})` : msg;
    const error = `${detail} — página ${page}${page > 1 ? `; páginas 1–${page - 1} gravadas` : ""}`;
    await db.update(sourceSyncRuns).set({
      status: "falha", finishedAt: new Date(), error, recordsRead: out.read, recordsInserted: out.inserted,
      recordsUpdated: out.updated, recordsRejected: out.rejected, rejectionReasons: out.rejectionReasons,
    }).where(eq(sourceSyncRuns.id, run.id));
    return { ...out, status: "falha", error };
  }
}

/** Last successful sync, for the public page to state how current the data is. */
export async function sisfogoLastSuccess(): Promise<Date | null> {
  const [r] = await db
    .select({ at: sourceSyncRuns.finishedAt })
    .from(sourceSyncRuns)
    .innerJoin(dataSources, eq(dataSources.id, sourceSyncRuns.sourceId))
    .where(and(eq(dataSources.key, SISFOGO_SOURCE_KEY), eq(sourceSyncRuns.status, "sucesso")))
    .orderBy(sql`${sourceSyncRuns.finishedAt} desc`)
    .limit(1);
  return r?.at ?? null;
}
