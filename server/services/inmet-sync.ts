/**
 * INMET yearly archive → weather_stations / weather_station_observations / weather_station_daily.
 *
 *  - Incremental: the archive's sha256 is compared with the last successful run
 *    of that year; an identical file is not reprocessed. A changed file (the
 *    current year grows every month) is upserted: only rows whose values changed
 *    are updated (IS DISTINCT FROM), new hours are inserted.
 *  - Recoverable: each station file is its own transaction and the run records
 *    the files already done; a failed/interrupted run with the same archive is
 *    resumed from where it stopped.
 *  - Raw preserved: the ZIP is stored as downloaded (INMET_RAW_DIR), and every
 *    observation keeps the file's sha256, file name and line number.
 *  - One run at a time (PostgreSQL advisory lock).
 */
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { dataSources, sourceSyncRuns, weatherStationObservations, weatherStations } from "@shared/schema";
import {
  INMET_RETRY, INMET_SOURCE_KEY, INMET_YEAR_URL, defaultFetchBin, fetchBinWithRetry, inmetSourceId, lastYearRun,
  loadYearZip, parseInmetCsv, preserveRaw, sha256, upsertStations, utcOffsetForState, type FetchBin, type ParsedStationFile,
} from "../connectors/inmet";
import type { RetryPolicy } from "../connectors/sisfogo";

export class InmetBusyError extends Error { constructor() { super("Sincronização do INMET já em andamento."); } }

export interface YearSyncResult {
  year: number; runId: number; status: "sucesso" | "falha"; unchangedArchive?: boolean; resumedFrom?: number;
  files: number; filesFailed: number; read: number; inserted: number; updated: number; unchanged: number; rejected: number; flaggedHours: number;
  stationsNew: number; durationMs: number; sha256?: string; error?: string;
}

/** Recomputes daily aggregates (station's local day) for a station between two instants. */
export async function recomputeDaily(tx: typeof db, stationId: number, offset: number, from: Date, to: Date) {
  const off = sql.raw(`interval '${Number(offset)} hours'`);
  await tx.execute(sql`
    INSERT INTO weather_station_daily (station_id, day, hours_observed, hours_temperature, hours_humidity, hours_precipitation,
      temperature_mean_c, temperature_max_c, temperature_min_c, humidity_mean_pct, humidity_min_pct, humidity_13h_pct, temperature_13h_c,
      wind_mean_ms, wind_max_ms, wind_13h_ms, gust_max_ms, precipitation_mm, flagged_hours, computed_at)
    SELECT station_id, (observed_at + ${off})::date AS day, count(*), count(temperature_c), count(humidity_pct), count(precipitation_mm),
      avg(temperature_c), max(coalesce(temperature_max_c, temperature_c)), min(coalesce(temperature_min_c, temperature_c)),
      avg(humidity_pct), min(coalesce(humidity_min_pct, humidity_pct)),
      max(humidity_pct) FILTER (WHERE extract(hour FROM observed_at + ${off}) = 13),
      max(temperature_c) FILTER (WHERE extract(hour FROM observed_at + ${off}) = 13),
      avg(wind_speed_ms), max(wind_speed_ms), max(wind_speed_ms) FILTER (WHERE extract(hour FROM observed_at + ${off}) = 13),
      max(wind_gust_ms), CASE WHEN count(precipitation_mm) > 0 THEN sum(precipitation_mm) END,
      count(*) FILTER (WHERE cardinality(quality_flags) > 0), now()
    FROM weather_station_observations
    WHERE station_id = ${stationId} AND observed_at >= ${from} AND observed_at < ${to}
    GROUP BY station_id, 2
    ON CONFLICT (station_id, day) DO UPDATE SET
      hours_observed = excluded.hours_observed, hours_temperature = excluded.hours_temperature, hours_humidity = excluded.hours_humidity,
      hours_precipitation = excluded.hours_precipitation, temperature_mean_c = excluded.temperature_mean_c, temperature_max_c = excluded.temperature_max_c,
      temperature_min_c = excluded.temperature_min_c, humidity_mean_pct = excluded.humidity_mean_pct, humidity_min_pct = excluded.humidity_min_pct,
      humidity_13h_pct = excluded.humidity_13h_pct, temperature_13h_c = excluded.temperature_13h_c, wind_mean_ms = excluded.wind_mean_ms,
      wind_max_ms = excluded.wind_max_ms, wind_13h_ms = excluded.wind_13h_ms, gust_max_ms = excluded.gust_max_ms,
      precipitation_mm = excluded.precipitation_mm, flagged_hours = excluded.flagged_hours, computed_at = now()`);
}

async function storeStationFile(p: ParsedStationFile, ctx: { sourceId: number; runId: number; sha: string; fileName: string; year: number }) {
  return db.transaction(async (tx) => {
    const offset = utcOffsetForState(p.header.state);
    // Station from the file header if the registry does not have it (closed stations)
    const [created] = await tx.insert(weatherStations).values({
      sourceId: ctx.sourceId, code: p.header.code, name: p.header.name, state: p.header.state, latitude: p.header.latitude, longitude: p.header.longitude,
      altitudeM: p.header.altitudeM, stationType: "Automatica", utcOffsetHours: offset,
    }).onConflictDoNothing().returning({ id: weatherStations.id });
    const [st] = await tx.select({ id: weatherStations.id, utcOffsetHours: weatherStations.utcOffsetHours }).from(weatherStations)
      .where(and(eq(weatherStations.sourceId, ctx.sourceId), eq(weatherStations.code, p.header.code)));
    let inserted = 0, updated = 0;
    for (let i = 0; i < p.rows.length; i += 1000) {
      const chunk = p.rows.slice(i, i + 1000).map((o) => ({
        stationId: st.id, observedAt: o.observedAt, temperatureC: o.temperatureC, temperatureMaxC: o.temperatureMaxC, temperatureMinC: o.temperatureMinC,
        dewPointC: o.dewPointC, humidityPct: o.humidityPct, humidityMinPct: o.humidityMinPct, windSpeedMs: o.windSpeedMs, windGustMs: o.windGustMs,
        windDirectionDeg: o.windDirectionDeg, precipitationMm: o.precipitationMm, pressureHpa: o.pressureHpa, radiationKjM2: o.radiationKjM2,
        qualityFlags: o.qualityFlags, rawFileSha256: ctx.sha, rawFileName: ctx.fileName, rawLine: o.line, syncRunId: ctx.runId,
      }));
      const r = await tx.insert(weatherStationObservations).values(chunk).onConflictDoUpdate({
        target: [weatherStationObservations.stationId, weatherStationObservations.observedAt],
        set: Object.fromEntries(["temperature_c", "temperature_max_c", "temperature_min_c", "dew_point_c", "humidity_pct", "humidity_min_pct", "wind_speed_ms",
          "wind_gust_ms", "wind_direction_deg", "precipitation_mm", "pressure_hpa", "radiation_kj_m2", "quality_flags", "raw_file_sha256", "raw_file_name",
          "raw_line", "sync_run_id"].map((c) => [c.replace(/_([a-z0-9])/g, (_, x) => x.toUpperCase()).replace("Kj", "Kj"), sql.raw(`excluded.${c}`)])
          .concat([["updatedAt", sql`now()`]])) as any,
        // only rows whose measured values or flags changed are rewritten
        setWhere: sql`(weather_station_observations.temperature_c, weather_station_observations.temperature_max_c, weather_station_observations.temperature_min_c,
          weather_station_observations.dew_point_c, weather_station_observations.humidity_pct, weather_station_observations.humidity_min_pct,
          weather_station_observations.wind_speed_ms, weather_station_observations.wind_gust_ms, weather_station_observations.wind_direction_deg,
          weather_station_observations.precipitation_mm, weather_station_observations.pressure_hpa, weather_station_observations.radiation_kj_m2,
          weather_station_observations.quality_flags)
          IS DISTINCT FROM (excluded.temperature_c, excluded.temperature_max_c, excluded.temperature_min_c, excluded.dew_point_c, excluded.humidity_pct,
          excluded.humidity_min_pct, excluded.wind_speed_ms, excluded.wind_gust_ms, excluded.wind_direction_deg, excluded.precipitation_mm,
          excluded.pressure_hpa, excluded.radiation_kj_m2, excluded.quality_flags)`,
      }).returning({ inserted: sql<boolean>`(xmax = 0)` });
      r.forEach((x) => (x.inserted ? inserted++ : updated++));
    }
    if (inserted || updated) {
      const from = new Date(Date.UTC(ctx.year, 0, 1) - 86_400_000), to = new Date(Date.UTC(ctx.year + 1, 0, 1) + 86_400_000);
      await recomputeDaily(tx as unknown as typeof db, st.id, st.utcOffsetHours, from, to);
    }
    return { inserted, updated, unchanged: p.rows.length - inserted - updated, stationCreated: created ? 1 : 0 };
  });
}

export async function syncInmetYear(year: number, opts: { fetchBin?: FetchBin; retry?: RetryPolicy; force?: boolean; trigger?: string } = {}): Promise<YearSyncResult> {
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getUTCFullYear()) throw new Error(`Ano inválido: ${year}`);
  if (!pool) throw new Error("Banco de dados não configurado.");
  const lock = await pool.connect();
  try {
    const { rows: [l] } = await lock.query("SELECT pg_try_advisory_lock(hashtext('artemis:sync:inmet')) AS ok");
    if (!l?.ok) throw new InmetBusyError();
    try { return await runYear(year, opts); }
    finally { await lock.query("SELECT pg_advisory_unlock(hashtext('artemis:sync:inmet'))").catch(() => {}); }
  } finally { lock.release(); }
}

async function runYear(year: number, opts: { fetchBin?: FetchBin; retry?: RetryPolicy; force?: boolean; trigger?: string }): Promise<YearSyncResult> {
  const t0 = Date.now();
  const sourceId = await inmetSourceId();
  // We hold the lock, so any run still "em_execucao" belongs to a process that died.
  await db.update(sourceSyncRuns).set({ status: "falha", finishedAt: new Date(), error: "Execução interrompida antes de concluir (processo encerrado)." })
    .where(and(eq(sourceSyncRuns.sourceId, sourceId), eq(sourceSyncRuns.status, "em_execucao")));
  const previous = await lastYearRun(sourceId, year);
  const url = INMET_YEAR_URL(year);
  const [run] = await db.insert(sourceSyncRuns).values({ sourceId, params: { kind: "ano", year, url }, trigger: opts.trigger ?? "cli" }).returning();
  const base: YearSyncResult = { year, runId: run.id, status: "falha", files: 0, filesFailed: 0, read: 0, inserted: 0, updated: 0, unchanged: 0, rejected: 0, flaggedHours: 0, stationsNew: 0, durationMs: 0 };
  const fail = async (error: string, extra: Partial<YearSyncResult> = {}) => {
    await db.update(sourceSyncRuns).set({ status: "falha", finishedAt: new Date(), error }).where(eq(sourceSyncRuns.id, run.id));
    return { ...base, ...extra, error, durationMs: Date.now() - t0 };
  };

  let buf: Buffer, lastModified: string | null = null;
  try {
    const r = await fetchBinWithRetry(opts.fetchBin ?? defaultFetchBin, url, opts.retry ?? INMET_RETRY);
    if (r.status === 404) return fail(`Arquivo de ${year} não publicado pelo INMET (404).`);
    if (r.status !== 200) return fail(`INMET respondeu HTTP ${r.status}.`);
    if (r.body.length < 1000 || r.body[0] !== 0x50 || r.body[1] !== 0x4b) return fail("Resposta do INMET não é um arquivo ZIP.");
    buf = r.body; lastModified = r.headers["last-modified"] ?? null;
  } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }

  const sha = sha256(buf);
  const stored = preserveRaw(year, sha, buf);
  const prevParams = previous?.params as { sha256?: string } | null;
  const prevProgress = previous?.progress as { filesDone?: string[] } | null;
  await db.update(sourceSyncRuns).set({ params: { kind: "ano", year, url, sha256: sha, bytes: buf.length, lastModified, rawFile: stored } }).where(eq(sourceSyncRuns.id, run.id));

  if (!opts.force && previous?.status === "sucesso" && prevParams?.sha256 === sha) {
    await db.update(sourceSyncRuns).set({ status: "sucesso", finishedAt: new Date(), progress: { note: "Arquivo idêntico ao já processado (mesmo sha256); nada a fazer." } }).where(eq(sourceSyncRuns.id, run.id));
    return { ...base, status: "sucesso", unchangedArchive: true, sha256: sha, durationMs: Date.now() - t0 };
  }
  const resume = !opts.force && previous?.status === "falha" && prevParams?.sha256 === sha ? new Set(prevProgress?.filesDone ?? []) : new Set<string>();

  let files;
  try { files = await loadYearZip(buf); } catch (e) { return fail(`ZIP inválido: ${e instanceof Error ? e.message : String(e)}`, { sha256: sha }); }
  if (files.length === 0) return fail("ZIP sem arquivos CSV.", { sha256: sha });

  const out = { ...base, sha256: sha, files: files.length, resumedFrom: resume.size || undefined };
  const rejectedReasons: Record<string, number> = {}, qualityFlags: Record<string, number> = {};
  const fileErrors: { file: string; error: string }[] = [];
  const filesDone: string[] = Array.from(resume);
  const decoder = new TextDecoder("latin1");
  for (const f of files) {
    if (resume.has(f.name)) continue;
    try {
      const parsed = parseInmetCsv(decoder.decode(await f.async("uint8array")), { year });
      const r = await storeStationFile(parsed, { sourceId, runId: run.id, sha, fileName: f.name, year });
      out.read += parsed.read; out.inserted += r.inserted; out.updated += r.updated; out.unchanged += r.unchanged; out.stationsNew += r.stationCreated;
      for (const [k, v] of Object.entries(parsed.rejected)) { rejectedReasons[k] = (rejectedReasons[k] ?? 0) + v; out.rejected += v; }
      for (const [k, v] of Object.entries(parsed.flagged)) qualityFlags[k] = (qualityFlags[k] ?? 0) + v;
      out.flaggedHours += parsed.rows.filter((x) => x.qualityFlags.length).length;
    } catch (e) {
      out.filesFailed++;
      fileErrors.push({ file: f.name, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
    }
    filesDone.push(f.name);
    if (filesDone.length % 20 === 0) {
      await db.update(sourceSyncRuns).set({ progress: { filesDone, fileErrors, qualityFlags }, recordsRead: out.read, recordsInserted: out.inserted, recordsUpdated: out.updated }).where(eq(sourceSyncRuns.id, run.id));
    }
  }
  const tooManyErrors = out.filesFailed > Math.max(3, files.length * 0.1);
  await db.update(sourceSyncRuns).set({
    status: tooManyErrors ? "falha" : "sucesso", finishedAt: new Date(), error: tooManyErrors ? `${out.filesFailed} de ${files.length} arquivos com erro.` : null,
    recordsRead: out.read, recordsInserted: out.inserted, recordsUpdated: out.updated, recordsUnchanged: out.unchanged, recordsRejected: out.rejected,
    rejectionReasons: rejectedReasons, progress: { filesDone, fileErrors, qualityFlags, flaggedHours: out.flaggedHours, stationsNew: out.stationsNew },
  }).where(eq(sourceSyncRuns.id, run.id));
  if (!tooManyErrors) await db.update(dataSources).set({ lastUpdate: new Date(), status: "ativo" }).where(eq(dataSources.key, INMET_SOURCE_KEY));
  return { ...out, status: tooManyErrors ? "falha" : "sucesso", error: tooManyErrors ? `${out.filesFailed} arquivos com erro` : undefined, durationMs: Date.now() - t0 };
}

export { upsertStations };

/** Cheap check before downloading: has INMET's archive changed since the last successful run? */
export async function archiveLooksUnchanged(year: number): Promise<boolean> {
  const prev = await lastYearRun(await inmetSourceId(), year);
  const lm = (prev?.params as { lastModified?: string } | null)?.lastModified;
  if (prev?.status !== "sucesso" || !lm) return false;
  try {
    const r = await fetch(INMET_YEAR_URL(year), { method: "HEAD", signal: AbortSignal.timeout(30_000) });
    return r.ok && r.headers.get("last-modified") === lm;
  } catch { return false; }
}
