/**
 * Sisfogo fixtures built from REAL ROIs (tests/fixtures/sisfogo-roi-real.json,
 * captured read-only from the public API on 16/11/2026; place names replaced).
 * `roi(n, patch)` clones the first real record with a new UUID so tests can make
 * as many records as they need without inventing a different shape.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const real = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "sisfogo-roi-real.json"), "utf8")).itens as any[];
export const REAL_ROIS: any[] = real;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Deep-merge `patch` into a copy of `base` (objects merge, everything else replaces). */
function merge(base: any, patch: any): any {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base?.[k] && typeof base[k] === "object" ? merge(base[k], v) : v;
  }
  return out;
}

export function roi(n: number, patch: Record<string, unknown> = {}) {
  const base = clone(real[0]);
  base.id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  base.numeroRoi = `ROI.TESTE.${n}`;
  return merge(base, patch);
}

export function page(items: unknown[], pagina: number, totalPaginas: number, totalItens = items.length * totalPaginas) {
  return { pagina, tamanhoPagina: items.length, totalItens, totalPaginas, itens: items };
}

/** fetchJson stub serving the given pages (1-based); past the end returns an empty page, like the real API. */
export function servePages(pages: unknown[][], opts: { totalItens?: number } = {}) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const n = Number(new URL(url).searchParams.get("page"));
    const items = pages[n - 1] ?? [];
    return { status: 200, retryAfter: null, json: page(items, n, pages.length, opts.totalItens ?? pages.flat().length) };
  };
  return Object.assign(fn, { calls });
}
