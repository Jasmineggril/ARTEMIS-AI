import { test } from "node:test";
import assert from "node:assert/strict";
import { auc, brier, reliability, confusion, fitLogistic } from "../../shared/eval-metrics";

test("AUC: perfect, inverse, random ties and empty class", () => {
  assert.equal(auc([1, 2, 3, 4], [false, false, true, true]), 1);
  assert.equal(auc([4, 3, 2, 1], [false, false, true, true]), 0);
  assert.equal(auc([1, 1, 1, 1], [false, true, false, true]), 0.5);
  // hand count: pairs (pos,neg) = (2,1)✓ (2,3)✗ (4,1)✓ (4,3)✓ → 3/4
  assert.equal(auc([1, 2, 3, 4], [false, true, false, true]), 0.75);
  assert.equal(auc([1, 2], [true, true]), null);
});

test("Brier, reliability (ECE) and confusion, hand-computed", () => {
  assert.equal(brier([0.5, 0.5], [true, false]), 0.25);
  const r = reliability([0.05, 0.05, 0.95, 0.95], [false, false, true, false], 10);
  assert.equal(r.bins.length, 2);
  assert.deepEqual([r.bins[1].meanPredicted, r.bins[1].observedRate], [0.95, 0.5]);
  assert.equal(r.ece, 0.25); // ½·|0.05−0| + ½·|0.95−0.5|
  const c = confusion([true, true, false, false], [true, false, true, false]);
  assert.deepEqual([c.tp, c.fp, c.fn, c.tn, c.precision, c.recall, c.f1, c.fpr], [1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5]);
});

test("logistic regression recovers a known relation and is calibrated in-sample", () => {
  // y = 1 with probability sigmoid(-2 + 4x), x on a grid: deterministic expected counts
  const X: number[][] = [], y: boolean[] = [];
  for (let k = 0; k <= 20; k++) {
    const x = k / 20, p = 1 / (1 + Math.exp(-(-2 + 4 * x)));
    for (let r = 0; r < 100; r++) { X.push([x]); y.push(r < Math.round(p * 100)); }
  }
  const m = fitLogistic(X, y, { l2: 0 });
  // back to raw scale: slope = coef/sd, intercept = b0 − coef·mean/sd
  const slope = m.coefStandardized[0] / m.sd[0], b0 = m.intercept - slope * m.mean[0];
  assert.ok(Math.abs(slope - 4) < 0.1, `slope ${slope}`);
  assert.ok(Math.abs(b0 + 2) < 0.1, `intercept ${b0}`);
  const mean = X.reduce((s, x) => s + m.predict(x), 0) / X.length, rate = y.filter(Boolean).length / y.length;
  assert.ok(Math.abs(mean - rate) < 1e-3, "mean prediction equals observed rate (property of the MLE)");
});
