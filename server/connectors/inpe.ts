/**
 * INPE — Programa Queimadas connector (satellite fire detections).
 *
 * Verified on 16/11/2026 against the public files at
 *   https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/focos_diario_br_YYYYMMDD.csv
 * Columns: id, lat, lon, data_hora_gmt, satelite, municipio, estado, pais,
 *   municipio_id (IBGE, 7 digits), estado_id (IBGE UF code), pais_id,
 *   numero_dias_sem_chuva, precipitacao, risco_fogo, bioma, frp
 * - one row per DETECTION (several satellites can detect the same fire);
 * - data_hora_gmt is UTC; the file name is the UTC day;
 * - -999 means "no value";
 * - per INPE's curation document, the current day's file is updated hourly per
 *   satellite and the previous day's file is reprocessed every 3 h until 12:00.
 * Sync is incremental and idempotent: upsert by (source, id).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { dataSources, satelliteHotspots, sourceSyncRuns } from "@shared/schema";

export const INPE_SOURCE_KEY = "inpe-queimadas";
export const INPE_DAILY_URL = "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil";
const MAX_BYTES = 60 * 1024 * 1024;

/** IBGE state codes -> UF. */
export const IBGE_UF: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

export interface ParsedHotspot {
  externalId: string;
  satellite: string;
  detectedAt: Date;
  latitude: number;
  longitude: number;
  municipality: string | null;
  municipalityIbgeCode: string | null;
  state: string | null;
  stateName: string | null;
  biome: string | null;
  daysWithoutRain: number | null;
  precipitationMm: number | null;
  fireRisk: number | null;
  frpMw: number | null;
  raw: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedHotspot[];
  rejected: Record<string, number>;
  read: number;
}

const REQUIRED = ["id", "lat", "lon", "data_hora_gmt", "satelite"];

/** Minimal RFC 4180 line splitter (handles quoted fields with commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= -999) return null; // -999 = no value
  return n;
}

export function parseInpeCsv(text: string): ParseResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("Arquivo do INPE vazio.");
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`Formato inesperado do INPE: colunas ausentes ${missing.join(", ")}.`);

  const rejected: Record<string, number> = {};
  const reject = (r: string) => { rejected[r] = (rejected[r] ?? 0) + 1; };
  const rows: ParsedHotspot[] = [];
  const seen = new Set<string>();

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const r: Record<string, string> = {};
    header.forEach((h, i) => { r[h] = (cells[i] ?? "").trim(); });
    if (!r.id) { reject("sem identificador"); continue; }
    if (seen.has(r.id)) { reject("identificador repetido no arquivo"); continue; }
    const lat = num(r.lat);
    const lon = num(r.lon);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) { reject("coordenadas inválidas"); continue; }
    const m = r.data_hora_gmt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    const detectedAt = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))) : null;
    if (!detectedAt || Number.isNaN(detectedAt.getTime())) { reject("data/hora inválida"); continue; }
    if (!r.satelite) { reject("sem satélite"); continue; }
    const munCode = /^\d{7}$/.test(r.municipio_id ?? "") ? r.municipio_id : null;
    const risk = num(r.risco_fogo);
    seen.add(r.id);
    rows.push({
      externalId: r.id,
      satellite: r.satelite,
      detectedAt,
      latitude: lat,
      longitude: lon,
      municipality: r.municipio || null,
      municipalityIbgeCode: munCode,
      state: IBGE_UF[r.estado_id ?? ""] ?? null,
      stateName: r.estado || null,
      biome: r.bioma || null,
      daysWithoutRain: num(r.numero_dias_sem_chuva),
      precipitationMm: num(r.precipitacao),
      fireRisk: risk !== null && risk >= 0 && risk <= 1 ? risk : null,
      frpMw: num(r.frp),
      raw: r,
    });
  }
  return { rows, rejected, read: lines.length - 1 };
}

export function inpeDailyUrl(day: string): string {
  return `${INPE_DAILY_URL}/focos_diario_br_${day.replace(/-/g, "")}.csv`;
}

export type FetchText = (url: string) => Promise<{ ok: boolean; status: number; text: string }>;

export const defaultFetchText: FetchText = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error(`Arquivo maior que o limite (${len} bytes).`);
    const text = res.ok ? await res.text() : "";
    if (text.length > MAX_BYTES) throw new Error("Arquivo maior que o limite.");
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
};

export interface DaySyncResult {
  day: string;
  runId: number;
  status: "sucesso" | "falha";
  read: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  error?: string;
}

async function inpeSourceId(): Promise<number> {
  const [s] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, INPE_SOURCE_KEY));
  if (!s) throw new Error("Fonte 'inpe-queimadas' não cadastrada (aplique a migração 0006).");
  return s.id;
}

/** Sync one UTC day. Each day is one transaction: a failure leaves no partial data. */
export async function syncInpeDay(day: string, fetchText: FetchText = defaultFetchText): Promise<DaySyncResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Dia inválido: ${day}`);
  const sourceId = await inpeSourceId();
  const url = inpeDailyUrl(day);
  const [run] = await db.insert(sourceSyncRuns).values({ sourceId, params: { day, url } }).returning();

  const fail = async (error: string, read = 0): Promise<DaySyncResult> => {
    await db.update(sourceSyncRuns).set({ status: "falha", finishedAt: new Date(), error, recordsRead: read }).where(eq(sourceSyncRuns.id, run.id));
    return { day, runId: run.id, status: "falha", read, inserted: 0, updated: 0, unchanged: 0, rejected: 0, error };
  };

  let parsed: ParseResult;
  try {
    const res = await fetchText(url);
    if (!res.ok) return fail(res.status === 404 ? "Arquivo do dia ainda não publicado pelo INPE (404)." : `INPE respondeu HTTP ${res.status}.`);
    parsed = parseInpeCsv(res.text);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  try {
    let inserted = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      for (let i = 0; i < parsed.rows.length; i += 1000) {
        const chunk = parsed.rows.slice(i, i + 1000).map((r) => ({ ...r, sourceId, syncRunId: run.id }));
        const out = await tx
          .insert(satelliteHotspots)
          .values(chunk)
          .onConflictDoUpdate({
            target: [satelliteHotspots.sourceId, satelliteHotspots.externalId],
            set: {
              satellite: sql`excluded.satellite`, detectedAt: sql`excluded.detected_at`,
              latitude: sql`excluded.latitude`, longitude: sql`excluded.longitude`,
              municipality: sql`excluded.municipality`, municipalityIbgeCode: sql`excluded.municipality_ibge_code`,
              state: sql`excluded.state`, stateName: sql`excluded.state_name`, biome: sql`excluded.biome`,
              daysWithoutRain: sql`excluded.days_without_rain`, precipitationMm: sql`excluded.precipitation_mm`,
              fireRisk: sql`excluded.fire_risk`, frpMw: sql`excluded.frp_mw`, raw: sql`excluded.raw`,
              lastSeenAt: sql`now()`, syncRunId: sql`excluded.sync_run_id`,
            },
            // only touch rows whose source data actually changed
            setWhere: sql`${satelliteHotspots.raw}::text IS DISTINCT FROM excluded.raw::text`,
          })
          .returning({ inserted: sql<boolean>`(xmax = 0)` });
        out.forEach((o) => (o.inserted ? inserted++ : updated++));
      }
      const rejectedCount = Object.values(parsed.rejected).reduce((a, b) => a + b, 0);
      await tx.update(sourceSyncRuns).set({
        status: "sucesso", finishedAt: new Date(), recordsRead: parsed.read, recordsInserted: inserted,
        recordsUpdated: updated, recordsRejected: rejectedCount, rejectionReasons: parsed.rejected,
      }).where(eq(sourceSyncRuns.id, run.id));
    });
    const rejected = Object.values(parsed.rejected).reduce((a, b) => a + b, 0);
    await db.update(dataSources).set({ lastUpdate: new Date() }).where(eq(dataSources.key, INPE_SOURCE_KEY));
    return { day, runId: run.id, status: "sucesso", read: parsed.read, inserted, updated, unchanged: parsed.rows.length - inserted - updated, rejected };
  } catch (err) {
    return fail(`Falha ao gravar: ${err instanceof Error ? err.message : String(err)}`, parsed.read);
  }
}

/** UTC days to (re)sync: today and the previous `days - 1` days. */
export function recentUtcDays(days: number, now = new Date()): string[] {
  return Array.from({ length: days }, (_, i) => new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
}

/** Freshness of INPE data, used to decide whether hotspot proximity can be inferred. */
export async function inpeFreshness(): Promise<{ lastSuccessAt: Date | null; fresh: boolean }> {
  const rows = await db
    .select({ at: sourceSyncRuns.finishedAt })
    .from(sourceSyncRuns)
    .innerJoin(dataSources, eq(dataSources.id, sourceSyncRuns.sourceId))
    .where(and(eq(dataSources.key, INPE_SOURCE_KEY), eq(sourceSyncRuns.status, "sucesso")))
    .orderBy(sql`${sourceSyncRuns.finishedAt} desc`)
    .limit(1);
  const at = rows[0]?.at ?? null;
  const maxAgeH = Number(process.env.INPE_MAX_AGE_HOURS ?? 6);
  return { lastSuccessAt: at, fresh: !!at && Date.now() - at.getTime() <= maxAgeH * 3_600_000 };
}
