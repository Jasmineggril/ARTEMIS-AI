/**
 * Retrospective evaluation: does INPE's OFFICIAL fire-risk index, the ARTEMIS rule engine,
 * or a calibrated combination of both anticipate INPE hotspots in the following 7 days?
 *
 *   npx tsx scripts/evaluate-official-rf.ts --cases docs/artemis/evidencias/2026-11-18/backtest-motor.json --out evid.json
 *
 * Cases: exactly those of the earlier backtest (400 IBGE municipalities × 12 weekly dates, D at
 * 15:00 UTC; outcome = ≥ 1 INPE detection within 10 km in (D, D+7]; ARTEMIS score known at D).
 * New input: the official RF of day D−1 (the latest observed product INPE has published by D),
 * read from INPE's file at the municipality point (pixel; nearest valid pixel within 5 km over
 * urban areas/water). Nothing after D enters any input → no leakage.
 *
 * Model ("IA" experimental): logistic regression on [RF, ARTEMIS score, persistence], trained
 * ONLY on the training part of each split and evaluated on the held-out part:
 *   temporal     train = first 8 dates, test = last 4 dates;
 *   geographic   train/test = states split by a fixed seed (no state in both);
 *   both         train = early dates ∩ train states, test = late dates ∩ test states (strictest).
 * Reported: AUC, Brier, reliability/ECE, precision/recall/F1 at operational thresholds, results
 * by region, biome and month, the RF × ARTEMIS divergence table and standardised coefficients.
 * Hotspots are thermal detections, not confirmed fires: the outcome is "detection nearby".
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { observedUrl, openObservedNc, sampleTargets, defaultFetchBin, fetchWithRetry, RF_RETRY, sha256 } from "../server/connectors/inpe-fire-risk";
import { rfClass, RF_CLASS_LIMITS } from "../shared/inpe-fire-risk";
import { auc, brier, reliability, confusion, fitLogistic } from "../shared/eval-metrics";

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const CASES = arg("cases", "docs/artemis/evidencias/2026-11-18/backtest-motor.json")!, OUT = arg("out"), SEED = Number(arg("seed", "11"));
const REGION: Record<string, string> = Object.fromEntries([
  ...["AC", "AM", "AP", "PA", "RO", "RR", "TO"].map((s) => [s, "Norte"]), ...["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"].map((s) => [s, "Nordeste"]),
  ...["DF", "GO", "MS", "MT"].map((s) => [s, "Centro-Oeste"]), ...["ES", "MG", "RJ", "SP"].map((s) => [s, "Sudeste"]), ...["PR", "RS", "SC"].map((s) => [s, "Sul"]),
]);
const LEVEL_RANK: Record<string, number> = { baixo: 0, moderado: 1, alto: 2, "crítico": 3 };
const shift = (d: string, k: number) => new Date(Date.parse(d + "T00:00:00Z") + k * 86_400_000).toISOString().slice(0, 10);
const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);

interface C { code: string; state: string; date: string; month: string; score: number; level: string; event: boolean; persistence: boolean; hotspotKm: number | null }
interface E extends C { rf: number | null; rfMethod: string; region: string; biome: string }

async function main() {
  const t0 = Date.now();
  const src = JSON.parse(readFileSync(CASES, "utf8"));
  const cases: C[] = src.cases;
  const codes = [...new Set(cases.map((c) => c.code))], dates = [...new Set(cases.map((c) => c.date))].sort();
  // same point as the backtest: ST_PointOnSurface of the official IBGE boundary
  const pts = new Map((await db.execute<{ code: string; lat: number; lng: number }>(sql`
    SELECT ibge_code AS code, ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng FROM municipality_boundaries
    WHERE ibge_code IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`)).rows.map((r) => [r.code, r]));
  // biome of the municipality: the most frequent biome INPE assigns to its detections (Aug–Nov); "sem focos" otherwise
  const biome = new Map((await db.execute<{ code: string; biome: string }>(sql`
    SELECT DISTINCT ON (municipality_ibge_code) municipality_ibge_code AS code, biome FROM satellite_hotspots
    WHERE municipality_ibge_code IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)}) AND biome IS NOT NULL
    GROUP BY municipality_ibge_code, biome ORDER BY municipality_ibge_code, count(*) DESC`)).rows.map((r) => [r.code.trim(), r.biome]));

  const rfByKey = new Map<string, { v: number | null; method: string }>(); const files: { day: string; url: string; sha256: string; bytes: number }[] = [];
  for (const d of dates) {
    const day = shift(d, -1), url = observedUrl(day);
    const res = await fetchWithRetry(defaultFetchBin, url, RF_RETRY);
    if (res.status !== 200) { console.log(`RF ${day}: HTTP ${res.status} — casos desta data ficam sem RF`); continue; }
    files.push({ day, url, sha256: sha256(res.body), bytes: res.body.length });
    const r = await openObservedNc(res.body);
    try {
      if (r.validDay !== day) throw new Error(`arquivo traz ${r.validDay}, esperado ${day}`);
      const samples = await sampleTargets(r, codes.map((c, i) => ({ type: "station" as const, id: i, lat: pts.get(c)?.lat, lng: pts.get(c)?.lng })));
      for (const s of samples) rfByKey.set(`${codes[s.id]}|${d}`, { v: s.mean, method: s.method.split(" ")[0] });
      console.log(`RF ${day}: ${samples.filter((s) => s.mean != null).length}/${codes.length} pontos com valor`);
    } finally { r.close(); }
  }

  const all: E[] = cases.map((c) => { const x = rfByKey.get(`${c.code}|${c.date}`); return { ...c, rf: x?.v ?? null, rfMethod: x?.method ?? "sem_arquivo", region: REGION[c.state] ?? "?", biome: biome.get(c.code) ?? "sem focos no período" }; });
  const ev = all.filter((c) => c.rf != null); // same subset for every predictor (fair comparison)
  const y = (s: E[]) => s.map((c) => c.event);
  const predictors = {
    rf_oficial: (c: E) => c.rf!, artemis: (c: E) => c.score, persistencia: (c: E) => (c.persistence ? 1 : 0),
  };
  const decisions = {
    "RF oficial alto ou crítico (> 0,70)": (c: E) => c.rf! > RF_CLASS_LIMITS.medio,
    "RF oficial crítico (> 0,95)": (c: E) => c.rf! > RF_CLASS_LIMITS.alto,
    "ARTEMIS moderado ou mais": (c: E) => (LEVEL_RANK[c.level] ?? 0) >= 1,
    "ARTEMIS alto ou mais": (c: E) => (LEVEL_RANK[c.level] ?? 0) >= 2,
    "Persistência (foco ≤ 10 km nas 24 h anteriores)": (c: E) => c.persistence,
    "RF > 0,70 E ARTEMIS moderado ou mais": (c: E) => c.rf! > 0.7 && (LEVEL_RANK[c.level] ?? 0) >= 1,
  };
  const describe = (s: E[]) => s.length < 30 || !s.some((c) => c.event) || s.every((c) => c.event) ? { n: s.length, eventRate: s.length ? r3(s.filter((c) => c.event).length / s.length) : null, note: "amostra pequena ou de uma só classe" } : {
    n: s.length, eventRate: r3(s.filter((c) => c.event).length / s.length),
    auc: Object.fromEntries(Object.entries(predictors).map(([k, f]) => [k, r3(auc(s.map(f), y(s)))])),
    decisions: Object.fromEntries(Object.entries(decisions).map(([k, f]) => [k, confusion(s.map(f), y(s))])),
  };
  const by = (k: keyof E) => Object.fromEntries([...new Set(ev.map((c) => String(c[k])))].sort().map((v) => [v, describe(ev.filter((c) => String(c[k]) === v))]));

  // splits
  const lateDates = new Set(dates.slice(-4));
  let s = SEED; const rnd = () => { s = (s * 1664525 + 1013904223) % 2 ** 32; return s / 2 ** 32; };
  const states = [...new Set(ev.map((c) => c.state))].sort(); const testStates = new Set(states.map((st) => ({ st, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, Math.round(states.length / 3)).map((x) => x.st));
  const splits: Record<string, { train: E[]; test: E[]; definition: string }> = {
    temporal: { train: ev.filter((c) => !lateDates.has(c.date)), test: ev.filter((c) => lateDates.has(c.date)), definition: `treino ${dates[0]}…${dates[7]}; teste ${dates[8]}…${dates[11]}` },
    geografica: { train: ev.filter((c) => !testStates.has(c.state)), test: ev.filter((c) => testStates.has(c.state)), definition: `teste = UFs ${[...testStates].join(", ")}; treino = demais UFs` },
    temporal_e_geografica: { train: ev.filter((c) => !lateDates.has(c.date) && !testStates.has(c.state)), test: ev.filter((c) => lateDates.has(c.date) && testStates.has(c.state)), definition: "treino = datas iniciais nas UFs de treino; teste = datas finais nas UFs de teste" },
  };
  const feats = { rf: (c: E) => [c.rf!], artemis: (c: E) => [c.score], combinado: (c: E) => [c.rf!, c.score, c.persistence ? 1 : 0] };
  const splitResults = Object.fromEntries(Object.entries(splits).map(([name, sp]) => {
    const base = sp.train.filter((c) => c.event).length / sp.train.length, yt = y(sp.test);
    const models = Object.fromEntries(Object.entries(feats).map(([fname, f]) => {
      const m = fitLogistic(sp.train.map(f), y(sp.train)); const p = sp.test.map((c) => m.predict(f(c)));
      return [fname, { auc: r3(auc(p, yt)), brier: r3(brier(p, yt)), reliability: reliability(p, yt),
        coefStandardized: m.coefStandardized.map(r3), features: fname === "combinado" ? ["rf_oficial", "pontuacao_artemis", "persistencia"] : [fname] }];
    }));
    return [name, { definition: sp.definition, nTrain: sp.train.length, nTest: sp.test.length, eventRateTrain: r3(base), eventRateTest: r3(yt.filter(Boolean).length / yt.length),
      brierReferencePrevalence: r3(brier(sp.test.map(() => base), yt)), models }];
  }));

  // divergence RF class × ARTEMIS level
  const classes = ["minimo", "baixo", "medio", "alto", "critico"], levels = ["baixo", "moderado", "alto", "crítico"];
  const divergence = classes.map((k) => ({ rfClass: k, ...Object.fromEntries(levels.map((l) => {
    const cell = ev.filter((c) => rfClass(c.rf!) === k && c.level === l);
    return [l, { n: cell.length, eventRate: cell.length ? r3(cell.filter((c) => c.event).length / cell.length) : null }];
  })) }));

  const out = {
    generatedAt: new Date().toISOString(), durationS: Math.round((Date.now() - t0) / 1000),
    nature: "Avaliação retrospectiva com dados públicos reais. Não é validação em campo; o desfecho é detecção de foco de calor (satélite), não incêndio confirmado.",
    design: { casesFrom: CASES, dates, rfDayUsed: "D − 1 (último observado publicado pelo INPE antes de D às 15 UTC)", outcome: "≥ 1 foco INPE a até 10 km em (D, D+7]",
      model: "regressão logística (IRLS, L2 = 0,001) treinada só no treino de cada separação; variáveis padronizadas com média/desvio do treino", seed: SEED },
    rfFiles: files,
    coverage: { cases: all.length, withRf: ev.length, withoutRf: all.length - ev.length, rfMethods: Object.fromEntries([...new Set(all.map((c) => c.rfMethod))].map((m) => [m, all.filter((c) => c.rfMethod === m).length])) },
    overall: describe(ev), splits: splitResults, byRegion: by("region"), byBiome: by("biome"), byMonth: by("month"), divergence,
    limits: [
      "Desfecho = foco de calor (detecção térmica), não incêndio confirmado; focos subestimam fogo sob nuvens e superestimam fontes de calor não-incêndio.",
      "12 datas semanais de uma única estação seca (ago–nov/2026); não cobre a estação chuvosa nem anos diferentes.",
      "RF oficial lido no ponto do município (pixel de 1 km), não na propriedade; a pontuação ARTEMIS é a do backtest de 18/11 (vegetação não observada).",
      "Separação geográfica por UF: municípios vizinhos de UFs diferentes podem ter focos correlacionados.",
      "O modelo combinado é experimental e não está em uso na plataforma.",
    ],
    cases: ev.map(({ code, state, date, score, level, rf, rfMethod, persistence, event, biome: b }) => ({ code, state, date, score, level, rf: r3(rf), rfMethod, persistence, event, biome: b })),
  };
  if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
  const { cases: _c, ...summary } = out; console.log(JSON.stringify({ coverage: summary.coverage, overall: summary.overall, splits: Object.fromEntries(Object.entries(summary.splits).map(([k, v]: any) => [k, { n: v.nTest, ref: v.brierReferencePrevalence, ...Object.fromEntries(Object.entries(v.models).map(([m, r]: any) => [m, `auc ${r.auc} brier ${r.brier} ece ${r.reliability.ece}`])) }])) }, null, 1));
  await pool?.end();
}
main().catch(async (e) => { console.error(e); await pool?.end(); process.exit(1); });
