/**
 * Haines Index (Lower Atmosphere Severity Index) — Haines, D. A. (1988), "A lower atmosphere
 * severity index for wildlife fires", National Weather Digest 13: 23–27; used in Brazil e.g. by
 * Melo, Justino, Melo & Silva (2012), Mercator 11(24): 187–207, DOI 10.4215/RM2012.1124.0012.
 *
 *   HI = A (stability term) + B (moisture term), each 1–3 → HI 2–6
 *   variant  levels (hPa)             A = ΔT                     B = T − Td
 *   low      950 / 850                T950 − T850:  <4→1, 4–7→2, ≥8→3     T850 − Td850: <6→1, 6–9→2,  ≥10→3
 *   mid      850 / 700                T850 − T700:  <6→1, 6–10→2, ≥11→3   T850 − Td850: <6→1, 6–12→2, ≥13→3
 *   high     700 / 500                T700 − T500:  <18→1, 18–21→2, ≥22→3 T700 − Td700: <15→1, 15–20→2, ≥21→3
 *   classes: 2–3 muito baixo · 4 baixo · 5 moderado · 6 alto (potential for LARGE/erratic fire growth)
 *
 * Variant: the lowest one whose bottom level is above the ground (standard-atmosphere pressure of
 * the site's elevation): low if surface > 950 hPa (≈ < 540 m), mid if > 850 hPa (≈ < 1 460 m), else high.
 * REQUIRES temperatures and dew points AT PRESSURE LEVELS; never computed from surface values.
 * It describes how an existing fire may behave (stability + dryness aloft), not ignition risk.
 */
export type HainesVariant = "baixa" | "media" | "alta";
export type HainesClass = "muito_baixo" | "baixo" | "moderado" | "alto";
export interface PressureLevels { t950?: number | null; t850?: number | null; td850?: number | null; t700?: number | null; td700?: number | null; t500?: number | null }

export const standardPressureHpa = (elevationM: number) => 1013.25 * Math.pow(1 - 2.25577e-5 * Math.max(0, elevationM), 5.25588);
export function hainesVariant(elevationM: number): HainesVariant {
  const p = standardPressureHpa(elevationM);
  return p > 950 ? "baixa" : p > 850 ? "media" : "alta";
}
const step = (x: number, a: number, b: number) => (x < a ? 1 : x < b ? 2 : 3);

export function haines(levels: PressureLevels, variant: HainesVariant) {
  const L = levels, need = (...v: (number | null | undefined)[]) => v.every((x) => x != null && Number.isFinite(x));
  let A: number, B: number, dT: number, dD: number;
  if (variant === "baixa") {
    if (!need(L.t950, L.t850, L.td850)) return null;
    dT = L.t950! - L.t850!; dD = L.t850! - L.td850!; A = step(dT, 4, 8); B = step(dD, 6, 10);
  } else if (variant === "media") {
    if (!need(L.t850, L.t700, L.td850)) return null;
    dT = L.t850! - L.t700!; dD = L.t850! - L.td850!; A = step(dT, 6, 11); B = step(dD, 6, 13);
  } else {
    if (!need(L.t700, L.t500, L.td700)) return null;
    dT = L.t700! - L.t500!; dD = L.t700! - L.td700!; A = step(dT, 18, 22); B = step(dD, 15, 21);
  }
  const hi = A + B;
  const cls: HainesClass = hi <= 3 ? "muito_baixo" : hi === 4 ? "baixo" : hi === 5 ? "moderado" : "alto";
  return { hi, A, B, stabilityDeltaC: Math.round(dT * 10) / 10, dewpointDepressionC: Math.round(dD * 10) / 10, cls, variant };
}
export const HAINES_LABEL: Record<HainesClass, string> = { muito_baixo: "Muito baixo", baixo: "Baixo", moderado: "Moderado", alto: "Alto" };
