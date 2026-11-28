/**
 * Small, dependency-free evaluation statistics used by the retrospective evaluations
 * (scripts/evaluate-official-rf.ts). Covered by tests/unit/eval-metrics.test.ts.
 */

/** ROC AUC by the rank-sum (Mann–Whitney) statistic, ties counted as 1/2. null if one class is empty. */
export function auc(scores: number[], labels: boolean[]): number | null {
  const idx = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0]);
  let pos = 0, neg = 0, rankSum = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    const avgRank = (i + 1 + j) / 2; // ranks are 1-based
    for (let k = i; k < j; k++) if (idx[k][1]) { rankSum += avgRank; pos++; } else neg++;
    i = j;
  }
  if (!pos || !neg) return null;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function brier(p: number[], y: boolean[]): number {
  return p.reduce((s, v, i) => s + (v - (y[i] ? 1 : 0)) ** 2, 0) / p.length;
}

/** Reliability diagram in `bins` equal-width bins of predicted probability + expected calibration error. */
export function reliability(p: number[], y: boolean[], bins = 10) {
  const b = Array.from({ length: bins }, (_, i) => ({ from: i / bins, to: (i + 1) / bins, n: 0, meanPredicted: 0, observedRate: 0 }));
  p.forEach((v, i) => { const k = Math.min(bins - 1, Math.floor(v * bins)); b[k].n++; b[k].meanPredicted += v; b[k].observedRate += y[i] ? 1 : 0; });
  let ece = 0;
  for (const x of b) if (x.n) { x.meanPredicted /= x.n; x.observedRate /= x.n; ece += (x.n / p.length) * Math.abs(x.meanPredicted - x.observedRate); }
  return { bins: b.filter((x) => x.n).map((x) => ({ ...x, meanPredicted: round(x.meanPredicted), observedRate: round(x.observedRate) })), ece: round(ece) };
}

export interface Confusion { tp: number; fp: number; fn: number; tn: number; precision: number | null; recall: number | null; f1: number | null; fpr: number | null }
export function confusion(pred: boolean[], y: boolean[]): Confusion {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  pred.forEach((p, i) => { if (p && y[i]) tp++; else if (p) fp++; else if (y[i]) fn++; else tn++; });
  const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, tn, precision: r3(precision), recall: r3(recall), f1: r3(f1), fpr: r3(fp + tn ? fp / (fp + tn) : null) };
}

/**
 * Logistic regression by Newton–Raphson (IRLS) with a small L2 penalty (not on the intercept).
 * Features are standardised with the TRAINING mean/sd, which are returned so the same transform
 * is applied to the test set (no information from the test set is used).
 */
export function fitLogistic(X: number[][], y: boolean[], opts: { l2?: number; iters?: number } = {}) {
  const n = X.length, d = X[0].length, l2 = opts.l2 ?? 1e-3;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((s, r) => s + r[j], 0) / n);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / n) || 1);
  const Z = X.map((r) => [1, ...r.map((v, j) => (v - mean[j]) / sd[j])]);
  let w = new Array(d + 1).fill(0);
  for (let it = 0; it < (opts.iters ?? 50); it++) {
    const g = new Array(d + 1).fill(0), H = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const p = sigmoid(dot(w, Z[i])), e = p - (y[i] ? 1 : 0), v = p * (1 - p);
      for (let a = 0; a <= d; a++) { g[a] += e * Z[i][a]; for (let b = 0; b <= d; b++) H[a][b] += v * Z[i][a] * Z[i][b]; }
    }
    for (let a = 1; a <= d; a++) { g[a] += l2 * n * w[a]; H[a][a] += l2 * n; }
    const step = solve(H, g); w = w.map((x, a) => x - step[a]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  const predict = (x: number[]) => sigmoid(dot(w, [1, ...x.map((v, j) => (v - mean[j]) / sd[j])]));
  return { intercept: w[0], coefStandardized: w.slice(1), mean, sd, predict };
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
const round = (v: number) => Math.round(v * 1000) / 1000;
const r3 = (v: number | null) => (v == null ? null : round(v));
