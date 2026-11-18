/**
 * INMET connector — automatic weather stations (official OBSERVATIONS).
 *
 * Sources (verified 18/11/2026):
 *  - Station registry: https://apitempo.inmet.gov.br/estacoes/T  (public JSON, ~668 automatic stations)
 *  - Hourly observations: yearly ZIP files of the "Dados Históricos" portal
 *      https://portal.inmet.gov.br/uploads/dadoshistoricos/<ANO>.zip
 *    one CSV per station (latin-1, ";" separator, decimal comma, 8 header lines,
 *    hour in UTC). The current year's file is updated by INMET about monthly.
 *  - The hourly API (apitempo.inmet.gov.br/estacao/...) answers 204 without a
 *    token issued by INMET; it is NOT used (pending credential), and nothing is
 *    simulated in its place.
 * Values are kept in the source units (°C, %, m/s, mm, hPa, kJ/m²).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { dataSources, sourceSyncRuns, weatherStations } from "@shared/schema";
import { retryDelay, type RetryPolicy } from "./sisfogo";

export const INMET_SOURCE_KEY = "inmet-estacoes";
export const INMET_STATIONS_URL = "https://apitempo.inmet.gov.br/estacoes/T";
export const INMET_YEAR_URL = (year: number) => `https://portal.inmet.gov.br/uploads/dadoshistoricos/${year}.zip`;
const MAX_ZIP_BYTES = 300 * 1024 * 1024;

// ── Time zone: Brazil has no DST since 2019; offset by state (documented approximation:
//    the south-west of Amazonas is UTC-5 but is treated as UTC-4).
const UTC_MINUS_5 = new Set(["AC"]);
const UTC_MINUS_4 = new Set(["AM", "RO", "RR", "MT", "MS"]);
export const utcOffsetForState = (uf: string | null | undefined) => (uf && UTC_MINUS_5.has(uf) ? -5 : uf && UTC_MINUS_4.has(uf) ? -4 : -3);

// ── HTTP with retry ─────────────────────────────────────────────────────────
export type FetchBin = (url: string) => Promise<{ status: number; headers: Record<string, string | null>; body: Buffer }>;
export const defaultFetchBin: FetchBin = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(900_000), headers: { "User-Agent": "ARTEMIS-AI/1.0 (monitoramento ambiental)" } });
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_ZIP_BYTES) throw new Error(`Arquivo maior que o limite (${len} bytes).`);
  const body = res.status === 200 ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  if (body.length > MAX_ZIP_BYTES) throw new Error("Arquivo maior que o limite.");
  return { status: res.status, headers: { "last-modified": res.headers.get("last-modified"), "content-type": res.headers.get("content-type") }, body };
};
export const INMET_RETRY: RetryPolicy = { timeoutMs: 900_000, attempts: 4, baseDelayMs: Number(process.env.INMET_RETRY_BASE_MS ?? 5_000), maxDelayMs: 120_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export async function fetchBinWithRetry(fetchBin: FetchBin, url: string, p: RetryPolicy = INMET_RETRY) {
  let last: unknown;
  for (let attempt = 1; attempt <= p.attempts; attempt++) {
    try {
      const r = await fetchBin(url);
      if (!RETRYABLE.has(r.status) || attempt === p.attempts) return { ...r, attempts: attempt };
      last = new Error(`INMET respondeu HTTP ${r.status}.`);
    } catch (e) { last = e; if (attempt === p.attempts) break; }
    await p.sleep(retryDelay(attempt, null, p));
  }
  throw new Error(`${last instanceof Error ? last.message : String(last)} (após ${p.attempts} tentativas)`);
}

// ── Station registry ────────────────────────────────────────────────────────
export interface StationRecord { code: string; name: string; state: string | null; latitude: number; longitude: number; altitudeM: number | null; stationType: string | null; status: string | null; operationStart: Date | null; operationEnd: Date | null; registry: unknown }

const numPt = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim().replace(",", ".");
  if (t === "" || /^-?9999(\.0+)?$/.test(t) || t.toLowerCase() === "null") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const isoOrNull = (v: unknown) => { const d = v ? new Date(String(v)) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

export function parseStationList(json: unknown): { stations: StationRecord[]; rejected: Record<string, number> } {
  if (!Array.isArray(json)) throw new Error("Lista de estações do INMET em formato inesperado (não é uma lista).");
  const rejected: Record<string, number> = {};
  const rej = (r: string) => { rejected[r] = (rejected[r] ?? 0) + 1; };
  const out: StationRecord[] = [];
  const seen = new Set<string>();
  for (const s of json as any[]) {
    const code = String(s?.CD_ESTACAO ?? "").trim().toUpperCase();
    if (!/^[A-Z]\d{3}$/.test(code)) { rej("código inválido"); continue; }
    if (seen.has(code)) { rej("estação repetida"); continue; }
    const lat = numPt(s.VL_LATITUDE), lng = numPt(s.VL_LONGITUDE);
    if (lat === null || lng === null || lat < -35 || lat > 7 || lng < -75 || lng > -28) { rej("coordenadas fora do Brasil"); continue; }
    seen.add(code);
    out.push({ code, name: String(s.DC_NOME ?? code).trim(), state: s.SG_ESTADO ? String(s.SG_ESTADO).trim().toUpperCase() : null, latitude: lat, longitude: lng,
      altitudeM: numPt(s.VL_ALTITUDE), stationType: s.TP_ESTACAO ?? null, status: s.CD_SITUACAO ?? null,
      operationStart: isoOrNull(s.DT_INICIO_OPERACAO), operationEnd: isoOrNull(s.DT_FIM_OPERACAO), registry: s });
  }
  return { stations: out, rejected };
}

export async function inmetSourceId(): Promise<number> {
  const [s] = await db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, INMET_SOURCE_KEY));
  if (!s) throw new Error("Fonte 'inmet-estacoes' não cadastrada (aplique a migração 0018).");
  return s.id;
}

export async function upsertStations(list: StationRecord[], sourceId: number) {
  let n = 0;
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200).map((s) => ({ ...s, sourceId, utcOffsetHours: utcOffsetForState(s.state) }));
    const r = await db.insert(weatherStations).values(chunk).onConflictDoUpdate({
      target: [weatherStations.sourceId, weatherStations.code],
      set: { name: sql`excluded.name`, state: sql`coalesce(excluded.state, weather_stations.state)`, latitude: sql`excluded.latitude`, longitude: sql`excluded.longitude`,
        altitudeM: sql`coalesce(excluded.altitude_m, weather_stations.altitude_m)`, stationType: sql`coalesce(excluded.station_type, weather_stations.station_type)`,
        status: sql`coalesce(excluded.status, weather_stations.status)`, utcOffsetHours: sql`excluded.utc_offset_hours`,
        operationStart: sql`coalesce(excluded.operation_start, weather_stations.operation_start)`, operationEnd: sql`excluded.operation_end`,
        registry: sql`coalesce(excluded.registry, weather_stations.registry)`, updatedAt: sql`now()` },
    }).returning({ id: weatherStations.id });
    n += r.length;
  }
  return n;
}

/** Downloads INMET's station list and upserts the registry (one sync run). */
export async function syncInmetStations(fetchBin: FetchBin = defaultFetchBin, retry: RetryPolicy = INMET_RETRY) {
  const sourceId = await inmetSourceId();
  const [run] = await db.insert(sourceSyncRuns).values({ sourceId, params: { kind: "estacoes", url: INMET_STATIONS_URL }, trigger: "cli" }).returning();
  try {
    const r = await fetchBinWithRetry(fetchBin, INMET_STATIONS_URL, retry);
    if (r.status !== 200) throw new Error(`INMET respondeu HTTP ${r.status} na lista de estações.`);
    const parsed = parseStationList(JSON.parse(r.body.toString("utf8")));
    if (parsed.stations.length < 100) throw new Error(`Lista com apenas ${parsed.stations.length} estações válidas; nada gravado.`);
    const n = await upsertStations(parsed.stations, sourceId);
    const rejected = Object.values(parsed.rejected).reduce((a, b) => a + b, 0);
    await db.update(sourceSyncRuns).set({ status: "sucesso", finishedAt: new Date(), recordsRead: parsed.stations.length + rejected, recordsUpdated: n, recordsRejected: rejected, rejectionReasons: parsed.rejected }).where(eq(sourceSyncRuns.id, run.id));
    return { runId: run.id, status: "sucesso" as const, stations: n, rejected: parsed.rejected };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.update(sourceSyncRuns).set({ status: "falha", finishedAt: new Date(), error }).where(eq(sourceSyncRuns.id, run.id));
    return { runId: run.id, status: "falha" as const, error };
  }
}

// ── Hourly CSV parsing + quality control ────────────────────────────────────
export interface ParsedObservation {
  observedAt: Date; line: number;
  temperatureC: number | null; temperatureMaxC: number | null; temperatureMinC: number | null; dewPointC: number | null;
  humidityPct: number | null; humidityMinPct: number | null; windSpeedMs: number | null; windGustMs: number | null; windDirectionDeg: number | null;
  precipitationMm: number | null; pressureHpa: number | null; radiationKjM2: number | null; qualityFlags: string[];
}
export interface ParsedStationFile {
  header: { region: string | null; state: string | null; name: string; code: string; latitude: number; longitude: number; altitudeM: number | null };
  rows: ParsedObservation[]; read: number; rejected: Record<string, number>; flagged: Record<string, number>;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
/** Column patterns (normalised header text). Order in the file varies between years. */
const COLS: Record<string, RegExp> = {
  date: /^DATA/, hour: /^HORA/,
  precipitation: /^PRECIPITACAO TOTAL/, pressure: /^PRESSAO ATMOSFERICA AO NIVEL DA ESTACAO/, radiation: /^RADIACAO GLOBAL/,
  temperature: /^TEMPERATURA DO AR - BULBO SECO/, dewPoint: /^TEMPERATURA DO PONTO DE ORVALHO/,
  temperatureMax: /^TEMPERATURA MAXIMA NA HORA ANT/, temperatureMin: /^TEMPERATURA MINIMA NA HORA ANT/,
  humidityMin: /^UMIDADE REL\. MIN\. NA HORA ANT/, humidity: /^UMIDADE RELATIVA DO AR, HORARIA/,
  windDirection: /^VENTO, DIRECAO HORARIA/, windGust: /^VENTO, RAJADA MAXIMA/, windSpeed: /^VENTO, VELOCIDADE HORARIA/,
};
const REQUIRED = ["date", "hour", "temperature", "humidity", "windSpeed", "precipitation"];

/** Physical/plausibility limits for Brazil (values outside become NULL + flag; raw stays in the file). */
export const QC_LIMITS = {
  temperatureC: [-10, 50], dewPointC: [-30, 40], humidityPct: [1, 100], windSpeedMs: [0, 60], windGustMs: [0, 90],
  precipitationMm: [0, 150], pressureHpa: [500, 1100], radiationKjM2: [0, 6000], windDirectionDeg: [0, 360],
} as const;

function parseTime(d: string, h: string): Date | null {
  // 2019+: "2026/01/01" + "0000 UTC"; until 2018: "2018-01-01" + "00:00"
  const dm = d.trim().match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  const hm = h.trim().match(/^(\d{2}):?(\d{2})(?:\s*UTC)?$/i);
  if (!dm || !hm) return null;
  const t = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +hm[1], +hm[2]));
  // reject roll-overs (month 13, 31/02…), minutes other than :00 and hours > 23
  if (Number.isNaN(t.getTime()) || +hm[2] !== 0 || +hm[1] > 23 || t.getUTCMonth() !== +dm[2] - 1 || t.getUTCDate() !== +dm[3]) return null;
  return t;
}

export function parseInmetCsv(text: string, opts: { year?: number; now?: Date } = {}): ParsedStationFile {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const meta: Record<string, string> = {};
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const cells = lines[i].split(";");
    if (/^data/i.test(norm(cells[0] ?? "")) && cells.length > 5) { headerIdx = i; break; }
    const k = norm((cells[0] ?? "").replace(/:$/, ""));
    if (k) meta[k] = (cells[1] ?? "").trim();
  }
  if (headerIdx < 0) throw new Error("Cabeçalho de colunas não encontrado no arquivo do INMET.");
  const code = (meta["CODIGO (WMO)"] ?? meta["CODIGO"] ?? "").trim().toUpperCase();
  if (!/^[A-Z]\d{3}$/.test(code)) throw new Error(`Código da estação inválido no cabeçalho: "${code}".`);
  const lat = numPt(meta["LATITUDE"]), lng = numPt(meta["LONGITUDE"]);
  if (lat === null || lng === null || lat < -35 || lat > 7 || lng < -75 || lng > -28) throw new Error(`${code}: coordenadas inválidas no cabeçalho.`);

  const cols = lines[headerIdx].split(";").map(norm);
  const idx: Record<string, number> = {};
  for (const [k, re] of Object.entries(COLS)) { const j = cols.findIndex((c) => re.test(c)); if (j >= 0) idx[k] = j; }
  const missing = REQUIRED.filter((k) => idx[k] === undefined);
  if (missing.length) throw new Error(`${code}: formato inesperado, colunas ausentes: ${missing.join(", ")}.`);

  const now = (opts.now ?? new Date()).getTime();
  const rejected: Record<string, number> = {}, flagged: Record<string, number> = {};
  const rej = (r: string) => { rejected[r] = (rejected[r] ?? 0) + 1; };
  const rows: ParsedObservation[] = [];
  const seen = new Set<number>();
  let read = 0, prevT: { t: number; at: number } | null = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    read++;
    const c = raw.split(";");
    const at = parseTime(c[idx.date] ?? "", c[idx.hour] ?? "");
    if (!at) { rej("data/hora inválida"); continue; }
    if (at.getTime() > now + 3_600_000) { rej("data/hora no futuro"); continue; }
    if (opts.year && at.getUTCFullYear() !== opts.year) { rej("fora do ano do arquivo"); continue; }
    if (seen.has(at.getTime())) { rej("hora repetida no arquivo"); continue; }
    seen.add(at.getTime());
    const flags: string[] = [];
    const get = (k: string, lim?: readonly [number, number], flag?: string) => {
      if (idx[k] === undefined) return null;
      const v = numPt(c[idx[k]]);
      if (v === null) return null;
      if (lim && (v < lim[0] || v > lim[1])) { flags.push(flag ?? `${k}_fora_da_faixa`); return null; }
      return v;
    };
    const o: ParsedObservation = {
      observedAt: at, line: i + 1,
      temperatureC: get("temperature", QC_LIMITS.temperatureC, "temperatura_fora_da_faixa"),
      temperatureMaxC: get("temperatureMax", QC_LIMITS.temperatureC, "temperatura_max_fora_da_faixa"),
      temperatureMinC: get("temperatureMin", QC_LIMITS.temperatureC, "temperatura_min_fora_da_faixa"),
      dewPointC: get("dewPoint", QC_LIMITS.dewPointC, "orvalho_fora_da_faixa"),
      humidityPct: get("humidity", QC_LIMITS.humidityPct, "umidade_fora_da_faixa"),
      humidityMinPct: get("humidityMin", QC_LIMITS.humidityPct, "umidade_min_fora_da_faixa"),
      windSpeedMs: get("windSpeed", QC_LIMITS.windSpeedMs, "vento_fora_da_faixa"),
      windGustMs: get("windGust", QC_LIMITS.windGustMs, "rajada_fora_da_faixa"),
      windDirectionDeg: get("windDirection", QC_LIMITS.windDirectionDeg, "direcao_fora_da_faixa"),
      precipitationMm: get("precipitation", QC_LIMITS.precipitationMm, "precipitacao_fora_da_faixa"),
      pressureHpa: get("pressure", QC_LIMITS.pressureHpa, "pressao_fora_da_faixa"),
      radiationKjM2: get("radiation", QC_LIMITS.radiationKjM2, "radiacao_fora_da_faixa"),
      qualityFlags: flags,
    };
    // consistency checks (values kept, flagged)
    if (o.temperatureC !== null && o.dewPointC !== null && o.dewPointC > o.temperatureC + 0.5) flags.push("orvalho_acima_da_temperatura");
    if (o.windGustMs !== null && o.windSpeedMs !== null && o.windGustMs + 0.05 < o.windSpeedMs) flags.push("rajada_menor_que_media");
    if (o.temperatureMaxC !== null && o.temperatureMinC !== null && o.temperatureMaxC + 0.05 < o.temperatureMinC) flags.push("max_menor_que_min");
    if (o.temperatureC !== null) {
      if (prevT && at.getTime() - prevT.at === 3_600_000 && Math.abs(o.temperatureC - prevT.t) > 10) flags.push("salto_de_temperatura");
      prevT = { t: o.temperatureC, at: at.getTime() };
    }
    const all = [o.temperatureC, o.humidityPct, o.windSpeedMs, o.precipitationMm, o.pressureHpa, o.dewPointC];
    if (all.every((v) => v === null)) { rej("hora sem nenhuma medida (lacuna da estação)"); continue; }
    if (o.windDirectionDeg !== null) o.windDirectionDeg = Math.round(o.windDirectionDeg);
    for (const f of flags) flagged[f] = (flagged[f] ?? 0) + 1;
    rows.push(o);
  }
  return {
    header: { region: meta["REGIAO"] || null, state: (meta["UF"] || "").toUpperCase() || null, name: meta["ESTACAO"] || code, code, latitude: lat, longitude: lng, altitudeM: numPt(meta["ALTITUDE"]) },
    rows, read, rejected, flagged,
  };
}

// ── Yearly archive ──────────────────────────────────────────────────────────
export async function loadYearZip(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  return Object.values(zip.files).filter((f) => !f.dir && /\.csv$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
}

export const rawDir = () => process.env.INMET_RAW_DIR ?? path.resolve(process.cwd(), "data/raw/inmet");

/** Preserves the original file exactly as downloaded (content-addressed). */
export function preserveRaw(year: number, sha: string, buf: Buffer): string {
  const dir = path.join(rawDir(), String(year));
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${year}-${sha.slice(0, 16)}.zip`);
  if (!existsSync(p)) writeFileSync(p, buf);
  return p;
}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export async function lastYearRun(sourceId: number, year: number) {
  const [r] = await db.select().from(sourceSyncRuns)
    .where(and(eq(sourceSyncRuns.sourceId, sourceId), sql`${sourceSyncRuns.params}->>'kind' = 'ano'`, sql`(${sourceSyncRuns.params}->>'year')::int = ${year}`))
    .orderBy(desc(sourceSyncRuns.id)).limit(1);
  return r ?? null;
}
