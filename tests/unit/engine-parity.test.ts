/**
 * Parity between the two rule engines: python_service/risk_model.py (main)
 * and shared/risk-engine.ts (fallback when the Python service is down).
 * For the same input both must give the SAME score (tolerance 0 — the weights
 * are integers), the same level, and factor contributions that add up to the
 * score before clamping. Inputs: band edges (incl. fractional values that
 * Open-Meteo returns) plus a seeded random sample. Controlled inputs, not data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { calculateRisk, type RiskInput } from "../../shared/risk-engine";

const VEG = ["very_dry", "dry", "moderate", "humid"] as const;
const QUAL = ["poor", "regular", "good", "excellent"] as const;
const PY = process.env.PYTHON ?? "python3";
const PY_DIR = path.resolve(import.meta.dirname, "../../python_service");

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 2 ** 32; return seed / 2 ** 32; }; }

function inputs(): RiskInput[] {
  const out: RiskInput[] = [];
  const edges = { t: [24.9, 25, 29.9, 30, 34.9, 35, 39.9, 40, 41], h: [19.9, 20, 29.9, 30, 49.9, 50, 64.9, 65, 80], w: [15, 15.4, 16, 25, 25.5, 26, 40, 40.1], r: [0, 2, 2.5, 3, 10, 10.5, 11, 30, 30.1], d: [0, 5, 5.1, 15, 15.2, 30, 30.5, 50, 50.1, 80], ho: [0, 1, 2, 3, 4, 5, 9] };
  for (const t of edges.t) for (const h of edges.h) out.push(base({ temperature: t, humidity: h }));
  for (const w of edges.w) for (const r of edges.r) out.push(base({ windSpeed: w, recentRainfall: r }));
  for (const d of edges.d) for (const ho of edges.ho) for (const v of [0, 1, 2, 3] as const) out.push(base({ nearbyHotspot: true, hotspotDistance: d, historicalOccurrences: ho, vegetationCondition: v }));
  const r = rng(20261118);
  for (let i = 0; i < 3000; i++) {
    const near = r() < 0.5;
    out.push({
      temperature: Math.round((5 + r() * 40) * 10) / 10, humidity: Math.round(r() * 1000) / 10, windSpeed: Math.round(r() * 600) / 10,
      recentRainfall: Math.round(r() * 500) / 10, vegetationCondition: Math.floor(r() * 4) as 0 | 1 | 2 | 3,
      nearbyHotspot: near, hotspotDistance: near ? Math.round(r() * 800) / 10 : 0,
      historicalOccurrences: Math.floor(r() * 8), dataQuality: Math.floor(r() * 4) as 0 | 1 | 2 | 3,
    });
  }
  return out;
}
function base(p: Partial<RiskInput>): RiskInput {
  return { temperature: 28, humidity: 55, windSpeed: 10, recentRainfall: 0, vegetationCondition: 2, nearbyHotspot: false, hotspotDistance: 0, historicalOccurrences: 0, dataQuality: 2, ...p };
}

const PY_SCRIPT = `
import json, sys
from schemas import RiskInput
from risk_model import calculate_rule_score, classify_risk, explain_factors
out = []
for line in sys.stdin:
    d = RiskInput(**json.loads(line))
    s = calculate_rule_score(d)
    out.append({"score": s, "level": classify_risk(s), "sum": sum(f.contribution for f in explain_factors(d))})
print(json.dumps(out))
`;

test("Python and TypeScript rule engines agree on score, level and factor sum", () => {
  const all = inputs();
  const lines = all.map((i) => JSON.stringify({
    temperature: i.temperature, humidity: i.humidity, wind_speed: i.windSpeed, recent_rainfall: i.recentRainfall,
    vegetation_condition: VEG[i.vegetationCondition], nearby_hotspot: i.nearbyHotspot,
    hotspot_distance: i.nearbyHotspot ? i.hotspotDistance : null, historical_occurrences: i.historicalOccurrences, data_quality: QUAL[i.dataQuality],
  })).join("\n");
  const p = spawnSync(PY, ["-c", PY_SCRIPT], { cwd: PY_DIR, input: lines, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(p.status, 0, p.stderr);
  const py = JSON.parse(p.stdout) as { score: number; level: string; sum: number }[];
  assert.equal(py.length, all.length);
  const diffs: string[] = [];
  all.forEach((inp, k) => {
    const ts = calculateRisk(inp);
    const tsSum = ts.factors.reduce((s, f) => s + f.contribution, 0);
    const lvl = ts.level.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (ts.score !== py[k].score || lvl !== py[k].level) diffs.push(`#${k} ${JSON.stringify(inp)} → ts ${ts.score}/${lvl} × py ${py[k].score}/${py[k].level}`);
    if (Math.max(0, Math.min(100, tsSum)) !== ts.score) diffs.push(`#${k} TS fatores somam ${tsSum}, score ${ts.score}`);
    if (Math.max(0, Math.min(100, py[k].sum)) !== py[k].score) diffs.push(`#${k} PY fatores somam ${py[k].sum}, score ${py[k].score}`);
  });
  assert.equal(diffs.length, 0, `${diffs.length} divergências em ${all.length} entradas:\n${diffs.slice(0, 15).join("\n")}`);
  console.log(`# paridade verificada em ${all.length} entradas`);
});
