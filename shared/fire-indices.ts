/**
 * Fórmula de Monte Alegre (FMA) — fire danger index (Soares, R. V., 1972,
 * "Índices de perigo de incêndio", Revista Floresta 3(3): 19–40). Cumulative:
 *
 *     FMA = Σ (100 / H_i)     H_i = relative humidity (%) at 13:00 LOCAL time on day i
 *
 * The sum runs over the days since the last significant rain; the day's
 * precipitation modifies the accumulated value BEFORE adding the day's term:
 *     ≤ 2,4 mm      no change
 *     2,5 – 4,9 mm  previous FMA × 0,7  (abate 30 %)
 *     5,0 – 9,9 mm  previous FMA × 0,4  (abate 60 %)
 *     10,0 – 12,9   previous FMA × 0,2  (abate 80 %)
 *     > 12,9 mm     accumulation interrupted: FMA = 0 that day, restarts the next day
 * Danger classes: ≤ 1,0 nulo · 1,1–3,0 pequeno · 3,1–8,0 médio · 8,1–20,0 alto · > 20,0 muito alto.
 *
 * Data requirements (enforced): RH observed at 13 h local and a complete daily
 * rain total. A day without them makes the value UNKNOWN; the accumulation then
 * restarts at the next complete day and is flagged as possibly underestimated
 * until the next reset by rain. The index is computed by the platform from
 * INMET observations; it was not calibrated by ARTEMIS for any region.
 */
export type FmaClass = "nulo" | "pequeno" | "medio" | "alto" | "muito_alto";
export interface FmaDayInput { day: string; humidity13hPct: number | null; precipitationMm: number | null; precipitationComplete: boolean }
export interface FmaDay { day: string; fma: number | null; class: FmaClass | null; status: "ok" | "reiniciado_por_chuva" | "sem_dados" | "subestimado_apos_lacuna"; rainFactor: number | null }

export const FMA_REFERENCE = "Soares (1972), Fórmula de Monte Alegre";

export function fmaRainFactor(mm: number): number {
  if (mm <= 2.4) return 1;
  if (mm <= 4.9) return 0.7;
  if (mm <= 9.9) return 0.4;
  if (mm <= 12.9) return 0.2;
  return 0;
}
export function fmaClass(v: number): FmaClass {
  if (v <= 1.0) return "nulo";
  if (v <= 3.0) return "pequeno";
  if (v <= 8.0) return "medio";
  if (v <= 20.0) return "alto";
  return "muito_alto";
}
export const FMA_CLASS_LABEL: Record<FmaClass, string> = { nulo: "Nulo", pequeno: "Pequeno", medio: "Médio", alto: "Alto", muito_alto: "Muito alto" };

/** Days must be consecutive and in order; a missing calendar day is treated as "sem dados". */
export function computeFma(days: FmaDayInput[]): FmaDay[] {
  const out: FmaDay[] = [];
  let acc: number | null = null;        // null = unknown
  let degraded = false;                 // restarted after a data gap, not after rain
  let prevDay: string | null = null;
  for (const d of days) {
    if (prevDay) {
      // insert missing calendar days as gaps
      for (let t = Date.parse(prevDay + "T00:00:00Z") + 86_400_000; t < Date.parse(d.day + "T00:00:00Z"); t += 86_400_000) {
        out.push({ day: new Date(t).toISOString().slice(0, 10), fma: null, class: null, status: "sem_dados", rainFactor: null });
        acc = null;
      }
    }
    prevDay = d.day;
    const ok = d.humidity13hPct != null && d.humidity13hPct > 0 && d.humidity13hPct <= 100 && d.precipitationMm != null && d.precipitationComplete;
    if (!ok) { out.push({ day: d.day, fma: null, class: null, status: "sem_dados", rainFactor: null }); acc = null; continue; }
    const f = fmaRainFactor(d.precipitationMm!);
    if (f === 0) { acc = 0; degraded = false; out.push({ day: d.day, fma: 0, class: "nulo", status: "reiniciado_por_chuva", rainFactor: 0 }); continue; }
    // starting without a known previous value (series start or after a gap): underestimated until the next reset by rain
    if (acc === null) { acc = 0; degraded = true; }
    acc = acc * f + 100 / d.humidity13hPct!;
    const v = Math.round(acc * 100) / 100;
    out.push({ day: d.day, fma: v, class: fmaClass(v), status: degraded ? "subestimado_apos_lacuna" : "ok", rainFactor: f });
  }
  return out;
}
