/**
 * Sisfogo → PostgreSQL synchronisation.
 *
 * Each ROI is classified against what is already stored:
 *   novo        not seen before                      → mirror + revision 1 + fire_occurrences
 *   inalterado  same content hash                    → only "last seen" bookkeeping
 *   retificado  content changed and retificado=true  → new revision, mirror and occurrence updated
 *   atualizado  content changed otherwise            → new revision, mirror and occurrence updated
 *   inválido    fails the contract (no id, not FINALIZADO, no valid start date…) → counted, nothing written
 *   indisponível  stored before but absent from a COMPLETE run → flagged, never deleted
 *
 * Guarantees:
 *   - one run per source at a time (PostgreSQL advisory lock); a second call gets SisfogoBusyError;
 *   - every page is one transaction: a failure keeps earlier pages, never half a page;
 *   - nothing is held in memory beyond the current page;
 *   - re-running is idempotent (keys: data_source_id + ROI UUID); progress is stored per page,
 *     so a failed run can be resumed (`resume: true`).
 */
import { and, eq, inArray, ne, or, isNull, sql, desc } from "drizzle-orm";
import { db, pool } from "../db";
import { dataSources, fireOccurrences, sisfogoRoiRecords, sourceRecordRevisions, sourceSyncRuns } from "@shared/schema";
import {
  SISFOGO_DEFAULT_PAGE_SIZE,
  SISFOGO_SOURCE_KEY,
  clampPageSize,
  fetchSisfogoPage,
  normalizeRoi,
  type FetchJson,
  type NormalizedRoi,
  type RetryPolicy,
} from "../connectors/sisfogo";

export const SISFOGO_OCCURRENCE_TYPE = "incêndio (ROI)";
export const SISFOGO_SOURCE_LABEL = "Sisfogo (Ibama/Prevfogo)";
const LOCK_KEY = `artemis:sync:${SISFOGO_SOURCE_KEY}`;
/**
 * A complete run that would flag more than this share of stored ROIs (and more
 * than MIN_SUSPECT records) as unavailable is treated as a source glitch.
 */
const MAX_UNAVAILABLE_SHARE = 0.2;
const MIN_SUSPECT = 5;

export type SyncMode = "completa" | "incremental";
export type SyncTrigger = "cli" | "agendado" | "manual" | "teste";

export interface SisfogoSyncOptions {
  mode?: SyncMode;
  maxPages?: number;
  maxRecords?: number;
  pageSize?: number;
  /** Resume after the last page stored by the most recent failed run. */
  resume?: boolean;
  /** incremental: stop after this many consecutive pages with nothing new or changed. */
  stopAfterUnchangedPages?: number;
  intervalMs?: number;
  trigger?: SyncTrigger;
  triggeredBy?: number | null;
  fetchJson?: FetchJson;
  retry?: Partial<RetryPolicy>;
  log?: (event: Record<string, unknown>) => void;
  /** Called once the run is registered (after the lock is taken). */
  onStarted?: (runId: number) => void;
}

export interface SisfogoSyncResult {
  runId: number;
  status: "sucesso" | "falha";
  mode: SyncMode;
  startPage: number;
  pages: number;
  totalPages: number | null;
  totalItems: number | null;
  read: number;
  inserted: number;
  updated: number;
  rectified: number;
  unchanged: number;
  rejected: number;
  unavailable: number;
  rejectionReasons: Record<string, number>;
  stoppedBecause: string;
  error?: string;
}

export class SisfogoBusyError extends Error {
  constructor() {
    super("Já existe uma sincronização do Sisfogo em andamento.");
  }
}

const defaultLog = (e: Record<string, unknown>) => console.log(JSON.stringify({ time: new Date().toISOString(), source: SISFOGO_SOURCE_KEY, ...e }));

async function sourceId(): Promise<number> {
  const [s] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, SISFOGO_SOURCE_KEY));
  if (!s) throw new Error("Fonte 'sisfogo-roi' não cadastrada (aplique as migrações 0010 e 0011).");
  return s.id;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function mirrorValues(r: NormalizedRoi, srcId: number, runId: number, revision: number) {
  return {
    sourceId: srcId,
    externalId: r.externalId,
    roiNumber: r.roiNumber,
    roiStatus: r.roiStatus,
    rectified: r.rectified,
    startedOn: r.startedOnBrasilia,
    startedLocalTime: r.startedTimeBrasilia,
    detectedOn: r.detectedAt ? r.detectedAt.toISOString().slice(0, 10) : null,
    extinguishedOn: r.extinguishedAt ? r.extinguishedAt.toISOString().slice(0, 10) : null,
    municipality: r.municipality,
    state: r.state,
    biome: r.biome,
    latitude: r.latitude,
    longitude: r.longitude,
    burnedAreaHa: r.burnedAreaHa,
    vegetation: r.vegetation,
    raw: r.raw,
    lastSeenAt: new Date(),
    syncRunId: runId,
    sourceCreatedAt: r.sourceCreatedAt,
    sourceUpdatedAt: r.sourceUpdatedAt,
    startedAt: r.startedAt,
    detectedAt: r.detectedAt,
    dispatchAt: r.dispatchAt,
    firstAttackAt: r.firstAttackAt,
    controlledAt: r.controlledAt,
    extinguishedAt: r.extinguishedAt,
    institutionName: r.institutionName,
    institutionAcronym: r.institutionAcronym,
    placeName: r.placeName,
    localityType: r.localityType,
    areaClassification: r.areaClassification,
    legalAmazon: r.legalAmazon,
    hadCombat: r.hadCombat,
    responseLevel: r.responseLevel,
    structuresHit: r.structuresHit,
    contentHash: r.contentHash,
    revision,
    unavailableSince: null,
    lastSeenRunId: runId,
  };
}

function occurrenceValues(r: NormalizedRoi, srcId: number, warnings: string[]) {
  return {
    organizationId: null,
    importBatchId: null,
    dataSourceId: srcId,
    externalId: r.externalId,
    occurrenceDate: r.startedOnBrasilia,
    occurrenceTime: r.startedTimeBrasilia,
    occurredAt: r.startedAt,
    municipality: r.municipality,
    state: r.state,
    latitude: r.latitude,
    longitude: r.longitude,
    occurrenceType: SISFOGO_OCCURRENCE_TYPE,
    occurrenceStatus: "finalizado",
    affectedArea: r.burnedAreaHa,
    cause: null,
    vegetationCondition: r.vegetation,
    notes: null,
    source: SISFOGO_SOURCE_LABEL,
    sourceReference: r.roiNumber,
    validationStatus: warnings.length ? "válido com ressalvas" : "válido",
    rawData: null,
    sourceUpdatedAt: r.sourceUpdatedAt,
    sourceAvailable: true,
  };
}

interface PageOutcome { novo: number; atualizado: number; retificado: number; inalterado: number; rejected: Record<string, number>; warnings: Record<string, number> }

/** Classifies and stores one page in a single transaction. */
export async function persistPage(tx: Tx, items: unknown[], srcId: number, runId: number, seenInRun: Set<string>): Promise<PageOutcome> {
  const out: PageOutcome = { novo: 0, atualizado: 0, retificado: 0, inalterado: 0, rejected: {}, warnings: {} };
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

  const valid: { row: NormalizedRoi; warnings: string[] }[] = [];
  const onPage = new Set<string>();
  for (const item of items) {
    const n = normalizeRoi(item);
    if (!n.ok) { bump(out.rejected, n.reason); continue; }
    if (onPage.has(n.row.externalId)) { bump(out.rejected, "repetido_na_pagina"); continue; }
    onPage.add(n.row.externalId);
    n.warnings.forEach((w) => bump(out.warnings, w));
    valid.push(n);
  }
  if (!valid.length) return out;

  const existing = await tx
    .select({ externalId: sisfogoRoiRecords.externalId, contentHash: sisfogoRoiRecords.contentHash, revision: sisfogoRoiRecords.revision })
    .from(sisfogoRoiRecords)
    .where(and(eq(sisfogoRoiRecords.sourceId, srcId), inArray(sisfogoRoiRecords.externalId, valid.map((v) => v.row.externalId))));
  const byId = new Map(existing.map((e) => [e.externalId, e]));

  const unchangedIds: string[] = [];
  for (const { row, warnings } of valid) {
    const ex = byId.get(row.externalId);
    // Seen earlier in this run (the newest-first list shifted between pages): nothing new.
    if (ex && ex.contentHash === row.contentHash) { unchangedIds.push(row.externalId); if (!seenInRun.has(row.externalId)) out.inalterado++; seenInRun.add(row.externalId); continue; }
    seenInRun.add(row.externalId);
    const kind: "novo" | "retificado" | "atualizado" = !ex ? "novo" : row.rectified ? "retificado" : "atualizado";
    const revision = ex ? ex.revision + 1 : 1;
    out[kind]++;

    await tx.insert(sourceRecordRevisions).values({
      dataSourceId: srcId, externalId: row.externalId, revision, changeKind: kind, contentHash: row.contentHash,
      sourceUpdatedAt: row.sourceUpdatedAt, rectified: row.rectified, raw: row.raw, syncRunId: runId,
    }).onConflictDoNothing();

    const m = mirrorValues(row, srcId, runId, revision);
    await tx.insert(sisfogoRoiRecords).values(m).onConflictDoUpdate({
      target: [sisfogoRoiRecords.sourceId, sisfogoRoiRecords.externalId],
      set: m,
    });

    const o = occurrenceValues(row, srcId, warnings);
    await tx.insert(fireOccurrences).values(o).onConflictDoUpdate({
      target: [fireOccurrences.dataSourceId, fireOccurrences.externalId],
      targetWhere: sql`${fireOccurrences.externalId} IS NOT NULL`,
      set: o,
    });
  }

  if (unchangedIds.length) {
    await tx.update(sisfogoRoiRecords)
      .set({ lastSeenAt: new Date(), lastSeenRunId: runId, unavailableSince: null })
      .where(and(eq(sisfogoRoiRecords.sourceId, srcId), inArray(sisfogoRoiRecords.externalId, unchangedIds)));
    // a record that reappears becomes available again
    await tx.update(fireOccurrences)
      .set({ sourceAvailable: true })
      .where(and(eq(fireOccurrences.dataSourceId, srcId), inArray(fireOccurrences.externalId, unchangedIds), eq(fireOccurrences.sourceAvailable, false)));
  }
  return out;
}

/** Runs left "em_execucao" by a process that died (we hold the lock, so none is really running). */
async function closeStaleRuns(srcId: number) {
  await db.update(sourceSyncRuns)
    .set({ status: "falha", finishedAt: new Date(), error: "Interrompida: o processo terminou antes do fim (encerrada na execução seguinte)." })
    .where(and(eq(sourceSyncRuns.sourceId, srcId), eq(sourceSyncRuns.status, "em_execucao")));
}

async function resumePage(srcId: number): Promise<number> {
  const [last] = await db.select({ status: sourceSyncRuns.status, progress: sourceSyncRuns.progress })
    .from(sourceSyncRuns).where(eq(sourceSyncRuns.sourceId, srcId)).orderBy(desc(sourceSyncRuns.id)).limit(1);
  const lastPage = Number((last?.progress as any)?.lastPage);
  return last?.status === "falha" && Number.isInteger(lastPage) && lastPage >= 1 ? lastPage + 1 : 1;
}

export async function syncSisfogo(opts: SisfogoSyncOptions = {}): Promise<SisfogoSyncResult> {
  if (!pool) throw new Error("Banco de dados não configurado.");
  const log = opts.log ?? defaultLog;
  const mode: SyncMode = opts.mode ?? "incremental";
  const pageSize = clampPageSize(opts.pageSize ?? process.env.SISFOGO_PAGE_SIZE ?? SISFOGO_DEFAULT_PAGE_SIZE);
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 1000, 10_000));
  const maxRecords = Math.max(1, opts.maxRecords ?? 1_000_000);
  const stopAfter = Math.max(1, opts.stopAfterUnchangedPages ?? 2);
  const interval = opts.intervalMs ?? 1000;

  const lockClient = await pool.connect();
  let locked = false;
  try {
    const { rows: [l] } = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [LOCK_KEY]);
    locked = !!l?.ok;
    if (!locked) throw new SisfogoBusyError();

    const srcId = await sourceId();
    await closeStaleRuns(srcId);
    const startPage = opts.resume ? await resumePage(srcId) : 1;
    const [run] = await db.insert(sourceSyncRuns).values({
      sourceId: srcId, trigger: opts.trigger ?? "cli", triggeredBy: opts.triggeredBy ?? null,
      params: { mode, pageSize, maxPages, maxRecords, startPage, resumed: !!opts.resume },
    }).returning();

    const r: SisfogoSyncResult = {
      runId: run.id, status: "sucesso", mode, startPage, pages: 0, totalPages: null, totalItems: null, read: 0,
      inserted: 0, updated: 0, rectified: 0, unchanged: 0, rejected: 0, unavailable: 0, rejectionReasons: {}, stoppedBecause: "",
    };
    const warnings: Record<string, number> = {};
    const seen = new Set<string>();
    log({ event: "sync_start", runId: run.id, mode, pageSize, startPage, trigger: opts.trigger ?? "cli" });
    opts.onStarted?.(run.id);

    const saveProgress = (extra: Record<string, unknown> = {}) =>
      db.update(sourceSyncRuns).set({
        pagesRead: r.pages, recordsRead: r.read, recordsInserted: r.inserted, recordsUpdated: r.updated + r.rectified,
        recordsRectified: r.rectified, recordsUnchanged: r.unchanged, recordsRejected: r.rejected, recordsUnavailable: r.unavailable,
        rejectionReasons: { ...r.rejectionReasons, ...Object.fromEntries(Object.entries(warnings).map(([k, v]) => [`campo_descartado:${k}`, v])) },
        progress: { lastPage: startPage + r.pages - 1, totalPages: r.totalPages, totalItems: r.totalItems, ...extra },
      }).where(eq(sourceSyncRuns.id, run.id));

    let page = startPage;
    let quietPages = 0;
    try {
      for (;;) {
        if (page - startPage >= maxPages) { r.stoppedBecause = "limite_de_paginas"; break; }
        if (r.read >= maxRecords) { r.stoppedBecause = "limite_de_registros"; break; }
        if (page > startPage) await new Promise((res) => setTimeout(res, interval));
        const p = await fetchSisfogoPage(page, pageSize, {
          fetchJson: opts.fetchJson, retry: opts.retry,
          onRetry: (i) => log({ event: "retry", runId: run.id, page, ...i }),
        });
        r.totalPages = p.totalPages;
        r.totalItems = p.totalItems;
        if (p.items.length === 0) { r.stoppedBecause = "fim_da_lista"; break; }

        const outcome = await db.transaction((tx) => persistPage(tx, p.items, srcId, run.id, seen));
        r.pages++;
        r.read += p.items.length;
        r.inserted += outcome.novo;
        r.updated += outcome.atualizado;
        r.rectified += outcome.retificado;
        r.unchanged += outcome.inalterado;
        for (const [k, v] of Object.entries(outcome.rejected)) { r.rejected += v; r.rejectionReasons[k] = (r.rejectionReasons[k] ?? 0) + v; }
        for (const [k, v] of Object.entries(outcome.warnings)) warnings[k] = (warnings[k] ?? 0) + v;
        await saveProgress();
        log({ event: "page", runId: run.id, page, items: p.items.length, novo: outcome.novo, atualizado: outcome.atualizado, retificado: outcome.retificado, attempts: p.attempts });

        if (page >= p.totalPages) { r.stoppedBecause = "fim_da_lista"; break; }
        const changed = outcome.novo + outcome.atualizado + outcome.retificado;
        quietPages = changed ? 0 : quietPages + 1;
        if (mode === "incremental" && quietPages >= stopAfter) { r.stoppedBecause = "sem_novidades"; break; }
        page++;
      }

      // Availability: only a complete, unresumed, unlimited run can say a record is gone.
      const complete = mode === "completa" && !opts.resume && startPage === 1 && r.stoppedBecause === "fim_da_lista";
      let unavailableNote: string | null = null;
      if (complete) {
        const [{ stored }] = await db.select({ stored: sql<number>`count(*)::int` }).from(sisfogoRoiRecords)
          .where(and(eq(sisfogoRoiRecords.sourceId, srcId), isNull(sisfogoRoiRecords.unavailableSince)));
        const missing = await db.select({ id: sisfogoRoiRecords.externalId }).from(sisfogoRoiRecords).where(and(
          eq(sisfogoRoiRecords.sourceId, srcId), isNull(sisfogoRoiRecords.unavailableSince),
          or(isNull(sisfogoRoiRecords.lastSeenRunId), ne(sisfogoRoiRecords.lastSeenRunId, run.id)),
        ));
        if (missing.length > MIN_SUSPECT && missing.length > stored * MAX_UNAVAILABLE_SHARE) {
          unavailableNote = `${missing.length} de ${stored} ROIs ausentes nesta leitura — acima de ${MAX_UNAVAILABLE_SHARE * 100}% e de ${MIN_SUSPECT}; nada foi marcado como indisponível (possível falha da fonte).`;
          log({ event: "unavailable_skipped", runId: run.id, missing: missing.length, stored });
        } else if (missing.length) {
          const ids = missing.map((m) => m.id);
          await db.transaction(async (tx) => {
            await tx.update(sisfogoRoiRecords).set({ unavailableSince: new Date() })
              .where(and(eq(sisfogoRoiRecords.sourceId, srcId), inArray(sisfogoRoiRecords.externalId, ids)));
            await tx.update(fireOccurrences).set({ sourceAvailable: false })
              .where(and(eq(fireOccurrences.dataSourceId, srcId), inArray(fireOccurrences.externalId, ids)));
          });
          r.unavailable = ids.length;
        }
      }

      await saveProgress({ stoppedBecause: r.stoppedBecause, distinctSeen: seen.size, ...(unavailableNote ? { note: unavailableNote } : {}) });
      await db.update(sourceSyncRuns).set({ status: "sucesso", finishedAt: new Date() }).where(eq(sourceSyncRuns.id, run.id));
      // Operational only after a COMPLETE real run; incremental runs just refresh the date.
      await db.update(dataSources).set(complete
        ? { lastUpdate: new Date(), status: "ativo", integrationStatus: `operacional — sincronização completa em ${new Date().toISOString().slice(0, 10)}` }
        : { lastUpdate: new Date() }).where(eq(dataSources.id, srcId));
      log({ event: "sync_end", ...r, rejectionReasons: undefined });
      return r;
    } catch (err) {
      const error = `${err instanceof Error ? err.message : String(err)}${r.pages ? ` Páginas ${startPage}–${startPage + r.pages - 1} já gravadas; use --resume para continuar.` : ""}`;
      await saveProgress({ failedPage: page }).catch(() => {});
      await db.update(sourceSyncRuns).set({ status: "falha", finishedAt: new Date(), error }).where(eq(sourceSyncRuns.id, run.id));
      log({ event: "sync_end", runId: run.id, status: "falha", error, page });
      return { ...r, status: "falha", stoppedBecause: "erro", error };
    }
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}

/** For the data-sources screen: current state and recent runs (no raw data). */
export async function sisfogoStatus(limit = 10) {
  const [src] = await db.select().from(dataSources).where(eq(dataSources.key, SISFOGO_SOURCE_KEY));
  if (!src) return null;
  const runs = await db.select({
    id: sourceSyncRuns.id, startedAt: sourceSyncRuns.startedAt, finishedAt: sourceSyncRuns.finishedAt, status: sourceSyncRuns.status,
    trigger: sourceSyncRuns.trigger, params: sourceSyncRuns.params, pagesRead: sourceSyncRuns.pagesRead, recordsRead: sourceSyncRuns.recordsRead,
    recordsInserted: sourceSyncRuns.recordsInserted, recordsUpdated: sourceSyncRuns.recordsUpdated, recordsRectified: sourceSyncRuns.recordsRectified,
    recordsUnchanged: sourceSyncRuns.recordsUnchanged, recordsRejected: sourceSyncRuns.recordsRejected, recordsUnavailable: sourceSyncRuns.recordsUnavailable,
    rejectionReasons: sourceSyncRuns.rejectionReasons, progress: sourceSyncRuns.progress, error: sourceSyncRuns.error,
  }).from(sourceSyncRuns).where(eq(sourceSyncRuns.sourceId, src.id)).orderBy(desc(sourceSyncRuns.id)).limit(limit);
  const [counts] = await db.select({
    total: sql<number>`count(*)::int`,
    available: sql<number>`count(*) filter (where ${sisfogoRoiRecords.unavailableSince} is null)::int`,
    rectified: sql<number>`count(*) filter (where ${sisfogoRoiRecords.revision} > 1)::int`,
    withCoords: sql<number>`count(${sisfogoRoiRecords.latitude})::int`,
    firstStart: sql<string | null>`min(${sisfogoRoiRecords.startedAt})`,
    lastStart: sql<string | null>`max(${sisfogoRoiRecords.startedAt})`,
  }).from(sisfogoRoiRecords).where(eq(sisfogoRoiRecords.sourceId, src.id));
  const lastSuccess = runs.find((x) => x.status === "sucesso") ?? null;
  const lastComplete = await db.select({ finishedAt: sourceSyncRuns.finishedAt }).from(sourceSyncRuns)
    .where(and(eq(sourceSyncRuns.sourceId, src.id), eq(sourceSyncRuns.status, "sucesso"), sql`${sourceSyncRuns.params}->>'mode' = 'completa'`, sql`(${sourceSyncRuns.progress}->>'stoppedBecause') = 'fim_da_lista'`))
    .orderBy(desc(sourceSyncRuns.id)).limit(1);
  return {
    source: { key: src.key, name: src.name, url: src.url, status: src.status, integrationStatus: src.integrationStatus, licence: src.licence, lastUpdate: src.lastUpdate },
    operational: lastComplete.length > 0,
    lastCompleteAt: lastComplete[0]?.finishedAt ?? null,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    running: runs.some((x) => x.status === "em_execucao"),
    counts,
    runs,
  };
}

