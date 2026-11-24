/**
 * INPE fire risk model 2.2 (shared/inpe-fire-risk.ts) — controlled cases computed by hand
 * from the constants of INPE's published script and the categories of the Anuário 2025.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { basicRisk, inpeFireRisk, pse, rfClass, PRECIP_WINDOWS } from "../../shared/inpe-fire-risk";

const close = (a: number, b: number, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const days = (fill: Record<number, number> = {}) => Array.from({ length: 120 }, (_, i) => fill[i + 1] ?? 0);

test("PSE: 105 with no rain; each window uses its own constant; needs 120 days", () => {
  assert.equal(pse(days()), 105);
  close(pse(days({ 1: 10 })), 105 * Math.exp(-1.4));            // day 1: c = −0.14
  close(pse(days({ 7: 10, 8: 10 })), 105 * Math.exp(-0.01 * 20)); // days 6–10 share c = −0.01
  close(pse(days({ 100: 50 })), 105 * Math.exp(-0.0007 * 50));    // days 91–120
  assert.equal(PRECIP_WINDOWS.length, 11);
  assert.throws(() => pse(new Array(119).fill(0)), /120 dias/);
});

test("basic risk by vegetation class (A and PSEmax from INPE's script)", () => {
  assert.equal(basicRisk(105, 1), 0.9, "PSE above PSEmax (30) → 0.9");
  const p = 105 * Math.exp(-1.4); // 25.89
  close(basicRisk(p, 3)!, (0.9 * (1 + Math.sin((3 * p - 90) * (3.1416 / 180)))) / 2); // ≈ 0.354
  close(basicRisk(p, 3)!, 0.3539, 1e-3);
  assert.equal(basicRisk(50, 0), null, "water: not computed");
  assert.equal(basicRisk(50, 8), null);
});

test("final risk: FU, FT, latitude and elevation factors, cap at 1", () => {
  // no rain, class 1, T 30 °C, UR 60 %, lat −15, 1000 m
  const r = inpeFireRisk({ pse: 105, vegClass: 1, temperatureC: 30, rh: 60, lat: -15, elevationM: 1000 });
  close(r.fu, -0.006 * 60 + 1.3); close(r.ft, 1.0); close(r.flat, 1.045); close(r.ftop, 1.03);
  close(r.rfBeforeV22!, 0.9 * 1.0 * 0.94);
  close(r.rf!, 0.846 * 1.045 * 1.03);
  assert.equal(rfClass(r.rf!), "alto");
  const capped = inpeFireRisk({ pse: 105, vegClass: 1, temperatureC: 40, rh: 10, lat: -10, elevationM: 0 });
  assert.equal(capped.rf, 1);
  const pub = inpeFireRisk({ pse: 105, vegClass: 1, temperatureC: 30, rh: 60, lat: -15, elevationM: 1000 }, { fuSlope: -0.008, applyV22: false });
  close(pub.rf!, 0.9 * 1.0 * (-0.008 * 60 + 1.3));
});

test("official categories (Anuário Risco de Fogo 2025, Tabela 3.1): upper bounds inclusive", () => {
  assert.deepEqual([0, 0.15, 0.1501, 0.4, 0.41, 0.7, 0.71, 0.95, 0.951, 1].map(rfClass),
    ["minimo", "minimo", "baixo", "baixo", "medio", "medio", "alto", "alto", "critico", "critico"]);
});
