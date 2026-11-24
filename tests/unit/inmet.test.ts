/**
 * INMET connector and FMA index — unit tests.
 * Fixtures: tests/fixtures/inmet_A001_amostra.csv is an UNMODIFIED excerpt of
 * INMET's official 2026 file for station A001 (Brasília), 15–16/09/2026;
 * inmet_estacoes_amostra.json is an excerpt of the real station list.
 * The other inputs are CONTROLLED cases with known expected answers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseInmetCsv, parseStationList, utcOffsetForState, fetchBinWithRetry } from "../../server/connectors/inmet";
import { computeFma, fmaClass, fmaRainFactor } from "../../shared/fire-indices";
import { representativeness, describe } from "../../server/services/inmet-stations";

const REAL = readFileSync(new URL("../fixtures/inmet_A001_amostra.csv", import.meta.url)).toString("latin1");
const [HEAD9, BODY] = [REAL.split(/\r?\n/).slice(0, 9).join("\n"), REAL.split(/\r?\n/).slice(9).filter(Boolean)];
const row = (date: string, hour: string, vals: Partial<Record<"rain" | "temp" | "dew" | "rh" | "wind" | "gust" | "tmax" | "tmin", string>>) => {
  // column order of the real 2026 header
  const c = [date, hour, vals.rain ?? "0", "886,6", "886,6", "885,8", "", vals.temp ?? "25,2", vals.dew ?? "10,1", vals.tmax ?? "26,4", vals.tmin ?? "24,6", "11,3", "9,6", "43", "35", vals.rh ?? "38", "4", vals.gust ?? "3,6", vals.wind ?? "1,4", ""];
  return c.join(";");
};

test("inmet: parses the REAL file — header, UTC hours, decimal comma, units kept", () => {
  const p = parseInmetCsv(REAL, { year: 2026, now: new Date("2026-11-18T00:00:00Z") });
  assert.deepEqual(p.header, { region: "CO", state: "DF", name: "BRASILIA", code: "A001", latitude: -15.78944444, longitude: -47.92583332, altitudeM: 1160.96 });
  assert.equal(p.read, 30); assert.equal(p.rows.length, 30);
  const first = p.rows[0];
  assert.equal(first.observedAt.toISOString(), "2026-09-15T00:00:00.000Z");
  assert.deepEqual([first.temperatureC, first.dewPointC, first.humidityPct, first.windSpeedMs, first.windGustMs, first.windDirectionDeg, first.precipitationMm, first.pressureHpa],
    [25.2, 10.1, 38, 1.4, 3.6, 4, 0, 886.6]);
  assert.equal(first.radiationKjM2, null, "empty radiation at night → null");
  assert.equal(first.line, 10, "line number in the raw file is kept");
});

test("inmet: missing values (-9999, empty), extremes and inconsistencies → null + flags; rows without any measure are dropped", () => {
  const now = new Date("2026-11-18T00:00:00Z");
  const csv = [HEAD9,
    row("2026/09/15", "0000 UTC", {}),
    row("2026/09/15", "0100 UTC", { temp: "-9999", rh: "", wind: "-9999", rain: "-9999", dew: "-9999" }),     // only pressure left
    row("2026/09/15", "0200 UTC", { temp: "61,0" }),                                                            // > 50 °C
    row("2026/09/15", "0300 UTC", { rh: "0" }),                                                                 // RH 0 = sensor failure
    row("2026/09/15", "0400 UTC", { rain: "180" }),                                                             // > 150 mm/h
    row("2026/09/15", "0500 UTC", { dew: "30", temp: "25" }),                                                   // dew point above temperature
    row("2026/09/15", "0600 UTC", { gust: "0,5", wind: "3" }),                                                  // gust below mean
    row("2026/09/15", "0700 UTC", { temp: "40" }),                                                              // +15 °C in one hour (prev valid 25)
  ].join("\n").replace(/^(.*;0100 UTC;)-9999;886,6/m, "$1-9999;886,6");
  const p = parseInmetCsv(csv, { year: 2026, now });
  const by = Object.fromEntries(p.rows.map((r) => [r.observedAt.getUTCHours(), r]));
  assert.equal(by[1].temperatureC, null); assert.equal(by[1].humidityPct, null); assert.equal(by[1].precipitationMm, null); assert.equal(by[1].pressureHpa, 886.6);
  assert.equal(by[2].temperatureC, null); assert.ok(by[2].qualityFlags.includes("temperatura_fora_da_faixa"));
  assert.equal(by[3].humidityPct, null); assert.ok(by[3].qualityFlags.includes("umidade_fora_da_faixa"));
  assert.equal(by[4].precipitationMm, null); assert.ok(by[4].qualityFlags.includes("precipitacao_fora_da_faixa"));
  assert.ok(by[5].qualityFlags.includes("orvalho_acima_da_temperatura"));
  assert.ok(by[6].qualityFlags.includes("rajada_menor_que_media"));
  assert.ok(by[7].qualityFlags.includes("salto_de_temperatura"));
  assert.equal(p.flagged["temperatura_fora_da_faixa"], 1);
  const empty = [HEAD9, row("2026/09/15", "0000 UTC", { temp: "", rh: "", wind: "", rain: "", dew: "" }).replace(";886,6;", ";-9999;")].join("\n");
  assert.deepEqual(parseInmetCsv(empty, { year: 2026, now }).rejected, { "hora sem nenhuma medida (lacuna da estação)": 1 });
});

test("inmet: duplicated hours, impossible/future times, wrong year and the pre-2019 time format", () => {
  const now = new Date("2026-09-15T12:00:00Z");
  const csv = [HEAD9,
    row("2026/09/15", "0000 UTC", {}), row("2026/09/15", "0000 UTC", { temp: "30" }),  // duplicate hour → first kept
    row("2026/09/15", "2530 UTC", {}), row("2026/13/01", "0000 UTC", {}),             // invalid
    row("2026/09/15", "0030 UTC", {}),                                                // not on the hour
    row("2026/09/16", "0000 UTC", {}),                                                // future (> now + 1 h)
    row("2025/12/31", "2300 UTC", {}),                                                // other year
    row("2026-09-15", "01:00", {}),                                                   // old format (until 2018)
  ].join("\n");
  const p = parseInmetCsv(csv, { year: 2026, now });
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].temperatureC, 25.2, "first occurrence of a repeated hour is kept");
  assert.equal(p.rows[1].observedAt.toISOString(), "2026-09-15T01:00:00.000Z");
  assert.deepEqual(p.rejected, { "hora repetida no arquivo": 1, "data/hora inválida": 3, "data/hora no futuro": 1, "fora do ano do arquivo": 1 });
});

test("inmet: malformed files are refused with a clear reason", () => {
  assert.throws(() => parseInmetCsv("REGIAO:;CO\nsem cabeçalho\n"), /Cabeçalho de colunas/);
  assert.throws(() => parseInmetCsv(HEAD9.replace("A001", "XX1") + "\n" + BODY[0]), /Código da estação inválido/);
  assert.throws(() => parseInmetCsv(HEAD9.replace("-15,78944444", "-55,0") + "\n" + BODY[0]), /coordenadas inválidas/);
  const noWind = HEAD9.replace("VENTO, VELOCIDADE HORARIA (m/s)", "OUTRA COISA");
  assert.throws(() => parseInmetCsv(noWind + "\n" + BODY[0]), /colunas ausentes: windSpeed/);
});

test("inmet: REAL station list parsed; invalid entries rejected; time zones by state", () => {
  const real = JSON.parse(readFileSync(new URL("../fixtures/inmet_estacoes_amostra.json", import.meta.url), "utf8"));
  const r = parseStationList([...real, { ...real[0] }, { CD_ESTACAO: "Z9", VL_LATITUDE: "1", VL_LONGITUDE: "1" }, { CD_ESTACAO: "A999", VL_LATITUDE: "40", VL_LONGITUDE: "-47" }]);
  assert.equal(r.stations.length, real.length);
  assert.deepEqual(r.rejected, { "estação repetida": 1, "código inválido": 1, "coordenadas fora do Brasil": 1 });
  const a001 = r.stations.find((s) => s.code === "A001")!;
  assert.equal(a001.state, "DF"); assert.ok(Math.abs(a001.latitude + 15.789) < 0.01);
  assert.throws(() => parseStationList({ erro: true }), /não é uma lista/);
  assert.deepEqual(["AC", "AM", "MT", "DF", "SP", null].map(utcOffsetForState), [-5, -4, -4, -3, -3, -3]);
});

test("inmet: download retries network errors and 5xx, not 404; gives up with the attempt count", async () => {
  const p = { timeoutMs: 1000, attempts: 3, baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} };
  let n = 0;
  const ok = await fetchBinWithRetry(async () => { n++; if (n === 1) throw new Error("ECONNRESET"); if (n === 2) return { status: 503, headers: {}, body: Buffer.alloc(0) }; return { status: 200, headers: {}, body: Buffer.from("PK") }; }, "u", p);
  assert.equal(ok.attempts, 3); assert.equal(ok.status, 200);
  n = 0; const nf = await fetchBinWithRetry(async () => { n++; return { status: 404, headers: {}, body: Buffer.alloc(0) }; }, "u", p);
  assert.equal(nf.status, 404); assert.equal(n, 1);
  await assert.rejects(fetchBinWithRetry(async () => { throw new Error("tempo esgotado"); }, "u", p), /tempo esgotado \(após 3 tentativas\)/);
});

test("FMA (Soares 1972): rain factors, classes, accumulation, reset by rain, gaps and missing data", () => {
  assert.deepEqual([0, 2.4, 2.5, 4.9, 5, 9.9, 10, 12.9, 13].map(fmaRainFactor), [1, 1, 0.7, 0.7, 0.4, 0.4, 0.2, 0.2, 0]);
  assert.deepEqual([0.5, 1.0, 1.1, 3.0, 3.1, 8.0, 8.1, 20.0, 20.1].map(fmaClass), ["nulo", "nulo", "pequeno", "pequeno", "medio", "medio", "alto", "alto", "muito_alto"]);
  const d = (day: string, h: number | null, mm: number | null, complete = true) => ({ day, humidity13hPct: h, precipitationMm: mm, precipitationComplete: complete });
  const r = computeFma([
    d("2026-09-01", 50, 20),   // > 12.9 mm → reset, FMA 0
    d("2026-09-02", 50, 0),    // 0 + 100/50 = 2
    d("2026-09-03", 25, 0),    // 2 + 4 = 6
    d("2026-09-04", 20, 3),    // 6 × 0.7 + 5 = 9.2
    d("2026-09-05", 40, 7),    // 9.2 × 0.4 + 2.5 = 6.18
    d("2026-09-06", 50, 11),   // 6.18 × 0.2 + 2 = 3.236 → 3.24
    d("2026-09-07", null, 0),  // no RH at 13 h → unknown
    d("2026-09-08", 50, 0),    // restarts: 2, flagged
    d("2026-09-10", 50, 0, false), // 09 missing (gap) and incomplete rain → unknown
  ]);
  assert.deepEqual(r.map((x) => x.fma), [0, 2, 6, 9.2, 6.18, 3.24, null, 2, null, null]);
  assert.deepEqual(r.map((x) => x.status), ["reiniciado_por_chuva", "ok", "ok", "ok", "ok", "ok", "sem_dados", "subestimado_apos_lacuna", "sem_dados", "sem_dados"]);
  assert.equal(r[3].class, "alto"); assert.equal(r[8].day, "2026-09-09", "missing calendar day inserted as gap");
  assert.equal(computeFma([d("2026-09-01", 50, 0)])[0].status, "subestimado_apos_lacuna", "series start without a reset is flagged");
});

test("representativeness thresholds and descriptive statistics", () => {
  assert.deepEqual([0, 25, 25.1, 50, 50.1, 100, 101].map(representativeness), ["proxima", "proxima", "intermediaria", "intermediaria", "distante", "distante", "nao_representativa"]);
  assert.deepEqual(describe([3, 1, null, 2, 4]), { n: 4, mean: 2.5, min: 1, max: 4, p10: 1.3, p50: 2.5, p90: 3.7, std: 1.29 });
  assert.equal(describe([null]).n, 0);
});
