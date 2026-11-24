/**
 * INPE official fire-risk product (Programa Queimadas, model 2.2) — reader and sampler.
 *
 * Files (verified 23/11/2026, https://dataserver-coids.inpe.br/queimadas/queimadas/riscofogo_meteorologia/):
 *   observado/risco_fogo/INPE_FireRiskModel_2.2_FireRisk_<AAAAMMDD>.nc   NetCDF4 (HDF5), variable rf[1, lat, lon]
 *       1 km grid, lat ascending from −55.985, lon from −119.9898, fill −999; ~12 MB/day; published ~03:30 UTC next day;
 *       public archive ≈ last 10 months.
 *   previsto/risco_fogo/RF.PREV.T0..T3.tif   GeoTIFF (same 1 km grid, north-up), validity in the GDAL title
 *       "Risco de fogo previsto para o dia AAAAMMDDHH"; overwritten every day (~06:30 UTC).
 * Values are INPE's index 0–1 (meteorological susceptibility of the vegetation to burn), never a detection.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import h5wasm from "h5wasm/node";
import { fromArrayBuffer } from "geotiff";
import { pointInBoundary, bbox, centroid, type BoundaryGeom } from "@shared/geometry";
import { rfClass, type RfClass } from "@shared/inpe-fire-risk";
import { retryDelay, type RetryPolicy } from "./sisfogo";

export const INPE_RF_SOURCE_KEY = "inpe-risco-fogo";
export const INPE_RF_BASE = "https://dataserver-coids.inpe.br/queimadas/queimadas/riscofogo_meteorologia";
export const observedUrl = (day: string) => `${INPE_RF_BASE}/observado/risco_fogo/INPE_FireRiskModel_2.2_FireRisk_${day.replace(/-/g, "")}.nc`;
export const forecastUrl = (lead: number) => `${INPE_RF_BASE}/previsto/risco_fogo/RF.PREV.T${lead}.tif`;
const MAX_BYTES = 80 * 1024 * 1024;

// ── download ────────────────────────────────────────────────────────────────
export type FetchBin = (url: string) => Promise<{ status: number; body: Buffer; lastModified: string | null }>;
export const defaultFetchBin: FetchBin = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(600_000), headers: { "User-Agent": "ARTEMIS-AI/1.0 (monitoramento ambiental)" } });
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error(`Arquivo maior que o limite (${len} bytes).`);
  const body = r.status === 200 ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
  return { status: r.status, body, lastModified: r.headers.get("last-modified") };
};
export const RF_RETRY: RetryPolicy = { timeoutMs: 600_000, attempts: 4, baseDelayMs: Number(process.env.INPE_RF_RETRY_BASE_MS ?? 5_000), maxDelayMs: 120_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
export async function fetchWithRetry(f: FetchBin, url: string, p: RetryPolicy = RF_RETRY) {
  let last: unknown;
  for (let a = 1; a <= p.attempts; a++) {
    try { const r = await f(url); if (![408, 429, 500, 502, 503, 504].includes(r.status) || a === p.attempts) return { ...r, attempts: a }; last = new Error(`INPE respondeu HTTP ${r.status}.`); }
    catch (e) { last = e; if (a === p.attempts) break; }
    await p.sleep(retryDelay(a, null, p));
  }
  throw new Error(`${last instanceof Error ? last.message : String(last)} (após ${p.attempts} tentativas)`);
}
export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// ── raster abstraction (row 0 = southernmost) ───────────────────────────────
export interface RfRaster {
  lat0: number; lon0: number; step: number; nlat: number; nlon: number; validDay: string; title: string;
  /** rows [y0, y1) south→north, full width; values −999 = no data */
  rows(y0: number, y1: number): Promise<Float32Array>;
  close(): void;
}

let h5ready: Promise<unknown> | null = null;
/** Opens the observed NetCDF4. The buffer is written to a private temp file (h5wasm reads from a path). */
export async function openObservedNc(buf: Buffer): Promise<RfRaster> {
  if (buf.subarray(1, 4).toString() !== "HDF") throw new Error("Arquivo do INPE não é NetCDF4/HDF5.");
  h5ready ??= h5wasm.ready; await h5ready;
  const dir = mkdtempSync(path.join(os.tmpdir(), "inpe-rf-")); const p = path.join(dir, "rf.nc"); writeFileSync(p, buf);
  const f = new h5wasm.File(p, "r");
  const lat = f.get("lat") as any, lon = f.get("lon") as any, rf = f.get("rf") as any;
  if (!lat || !lon || !rf) { f.close(); rmSync(dir, { recursive: true, force: true }); throw new Error("NetCDF do INPE sem as variáveis lat/lon/rf."); }
  const la = lat.value as Float64Array, lo = lon.value as Float64Array;
  const title = String((f.attrs as any)?.title?.value ?? "");
  const m = title.match(/(\d{4})(\d{2})(\d{2})/);
  if (!m) { f.close(); rmSync(dir, { recursive: true, force: true }); throw new Error(`Título sem data: "${title}".`); }
  const step = la[1] - la[0];
  if (Math.abs(step - 0.01) > 1e-6 || la[1] < la[0]) { f.close(); rmSync(dir, { recursive: true, force: true }); throw new Error("Grade do INPE diferente da esperada (1 km, sul→norte)."); }
  return {
    lat0: la[0], lon0: lo[0], step, nlat: la.length, nlon: lo.length, validDay: `${m[1]}-${m[2]}-${m[3]}`, title,
    rows: async (y0, y1) => Float32Array.from(rf.slice([[0, 1], [y0, y1], [0, lo.length]]) as ArrayLike<number>),
    close: () => { f.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

/** Opens a forecast GeoTIFF (north-up) and exposes it south→north like the NetCDF. */
export async function openForecastTif(buf: Buffer): Promise<RfRaster> {
  const tif = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const im = await tif.getImage();
  const [ox, oy] = im.getOrigin(), [rx, ry] = im.getResolution();
  const W = im.getWidth(), H = im.getHeight();
  if (Math.abs(rx - 0.01) > 1e-6 || Math.abs(ry + 0.01) > 1e-6) throw new Error("GeoTIFF do INPE com resolução inesperada.");
  const title = String((im.getGDALMetadata?.() as any)?.["NC_GLOBAL#title"] ?? "");
  const m = title.match(/(\d{4})(\d{2})(\d{2})/);
  if (!m) throw new Error(`GeoTIFF sem data de validade no título: "${title}".`);
  return {
    lat0: oy + ry * (H - 0.5), lon0: ox + rx / 2, step: 0.01, nlat: H, nlon: W, validDay: `${m[1]}-${m[2]}-${m[3]}`, title,
    rows: async (y0, y1) => {
      // tif row r (north→south) ↔ our row H−1−r
      const r = (await im.readRasters({ window: [0, H - y1, W, H - y0], samples: [0] }))[0] as ArrayLike<number>;
      const out = new Float32Array((y1 - y0) * W);
      for (let i = 0; i < y1 - y0; i++) for (let x = 0; x < W; x++) out[i * W + x] = r[(y1 - y0 - 1 - i) * W + x];
      return out;
    },
    close: () => {},
  };
}

/**
 * Days without rain (INPE "NDSC": consecutive days with ≤ 1 mm/day within the last 120 days),
 * observado/numero_dias_sem_chuva/INPE_FireRiskModel_2.2_NDWR_<AAAAMMDD>.nc — NetCDF3, 0.1°, variable ndsc120.
 */
export const ndwrUrl = (day: string) => `${INPE_RF_BASE}/observado/numero_dias_sem_chuva/INPE_FireRiskModel_2.2_NDWR_${day.replace(/-/g, "")}.nc`;
export async function openNdwrNc(buf: Buffer, day: string): Promise<RfRaster> {
  const { NetCDFReader } = await import("netcdfjs");
  if (buf.subarray(0, 3).toString() !== "CDF") throw new Error("Arquivo de dias sem chuva não é NetCDF3.");
  const r = new NetCDFReader(buf);
  const la = r.getDataVariable("lat") as number[], lo = r.getDataVariable("lon") as number[];
  const raw = r.getDataVariable("ndsc120") as unknown as number[] | number[][];
  const data = Float32Array.from(Array.isArray(raw[0]) ? (raw[0] as number[]) : (raw as number[]));
  const step = la[1] - la[0];
  if (!(step > 0)) throw new Error("Grade de dias sem chuva fora do esperado.");
  return { lat0: la[0], lon0: lo[0], step, nlat: la.length, nlon: lo.length, validDay: day, title: String(r.getAttribute?.("title") ?? "NDSC 120 dias"),
    rows: async (y0, y1) => data.subarray(y0 * lo.length, y1 * lo.length), close: () => {} };
}
export const validDays = (v: number) => Number.isFinite(v) && v >= 0 && v <= 120;

// ── sampling ────────────────────────────────────────────────────────────────
export interface RfTarget { type: "area" | "station"; id: number; boundary?: BoundaryGeom | null; lat?: number | null; lng?: number | null }
export interface RfSample { type: "area" | "station"; id: number; mean: number | null; max: number | null; min: number | null; cls: RfClass | null; pixelsTotal: number; pixelsValid: number; method: string }
const validRf = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
const valid = validRf;
export const NEAREST_MAX_PX = 5;

/** Serves row ranges from a cached band of ≥ `band` rows (tile-aligned for GeoTIFF), so nearby targets reuse one decode. */
function banded(r: RfRaster, band = 256) {
  let b0 = -1, b1 = -1, data: Float32Array | null = null;
  return async (y0: number, y1: number) => {
    if (!data || y0 < b0 || y1 > b1) {
      b0 = Math.floor(y0 / band) * band; b1 = Math.min(r.nlat, Math.max(y1, b0 + band));
      data = await r.rows(b0, b1);
    }
    return data.subarray((y0 - b0) * r.nlon, (y1 - b0) * r.nlon);
  };
}

export async function sampleTargets(r: RfRaster, targets: RfTarget[]): Promise<RfSample[]> {
  const out: RfSample[] = [];
  const read = banded(r);
  // visit targets south→north so consecutive ones fall in the same cached band
  const yKey = (t: RfTarget) => (t.boundary ? bbox(t.boundary).minLat : t.lat ?? 0);
  targets = [...targets].sort((a, b) => yKey(a) - yKey(b));
  const yOf = (lat: number) => Math.round((lat - r.lat0) / r.step), xOf = (lon: number) => Math.round((lon - r.lon0) / r.step);
  for (let t of targets) {
    let vals: number[] = [], total = 0, method = "pixel";
    if (t.boundary) {
      const b = bbox(t.boundary);
      const y0 = Math.max(0, yOf(b.minLat)), y1 = Math.min(r.nlat - 1, yOf(b.maxLat)), x0 = Math.max(0, xOf(b.minLng)), x1 = Math.min(r.nlon - 1, xOf(b.maxLng));
      if (y1 >= y0 && x1 >= x0 && (y1 - y0 + 1) * (x1 - x0 + 1) <= 4_000_000) {
        const rows = await read(y0, y1 + 1);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          if (!pointInBoundary([r.lon0 + x * r.step, r.lat0 + y * r.step], t.boundary)) continue;
          total++; const v = rows[(y - y0) * r.nlon + x]; if (valid(v)) vals.push(v);
        }
        method = "media_pixels_no_poligono";
      }
      if (vals.length === 0) { const [cx, cy] = centroid(t.boundary); t = { ...t, lat: cy, lng: cx }; method = total === 0 ? "pixel_do_centro (area menor que 1 km²)" : "pixel_do_centro"; total = 0; }
    }
    if (vals.length === 0 && t.lat != null && t.lng != null) {
      const y = yOf(t.lat), x = xOf(t.lng);
      if (y >= 0 && y < r.nlat && x >= 0 && x < r.nlon) {
        total = 1;
        const v = (await read(y, y + 1))[x];
        if (valid(v)) vals = [v];
        else {
          // INPE does not compute RF over urban areas and water ("-x-" classes). For a point (station or
          // area without boundary) use the nearest valid pixel within NEAREST_MAX_PX (1 px ≈ 1 km), and say so.
          const R = NEAREST_MAX_PX, ya = Math.max(0, y - R), yb = Math.min(r.nlat, y + R + 1), rows = await read(ya, yb);
          let best: { d: number; v: number } | null = null;
          for (let yy = ya; yy < yb; yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(r.nlon - 1, x + R); xx++) {
            const w = rows[(yy - ya) * r.nlon + xx]; if (!valid(w)) continue;
            const d = Math.hypot(yy - y, (xx - x) * Math.cos((t.lat * Math.PI) / 180));
            if (d <= R && (!best || d < best.d)) best = { d, v: w };
          }
          if (best) { vals = [best.v]; method = `pixel_valido_mais_proximo (${best.d.toFixed(1)} km; o pixel do ponto não tem valor — área urbana ou água)`; }
          else method = "sem_valor (área urbana, água ou sem dado no raio de 5 km)";
        }
      }
    }
    const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    out.push({ type: t.type, id: t.id, mean, max: vals.length ? Math.max(...vals) : null, min: vals.length ? Math.min(...vals) : null,
      cls: mean == null ? null : rfClass(mean), pixelsTotal: total, pixelsValid: vals.length, method });
  }
  return out;
}

/** Coarse grid over Brazil: mean and max of valid pixels per cell (cellDeg multiple of 0.01). */
export async function coarseGrid(r: RfRaster, cellDeg = 0.2, box = { minLat: -34, maxLat: 6, minLng: -74, maxLng: -34 }, isValid?: (v: number) => boolean) {
  const k = Math.round(cellDeg / r.step);
  const valid = isValid ?? validRf;
  const nlat = Math.round((box.maxLat - box.minLat) / cellDeg), nlon = Math.round((box.maxLng - box.minLng) / cellDeg);
  const sum = new Float64Array(nlat * nlon), cnt = new Uint32Array(nlat * nlon), mx = new Float32Array(nlat * nlon).fill(-1);
  // yOrigin = raster row of the box's southern edge (negative when the raster starts north of it)
  const yOrigin = Math.round((box.minLat - r.lat0) / r.step), yStart = Math.max(0, yOrigin), yEnd = Math.min(r.nlat, yOrigin + nlat * k);
  const xStart = Math.round((box.minLng - r.lon0) / r.step);
  for (let y0 = yStart; y0 < yEnd; y0 += 256) {
    const y1 = Math.min(yEnd, y0 + 256), rows = await r.rows(y0, y1);
    for (let y = y0; y < y1; y++) {
      const cy = Math.floor((y - yOrigin) / k); if (cy < 0 || cy >= nlat) continue;
      for (let cx = 0; cx < nlon; cx++) for (let j = 0; j < k; j++) {
        const x = xStart + cx * k + j; if (x < 0 || x >= r.nlon) continue;
        const v = rows[(y - y0) * r.nlon + x]; if (!valid(v)) continue;
        const c = cy * nlon + cx; sum[c] += v; cnt[c]++; if (v > mx[c]) mx[c] = v;
      }
    }
  }
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { cellDeg, lat0: box.minLat, lon0: box.minLng, nlat, nlon,
    mean: Array.from(sum, (s, i) => (cnt[i] ? round(s / cnt[i]) : null)), max: Array.from(mx, (v, i) => (cnt[i] ? round(v) : null)) };
}
