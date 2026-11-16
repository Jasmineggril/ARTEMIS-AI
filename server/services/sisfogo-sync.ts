import { db } from "../db";
import { importBatches, fireOccurrences, sourceSyncRuns, dataSources } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  fetchSisfogoPage,
  normalizeRoi,
  SISFOGO_SOURCE,
  SISFOGO_MAX_PAGE_SIZE,
  SISFOGO_RATE_LIMIT_MS,
  checkSisfogoHealth,
} from "../connectors/sisfogo";

export interface SyncSummary {
  syncRunId: number;
  status: string;
  recordsFetched: number;
  recordsInserted: number;
  recordsSkipped: number;
  batchId: number | null;
  errors: string[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function syncSisfogo(options: { pageSize?: number; maxPages?: number } = {}): Promise<SyncSummary> {
  const pageSize = Math.min(options.pageSize ?? SISFOGO_MAX_PAGE_SIZE, SISFOGO_MAX_PAGE_SIZE);
  const maxPages = options.maxPages ?? Infinity;

  const [run] = await db.insert(sourceSyncRuns).values({
    sourceKey: SISFOGO_SOURCE.key,
    status: "running",
  }).returning();

  const errors: string[] = [];
  const normalized: ReturnType<typeof normalizeRoi>["record"][] = [];
  let totalFetched = 0;
  let page = 1;
  let totalPages = 1;

  try {
    const healthy = await checkSisfogoHealth();
    if (!healthy) throw new Error("Sisfogo health check failed");

    while (page <= totalPages && page <= maxPages) {
      const p = await fetchSisfogoPage(page, pageSize);
      totalPages = p.totalPaginas || totalPages;
      totalFetched += p.itens.length;
      for (const roi of p.itens) {
        const { record, errors: e } = normalizeRoi(roi);
        if (e.length) {
          errors.push(`${roi?.numeroRoi ?? roi?.id}: ${e.join(", ")}`);
        }
        normalized.push(record);
      }
      page++;
      if (page <= totalPages && page <= maxPages) await sleep(SISFOGO_RATE_LIMIT_MS);
    }

    // Count validation statuses
    const validRecords = normalized.filter((r) => r.validationStatus === "válido");
    const invalidCount = normalized.length - validRecords.length;

    let batchId: number | null = null;
    let inserted = 0;
    if (validRecords.length > 0) {
      const result = await db.transaction(async (tx) => {
        const [batch] = await tx.insert(importBatches).values({
          filename: `sisfogo-api-${new Date().toISOString()}.json`,
          sourceName: SISFOGO_SOURCE.name,
          sourceType: "sisfogo-api",
          totalRows: normalized.length,
          validRows: validRecords.length,
          warningRows: 0,
          invalidRows: invalidCount,
          duplicateRows: 0,
          status: "concluído",
          importedBy: null,
          organizationId: null,
          rejectionReasons: {},
          notes: "Sincronização automática via API pública do Sisfogo (ROIs finalizados). Não é scraping.",
        }).returning();
        const rows = await tx.insert(fireOccurrences).values(
          validRecords.map((r) => ({
            importBatchId: batch.id,
            organizationId: null,
            occurrenceDate: r.occurrenceDate,
            occurrenceTime: r.occurrenceTime,
            municipality: r.municipality,
            state: r.state,
            latitude: r.latitude,
            longitude: r.longitude,
            occurrenceType: r.occurrenceType,
            occurrenceStatus: r.occurrenceStatus,
            affectedArea: r.affectedArea,
            cause: r.cause,
            vegetationCondition: r.vegetationCondition,
            notes: r.notes,
            source: r.source,
            sourceReference: r.sourceReference,
            validationStatus: r.validationStatus,
            rawData: r.rawData,
            dedupKey: r.dedupKey,
          })),
        ).onConflictDoNothing().returning({ id: fireOccurrences.id });
        return { batch, inserted: rows.length };
      });
      batchId = result.batch.id;
      inserted = result.inserted;
    }

    const skipped = totalFetched - inserted;

    // Update data source registry status
    await db.update(dataSources).set({
      status: "ativo",
      isSimulated: false,
      lastUpdate: new Date(),
      quality: 1,
      description: "API pública do Sisfogo (ROIs finalizados).",
    }).where(eq(dataSources.name, SISFOGO_SOURCE.name)).catch(() => {});

    await db.update(sourceSyncRuns).set({
      finishedAt: new Date(),
      status: errors.length ? "partial" : "success",
      recordsFetched: totalFetched,
      recordsInserted: inserted,
      recordsSkipped: skipped,
      errorMessage: errors.length ? errors.slice(0, 5).join("; ") : null,
      metadata: { totalPages, pageSize, errorCount: errors.length },
    }).where(eq(sourceSyncRuns.id, run.id));

    return {
      syncRunId: run.id,
      status: errors.length ? "partial" : "success",
      recordsFetched: totalFetched,
      recordsInserted: inserted,
      recordsSkipped: skipped,
      batchId,
      errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(sourceSyncRuns).set({
      finishedAt: new Date(),
      status: "failed",
      recordsFetched: totalFetched,
      recordsInserted: 0,
      recordsSkipped: totalFetched,
      errorMessage: msg,
    }).where(eq(sourceSyncRuns.id, run.id));
    throw err;
  }
}