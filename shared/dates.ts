/**
 * Normalises an occurrence date to ISO "YYYY-MM-DD".
 * Accepts "YYYY-MM-DD" and "DD/MM/YYYY". Returns null for impossible dates
 * (e.g. 31/02/2025) or other formats — callers must report, never guess.
 */
export function normalizeOccurrenceDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || dt.getTime() > Date.now() + 86_400_000) return null; // no future occurrences
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
