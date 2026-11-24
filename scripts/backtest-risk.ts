/**
 * Retrospective evaluation (backtest) of the rule engine on REAL data.
 *
 *   npx tsx scripts/backtest-risk.ts --from 2026-08-25 --to 2026-11-10 --step 7 --sample 400 --seed 7 --out evid.json
 *
 * Unit of analysis: (municipality point, date D at 15:00 UTC ≈ midday in Brazil).
 *  - Points: a seeded random sample of municipalities, at the centroid of the
 *    OFFICIAL IBGE boundary (ST_PointOnSurface when PostGIS is present).
 *  - Inputs known AT D (nothing after D is used):
 *      weather   Open-Meteo hourly model data at D (temperature, humidity, wind)
 *                and rain summed over the 72 h before D;
 *      hotspot   nearest INPE detection within 50 km in the 24 h before D;
 *      history   Sisfogo ROIs within 10 km that started before D;
 *      vegetation not observed by any connected source → "moderada" for all
 *                cases (stated as a limitation; it shifts every score by +4).
 *  - Outcome (label): at least one INPE detection within 10 km in (D, D + 7 days].
 *  - The engine has no trained parameters, so there is no train/test leakage;
 *    stability over time is reported per month instead.
 *  - Baselines: "persistence" (a detection within 10 km in the 24 h before D)
 *    and the prevalence (always predicting the majority class).
 * Output: JSON with the cases, confusion matrices, rates by level and ROC AUC.
 * Labels come from INPE hotspots, which are thermal detections, not confirmed fires.
 */
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { hasPostgisGeom } from "../server/spatial";
import { calculateRisk, type RiskInput } from "../shared/risk-engine";

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const FROM = arg("from", "2026-08-25")!, TO = arg("to", "2026-11-10")!;
const STEP = Number(arg("step", "7")), SAMPLE = Number(arg("sample", "400")), SEED = Number(arg("seed", "7"));
const RADIUS_KM = Number(arg("radius", "10")), WINDOW_D = Number(arg("window", "7")), OUT = arg("out");
const HOUR = 15;

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 2 ** 32; return seed / 2 ** 32; }; }

interface Pt { code: string; name: string; state: string; lat: number; lng: number }
interface Case { code: string; state: string; date: string; month: string; score: number; level: string; hotspotKm: number | null; history: number;
  temperature: number; humidity: number; wind: number; rain72: number; event: boolean; persistence: boolean }

async function samplePoints(): Promise<Pt[]> {
  const postgis = await hasPostgisGeom();
  const rows = (await db.execute<Pt>(postgis
    ? sql`SELECT b.ibge_code AS code, m.name, m.state, ST_Y(ST_PointOnSurface(b.geom)) AS lat, ST_X(ST_PointOnSurface(b.geom)) AS lng
          FROM municipality_boundaries b JOIN municipalities m USING (ibge_code) ORDER BY b.ibge_code`
    : sql`SELECT b.ibge_code AS code, m.name, m.state, b.centroid_lat AS lat, b.centroid_lng AS lng
          FROM municipality_boundaries b JOIN municipalities m USING (ibge_code) ORDER BY b.ibge_code`)).rows;
  if (rows.length < 1000) throw new Error("Limites municipais do IBGE não carregados (npm run db:load-boundaries).");
  const r = rng(SEED);
  const shuffled = rows.map((p) => ({ p, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  return shuffled.slice(0, SAMPLE);
}

type Hourly = { time: string[]; temperature_2m: number[]; relative_humidity_2m: number[]; wind_speed_10m: number[]; precipitation: number[] };
async function weatherFor(points: Pt[]): Promise<Hourly[]> {
  const out: Hourly[] = [];
  for (let i = 0; i < points.length; i += 50) {
    const batch = points.slice(i, i + 50);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", batch.map((p) => p.lat.toFixed(4)).join(","));
    url.searchParams.set("longitude", batch.map((p) => p.lng.toFixed(4)).join(","));
    url.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation");
    url.searchParams.set("past_days", "92"); url.searchParams.set("forecast_days", "1"); url.searchParams.set("timezone", "UTC");
    let json: any = null;
    for (let a = 1; a <= 5; a++) {
      const res = await fetch(url);
      if (res.ok) { json = await res.json(); break; }
      if (a === 5) throw new Error(`Open-Meteo HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 5000 * a));
    }
    const arr = Array.isArray(json) ? json : [json];
    for (const j of arr) out.push(j.hourly as Hourly);
    await new Promise((r) => setTimeout(r, 1500)); // be gentle with the free API
  }
  return out;
}

function weatherAt(h: Hourly, at: Date) {
  const key = at.toISOString().slice(0, 13) + ":00";
  const idx = h.time.indexOf(key);
  if (idx < 72) return null;
  const t = h.temperature_2m[idx], u = h.relative_humidity_2m[idx], w = h.wind_speed_10m[idx];
  const rain = h.precipitation.slice(idx - 72, idx);
  if (![t, u, w].every(Number.isFinite) || rain.filter(Number.isFinite).length < 48) return null;
  return { temperature: t, humidity: u, wind: w, rain72: Math.round(rain.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0) * 10) / 10 };
}

async function hotspotFacts(p: Pt, at: Date) {
  const g = sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;
  const [prev] = (await db.execute<{ km: number | null; near: boolean }>(sql`
    SELECT min(ST_Distance(geom, ${g})) / 1000 AS km, bool_or(ST_DWithin(geom, ${g}, ${RADIUS_KM * 1000})) AS near FROM satellite_hotspots
    WHERE detected_at >= ${new Date(at.getTime() - 86_400_000)} AND detected_at < ${at} AND ST_DWithin(geom, ${g}, 50000)`)).rows;
  const [next] = (await db.execute<{ ev: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM satellite_hotspots WHERE detected_at > ${at} AND detected_at <= ${new Date(at.getTime() + WINDOW_D * 86_400_000)}
      AND ST_DWithin(geom, ${g}, ${RADIUS_KM * 1000})) AS ev`)).rows;
  const [hist] = (await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM fire_occurrences f JOIN data_sources s ON s.id = f.data_source_id
    WHERE s.key = 'sisfogo-roi' AND f.organization_id IS NULL AND f.occurred_at < ${at} AND ST_DWithin(f.geom, ${g}, 10000)`)).rows;
  return { hotspotKm: prev?.km == null ? null : Math.round(Number(prev.km) * 10) / 10, persistence: !!prev?.near, event: !!next?.ev, history: hist?.n ?? 0 };
}

function auc(cases: Case[]) {
  const pos = cases.filter((c) => c.event).map((c) => c.score), neg = cases.filter((c) => !c.event).map((c) => c.score);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return Math.round((s / (pos.length * neg.length)) * 1000) / 1000;
}
function confusion(cases: Case[], pred: (c: Case) => boolean) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const c of cases) { const p = pred(c); if (p && c.event) tp++; else if (p) fp++; else if (c.event) fn++; else tn++; }
  const r = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);
  return { tp, fp, fn, tn, precision: r(tp, tp + fp), recall: r(tp, tp + fn), specificity: r(tn, tn + fp), falsePositiveRate: r(fp, fp + tn),
    f1: tp ? Math.round(((2 * tp) / (2 * tp + fp + fn)) * 1000) / 1000 : 0 };
}
const LEVELS = ["baixo", "moderado", "alto", "crítico"];
function summary(cases: Case[]) {
  return {
    n: cases.length, events: cases.filter((c) => c.event).length,
    prevalence: cases.length ? Math.round((cases.filter((c) => c.event).length / cases.length) * 1000) / 1000 : null,
    byLevel: LEVELS.map((l) => { const s = cases.filter((c) => c.level === l); const e = s.filter((c) => c.event).length; return { level: l, n: s.length, events: e, eventRate: s.length ? Math.round((e / s.length) * 1000) / 1000 : null }; }),
    rocAucScore: auc(cases),
    alertAltoOuCritico: confusion(cases, (c) => c.level === "alto" || c.level === "crítico"),
    alertModeradoOuMais: confusion(cases, (c) => c.level !== "baixo"),
    baselinePersistencia: confusion(cases, (c) => c.persistence),
    engineWithoutHotspotsSubset: (() => { const s = cases.filter((c) => !c.persistence); return { n: s.length, rocAucScore: auc(s), alertModeradoOuMais: confusion(s, (c) => c.level !== "baixo") }; })(),
  };
}

async function main() {
  if (!(await hasPostgisGeom())) throw new Error("Este backtest usa PostGIS (ST_DWithin). Habilite a extensão (scripts/db/enable-postgis.sql).");
  const t0 = Date.now();
  const pts = await samplePoints();
  const wx = await weatherFor(pts);
  const dates: Date[] = [];
  for (let t = Date.parse(`${FROM}T${String(HOUR).padStart(2, "0")}:00:00Z`); t <= Date.parse(`${TO}T23:59:59Z`); t += STEP * 86_400_000) dates.push(new Date(t));
  const cases: Case[] = [];
  let skippedWeather = 0;
  for (let i = 0; i < pts.length; i++) {
    for (const d of dates) {
      const w = weatherAt(wx[i], d);
      if (!w) { skippedWeather++; continue; }
      const h = await hotspotFacts(pts[i], d);
      const input: RiskInput = { temperature: w.temperature, humidity: w.humidity, windSpeed: w.wind, recentRainfall: w.rain72, vegetationCondition: 2,
        nearbyHotspot: h.hotspotKm != null, hotspotDistance: h.hotspotKm ?? 0, historicalOccurrences: h.history, dataQuality: 2 };
      const r = calculateRisk(input);
      cases.push({ code: pts[i].code, state: pts[i].state, date: d.toISOString().slice(0, 10), month: d.toISOString().slice(0, 7), score: r.score, level: r.level,
        hotspotKm: h.hotspotKm, history: h.history, ...w, event: h.event, persistence: h.persistence });
    }
  }
  const [{ maxAt }] = (await db.execute<{ maxAt: string }>(sql`SELECT max(detected_at)::text AS "maxAt" FROM satellite_hotspots`)).rows;
  const months = Array.from(new Set(cases.map((c) => c.month))).sort();
  const report = {
    generatedAt: new Date().toISOString(), engine: "regras 1.1.0 (paridade Python/TypeScript)",
    design: { from: FROM, to: TO, stepDays: STEP, hourUtc: HOUR, sampleMunicipalities: pts.length, seed: SEED, outcomeRadiusKm: RADIUS_KM, outcomeWindowDays: WINDOW_D,
      vegetation: "moderada para todos os casos (não observada)", hotspotsUntil: maxAt, skippedForMissingWeather: skippedWeather },
    sources: ["INPE Queimadas (arquivos diários e mensais, todos os satélites)", "Open-Meteo (modelo, horário, past_days=92)", "Sisfogo/Ibama (ROIs)", "IBGE (malhas municipais v3)"],
    overall: summary(cases),
    byMonth: months.map((m) => ({ month: m, ...summary(cases.filter((c) => c.month === m)) })),
    limits: [
      "Rótulo = foco de calor do INPE (detecção térmica, inclui queimadas controladas e falsos positivos), não incêndio confirmado.",
      "Vegetação não observada: todos os casos usam 'moderada'.",
      "Meteorologia é de modelo em grade (Open-Meteo), não estação.",
      "Pontos = centro dos municípios, não propriedades; a amostra é aleatória e inclui municípios sem vegetação nativa.",
      "Período de uma única temporada (ago–nov 2026); não demonstra desempenho em outros anos.",
      "Casos do mesmo município em semanas seguidas não são independentes.",
    ],
    durationS: Math.round((Date.now() - t0) / 1000),
    cases,
  };
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  const { cases: _c, ...head } = report;
  console.log(JSON.stringify(head, null, 2));
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exitCode = 1; }).finally(() => pool?.end());
