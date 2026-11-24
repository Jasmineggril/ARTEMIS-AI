/**
 * Reproduction of INPE's OFFICIAL observed fire risk (model 2.2) from INPE's
 * own published inputs, to validate shared/inpe-fire-risk.ts and to settle the
 * points the script leaves open (unit of UR, which days form the 120-day window).
 *
 *   npx tsx scripts/inpe-rf-replication.ts --day 2026-11-22 --dir <inputs> --official <rf.nc> --sample 20000 --out evid.json
 *
 * <inputs> must contain, all from https://dataserver-coids.inpe.br/queimadas/queimadas/:
 *   P_YYYYMMDD.nc   riscofogo_meteorologia/observado/precipitacao   (IMERG, 0.1°, mm/day) — 121 days up to --day
 *   Temperature_YYYYMMDD.nc, RelativeHumidity_YYYYMMDD.nc            (GFS 18 UTC, 0.25°)
 *   veg.nc  (outros/rf/arquivos_auxiliares/Merge_MapBiomas_V5_IGBP_C6_2019.nc, 1 km, classes 1–7)
 *   topo.nc (outros/rf/arquivos_auxiliares/GeoTOPOAmericaSulCentral_V3.nc, 1 km, metres)
 * Interpolation as in INPE's script: PSE (0.1°) and FU/FT (0.25°) bilinear to the 1 km point.
 * Pixels with INPE detections in the previous 3 days are reported apart: the observed
 * product is corrected by recent fire detections (Anuário Risco de Fogo 2025, §3),
 * a step that is not published as code.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NetCDFReader } from "netcdfjs";
import h5wasm from "h5wasm/node";
import { sql } from "drizzle-orm";
import { inpeFireRisk, pse as psef, rfClass } from "../shared/inpe-fire-risk";

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const DAY = arg("day", "2026-11-22")!, DIR = arg("dir")!, OFFICIAL = arg("official")!, SAMPLE = Number(arg("sample", "20000")), OUT = arg("out");
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const shift = (days: number) => new Date(Date.parse(DAY + "T00:00:00Z") - days * 86_400_000);

interface Grid { lat: Float64Array | number[]; lon: Float64Array | number[]; data: ArrayLike<number>; nlon: number }
function nc3(file: string, varName: string): Grid {
  const r = new NetCDFReader(readFileSync(file));
  const lat = r.getDataVariable("lat") as number[], lon = r.getDataVariable("lon") as number[];
  const raw = r.getDataVariable(varName) as unknown as number[] | number[][];
  const data = Array.isArray(raw[0]) ? (raw[0] as number[]) : (raw as number[]); // record (time) variables come per record
  return { lat, lon, data, nlon: lon.length };
}
/** bilinear interpolation on a regular ascending grid; NaN if any corner missing */
function bilinear(g: Grid, la: number, lo: number, missing = (v: number) => !Number.isFinite(v) || v <= -999) {
  const dy = (g.lat[1] as number) - (g.lat[0] as number), dx = (g.lon[1] as number) - (g.lon[0] as number);
  const fy = (la - (g.lat[0] as number)) / dy, fx = (lo - (g.lon[0] as number)) / dx;
  const y0 = Math.floor(fy), x0 = Math.floor(fx);
  if (y0 < 0 || x0 < 0 || y0 + 1 >= g.lat.length || x0 + 1 >= g.lon.length) return NaN;
  const ty = fy - y0, tx = fx - x0, v = (y: number, x: number) => g.data[y * g.nlon + x];
  const a = v(y0, x0), b = v(y0, x0 + 1), c = v(y0 + 1, x0), d = v(y0 + 1, x0 + 1);
  if ([a, b, c, d].some(missing)) return NaN;
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

async function main() {
  const t0 = Date.now();
  await h5wasm.ready;
  const f = new h5wasm.File(OFFICIAL, "r");
  const lat = f.get("lat").value as Float64Array, lon = f.get("lon").value as Float64Array;
  const rf = (f.get("rf") as any).value as Float32Array;
  const NX = lon.length, NY = lat.length;
  const veg = nc3(path.join(DIR, "veg.nc"), "Band1"), topo = nc3(path.join(DIR, "topo.nc"), "Band1");
  if (veg.lat.length !== NY || veg.nlon !== NX) throw new Error("Grade de vegetação diferente da grade oficial.");
  const T = nc3(path.join(DIR, `Temperature_${DAY.replace(/-/g, "")}.nc`), "temp2m");
  const RH = nc3(path.join(DIR, `RelativeHumidity_${DAY.replace(/-/g, "")}.nc`), "rh2m");

  // precipitation: index 0 = DAY, 1 = DAY-1, … (121 days so both window alignments can be tested)
  const precip: (Grid | null)[] = [];
  const missingDays: string[] = [];
  for (let i = 0; i <= 120; i++) {
    const p = path.join(DIR, `P_${ymd(shift(i))}.nc`);
    if (existsSync(p) && readFileSync(p).subarray(0, 3).toString() === "CDF") precip.push(nc3(p, "prec"));
    else { precip.push(null); missingDays.push(shift(i).toISOString().slice(0, 10)); }
  }
  const pg = precip.find(Boolean)!;
  const psePoint = (la: number, lo: number, startIdx: number) => {
    // PSE at the 4 surrounding 0.1° nodes, then bilinear (as INPE interpolates the PSE field)
    const dy = (pg.lat[1] as number) - (pg.lat[0] as number), dx = (pg.lon[1] as number) - (pg.lon[0] as number);
    const y0 = Math.floor((la - (pg.lat[0] as number)) / dy), x0 = Math.floor((lo - (pg.lon[0] as number)) / dx);
    const node = (y: number, x: number) => {
      const daily = new Float64Array(120);
      for (let k = 0; k < 120; k++) { const g = precip[startIdx + k]; const v = g ? g.data[y * g.nlon + x] : 0; daily[k] = Number.isFinite(v) && v > -999 ? v : 0; }
      return psef(daily);
    };
    const g4: Grid = { lat: [pg.lat[y0] as number, pg.lat[y0 + 1] as number], lon: [pg.lon[x0] as number, pg.lon[x0 + 1] as number], nlon: 2,
      data: [node(y0, x0), node(y0, x0 + 1), node(y0 + 1, x0), node(y0 + 1, x0 + 1)] };
    return bilinear(g4, la, lo);
  };

  // recent INPE detections (3 days) to separate the fire-correction step
  let recent = new Set<string>();
  if (process.env.DATABASE_URL) {
    const { db, pool } = await import("../server/db");
    const rows = (await db.execute<{ k: string }>(sql`
      SELECT DISTINCT round(((latitude - ${lat[0]}) / 0.01))::int || ':' || round(((longitude - ${lon[0]}) / 0.01))::int AS k
      FROM satellite_hotspots WHERE detected_at >= ${shift(2).toISOString()}::timestamptz AND detected_at < ${new Date(shift(-1)).toISOString()}::timestamptz`)).rows;
    recent = new Set(rows.map((r) => r.k)); await pool?.end();
  }
  const nearFire = (y: number, x: number) => { for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (recent.has(`${y + a}:${x + b}`)) return true; return false; };

  // seeded sample of land pixels inside Brazil's bounding box with an official value
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const variants: Record<string, { rh: "percent" | "fraction"; start: number; slope: number; v22: boolean }> = {};
  const slopes = (process.env.RF_SLOPES ?? "-0.008,-0.006").split(",").map(Number);
  const rhs = (process.env.RF_RH ?? "percent,fraction").split(",") as ("percent" | "fraction")[];
  const starts = (process.env.RF_START ?? "0,1").split(",").map(Number), v22s = (process.env.RF_V22 ?? "1,0").split(",").map((x) => x === "1");
  for (const rh of rhs) for (const start of starts) for (const slope of slopes) for (const v22 of v22s)
    variants[`UR ${rh === "percent" ? "%" : "fração"} · janela até ${start ? "o dia anterior" : "o dia"} · FU ${slope} · ${v22 ? "com" : "sem"} fatores 2.2`] = { rh, start, slope, v22 };
  const acc: Record<string, { n: number; abs: number; within01: number; within05: number; sameClass: number; nNoFire: number; absNoFire: number; within01NoFire: number; sameClassNoFire: number }> = {};
  for (const k of Object.keys(variants)) acc[k] = { n: 0, abs: 0, within01: 0, within05: 0, sameClass: 0, nNoFire: 0, absNoFire: 0, within01NoFire: 0, sameClassNoFire: 0 };
  let tried = 0, used = 0;
  const examples: unknown[] = [];
  while (used < SAMPLE && tried < SAMPLE * 50) {
    tried++;
    const y = Math.floor(rnd() * NY), x = Math.floor(rnd() * NX);
    const la = lat[y], lo = lon[x];
    if (la < -34 || la > 5.5 || lo < -74 || lo > -34) continue;
    const off = rf[y * NX + x]; const vc = veg.data[y * NX + x];
    if (!(off >= 0 && off <= 1) || !(vc >= 1 && vc <= 7)) continue;
    const t = bilinear(T, la, lo), h = bilinear(RH, la, lo); const el = topo.data[y * NX + x];
    if (!Number.isFinite(t) || !Number.isFinite(h)) continue;
    const pses = [psePoint(la, lo, 0), psePoint(la, lo, 1)];
    if (pses.some((p) => !Number.isFinite(p))) continue;
    used++;
    const fire = nearFire(y, x);
    for (const [k, v] of Object.entries(variants)) {
      const r = inpeFireRisk({ pse: pses[v.start], vegClass: vc, temperatureC: t - 273.15, rh: h, lat: la, elevationM: el > -1000 ? el : 0 }, { rhUnit: v.rh, fuSlope: v.slope, applyV22: v.v22 });
      if (r.rf === null) continue;
      const e = Math.abs(r.rf - off), a = acc[k];
      a.n++; a.abs += e; if (e <= 0.01) a.within01++; if (e <= 0.05) a.within05++; if (rfClass(r.rf) === rfClass(off)) a.sameClass++;
      if (!fire) { a.nNoFire++; a.absNoFire += e; if (e <= 0.01) a.within01NoFire++; if (rfClass(r.rf) === rfClass(off)) a.sameClassNoFire++; }
      if (examples.length < 12 && k === Object.keys(variants)[0]) examples.push({ lat: la, lon: lo, veg: vc, elev: el, tC: +(t - 273.15).toFixed(2), rh: +h.toFixed(1), pse: +pses[0].toFixed(2), oficial: +off.toFixed(4), artemis: +r.rf.toFixed(4), focoRecente: fire });
    }
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const results = Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, {
    pixels: a.n, mae: +(a.abs / a.n).toFixed(4), within001Pct: pct(a.within01, a.n), within005Pct: pct(a.within05, a.n), sameClassPct: pct(a.sameClass, a.n),
    semFocoRecente: { pixels: a.nNoFire, mae: +(a.absNoFire / Math.max(1, a.nNoFire)).toFixed(4), within001Pct: pct(a.within01NoFire, a.nNoFire), sameClassPct: pct(a.sameClassNoFire, a.nNoFire) },
  }]));
  const best = Object.entries(results).sort((a, b) => a[1].mae - b[1].mae)[0][0];
  const report = { day: DAY, officialFile: path.basename(OFFICIAL), sampledPixels: used, missingPrecipDaysOnServer: missingDays, recentFirePixels3d: recent.size, results, bestVariant: best, examples, durationS: Math.round((Date.now() - t0) / 1000) };
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, examples: examples.slice(0, 4) }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
