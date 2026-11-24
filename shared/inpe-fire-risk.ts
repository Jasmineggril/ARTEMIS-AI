/**
 * INPE fire risk model ("Risco de Fogo", Programa Queimadas), version 2.2 —
 * pure implementation of the per-point computation.
 *
 * Source of every constant below: INPE's own operational script, published at
 *   https://dataserver-coids.inpe.br/queimadas/queimadas/outros/rf/script/rf_previsto_1-5dias_2023.sh
 * (NCL code, author line in the products: Alberto Setzer / Guilherme Martins),
 * and the process document QMD003-2000-PRO-001-A ("Processo de Geração
 * operacional dos dados de Risco de Fogo (observado)", INPE, 2024–2025).
 *
 *   1. Precipitation factors over 11 windows of the previous 120 days
 *      (day 1 = most recent): fp = exp(c · P_window)
 *        windows 1,2,3,4,5, 6–10, 11–15, 16–30, 31–60, 61–90, 91–120 days
 *        c       −0.14, −0.07, −0.04, −0.03, −0.02, −0.01, −0.008, −0.004, −0.002, −0.001, −0.0007
 *   2. "Dias de secura": PSE = 105 · Π fp
 *   3. Basic risk by vegetation class k = 1…7 (INPE reclassification of MapBiomas/IGBP):
 *        A      = 6, 4, 3, 2.4, 2, 1.72, 1.5
 *        PSEmax = 30, 45, 60, 75, 90, 105, 120
 *        RB = 0.9                                   if PSE > PSEmax(k)
 *        RB = 0.9 · (1 + sin((A(k)·PSE − 90)·π/180)) / 2   otherwise   (π taken as 3.1416, as in the script)
 *   4. Humidity factor  FU = −0.008 · UR + 1.3     (coefficient changed from −0.006 on 11/04/2019)
 *      Temperature factor FT = 0.02 · T + 0.4      (T in °C)
 *      UR and T are the 2 m values at 18 UTC (GFS) — described by INPE as "umidade relativa
 *      mínima" and "temperatura máxima" (Anuário Risco de Fogo 2025, section 2.2).
 *   Vegetation classes (Anuário 2025, Tabela 2.1): 1 pastagens e gramíneas · 2 agricultura e diversos ·
 *      3 savana, caatinga aberta · 4 savana arbórea, caatinga fechada · 5 floresta de contato, campinarana ·
 *      6 florestas decíduas e sazonais · 7 ombrófila densa.
 *   5. RF = min(1, RB · FT · FU)
 *   6. Version 2.2 (Setzer, 05/04/2019): latitude and elevation factors
 *        FLAT = 1 + 0.003 · |lat|       FTOP = 1 + 0.00003 · elevation(m)
 *        RF22 = min(1, RF · FLAT · FTOP)
 *
 * The unit of UR in step 4 is NOT settled by the script alone (it divides the
 * GFS field by 100 before applying FU). It is a parameter here and is decided
 * empirically by reproducing INPE's published grid (scripts/inpe-rf-replication.ts,
 * docs/artemis/26_INPE_RISCO_FOGO.md).
 *
 * This is an index of meteorological SUSCEPTIBILITY of the vegetation to burn,
 * not a detection of fire and not a calibrated probability of occurrence.
 */
export const INPE_RF_VERSION = "2.2";
export const PRECIP_WINDOWS: readonly { from: number; to: number; c: number }[] = [
  { from: 1, to: 1, c: -0.14 }, { from: 2, to: 2, c: -0.07 }, { from: 3, to: 3, c: -0.04 }, { from: 4, to: 4, c: -0.03 },
  { from: 5, to: 5, c: -0.02 }, { from: 6, to: 10, c: -0.01 }, { from: 11, to: 15, c: -0.008 }, { from: 16, to: 30, c: -0.004 },
  { from: 31, to: 60, c: -0.002 }, { from: 61, to: 90, c: -0.001 }, { from: 91, to: 120, c: -0.0007 },
];
export const VEG_A = [6, 4, 3, 2.4, 2, 1.72, 1.5] as const;           // classes 1..7
export const VEG_PSE_MAX = [30, 45, 60, 75, 90, 105, 120] as const;
const PI_SCRIPT = 3.1416;

/** daily precipitation (mm/day), index 0 = most recent day; needs 120 values. */
export function pse(dailyMostRecentFirst: ArrayLike<number>): number {
  if (dailyMostRecentFirst.length < 120) throw new Error("PSE exige 120 dias de precipitação.");
  let prod = 1;
  for (const w of PRECIP_WINDOWS) {
    let s = 0;
    for (let d = w.from; d <= w.to; d++) s += dailyMostRecentFirst[d - 1];
    prod *= Math.exp(w.c * s);
  }
  return 105 * prod;
}

export function basicRisk(pseValue: number, vegClass: number): number | null {
  if (!Number.isInteger(vegClass) || vegClass < 1 || vegClass > 7) return null; // water / no data: not computed
  if (pseValue > VEG_PSE_MAX[vegClass - 1]) return 0.9;
  return (0.9 * (1 + Math.sin((VEG_A[vegClass - 1] * pseValue - 90) * (PI_SCRIPT / 180)))) / 2;
}

export const humidityFactor = (rh: number, slope = -0.006) => slope * rh + 1.3;
export const temperatureFactor = (tC: number) => 0.02 * tC + 0.4;
export const latitudeFactor = (lat: number) => 1 + Math.abs(lat) * 0.003;
export const elevationFactor = (elevM: number) => 1 + elevM * 0.00003;

export interface RfInputs { pse: number; vegClass: number; temperatureC: number; rh: number; lat: number; elevationM: number }
export interface RfResult { rf: number | null; rfBeforeV22: number | null; rb: number | null; fu: number; ft: number; flat: number; ftop: number }

export interface RfOptions {
  /** how UR enters FU: "percent" (UR in %) or "fraction" (UR/100, as the published script does) */
  rhUnit?: "percent" | "fraction";
  /**
   * FU slope. The published forecast script says −0.008 since 11/04/2019 (−0.006 before), but
   * reproducing INPE's OBSERVED grid from INPE's own inputs fits −0.006 with UR in % best among the
   * published variants (92.7 % same class vs 87.2 % for −0.008; docs/artemis/26_INPE_RISCO_FOGO.md).
   * Default: −0.006. Not tuned beyond published values.
   */
  fuSlope?: number;
  /** apply the version 2.2 latitude and elevation factors (default true) */
  applyV22?: boolean;
}
export function inpeFireRisk(i: RfInputs, opts: RfOptions | "percent" | "fraction" = {}): RfResult {
  const o: RfOptions = typeof opts === "string" ? { rhUnit: opts } : opts;
  const rb = basicRisk(i.pse, i.vegClass);
  const rh = (o.rhUnit ?? "percent") === "fraction" ? i.rh / 100 : i.rh;
  const fu = (o.fuSlope ?? -0.006) * rh + 1.3;
  const ft = temperatureFactor(i.temperatureC);
  const flat = latitudeFactor(i.lat), ftop = elevationFactor(Math.max(0, i.elevationM));
  if (rb === null) return { rf: null, rfBeforeV22: null, rb, fu, ft, flat, ftop };
  const rf = Math.min(1, rb * ft * fu);
  return { rf: o.applyV22 === false ? rf : Math.min(1, rf * flat * ftop), rfBeforeV22: rf, rb, fu, ft, flat, ftop };
}

/**
 * Official categories — INPE, "Anuário Risco de Fogo 2025", Tabela 3.1:
 *   Mínimo RF ≤ 0,15 · Baixo 0,15 < RF ≤ 0,40 · Médio 0,40 < RF ≤ 0,70 · Alto 0,70 < RF ≤ 0,95 · Crítico RF > 0,95
 * The OBSERVED product is additionally corrected by fire detections of the last
 * 3 days (same document, section 3); that step is not reproduced here.
 */
export type RfClass = "minimo" | "baixo" | "medio" | "alto" | "critico";
export const RF_CLASS_LIMITS = { minimo: 0.15, baixo: 0.4, medio: 0.7, alto: 0.95 } as const;
export function rfClass(v: number): RfClass {
  if (v <= RF_CLASS_LIMITS.minimo) return "minimo";
  if (v <= RF_CLASS_LIMITS.baixo) return "baixo";
  if (v <= RF_CLASS_LIMITS.medio) return "medio";
  if (v <= RF_CLASS_LIMITS.alto) return "alto";
  return "critico";
}
export const RF_CLASS_LABEL: Record<RfClass, string> = { minimo: "Mínimo", baixo: "Baixo", medio: "Médio", alto: "Alto", critico: "Crítico" };
