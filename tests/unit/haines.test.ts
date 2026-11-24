import { test } from "node:test";
import assert from "node:assert/strict";
import { haines, hainesVariant, standardPressureHpa } from "../../shared/haines";
import { hainesForPoint } from "../../server/services/haines";

test("variant chosen by standard-atmosphere surface pressure", () => {
  assert.equal(hainesVariant(0), "baixa");
  assert.equal(hainesVariant(500), "baixa");
  assert.equal(hainesVariant(1151), "media");          // Brasília
  assert.equal(hainesVariant(2000), "alta");
  assert.ok(Math.abs(standardPressureHpa(1500) - 845.6) < 1);
});

test("Haines 1988 thresholds, hand-computed", () => {
  // low: ΔT 950-850 = 3 → 1 ; T-Td = 5 → 1  → 2
  assert.equal(haines({ t950: 20, t850: 17, td850: 12 }, "baixa")!.hi, 2);
  // low: ΔT 8 → 3 ; dd 10 → 3 → 6 (alto)
  const r = haines({ t950: 28, t850: 20, td850: 10 }, "baixa")!;
  assert.deepEqual([r.A, r.B, r.hi, r.cls], [3, 3, 6, "alto"]);
  // mid: ΔT 850-700 = 10 → 2 ; dd 13 → 3 → 5 moderado
  assert.deepEqual([haines({ t850: 22, t700: 12, td850: 9 }, "media")!.hi, haines({ t850: 22, t700: 12, td850: 9 }, "media")!.cls], [5, "moderado"]);
  // mid: ΔT 11 → 3 ; dd 6 → 2 → 5
  assert.equal(haines({ t850: 22, t700: 11, td850: 16 }, "media")!.hi, 5);
  // high: ΔT 700-500 = 17 → 1 ; dd 700 = 21 → 3 → 4 baixo
  assert.equal(haines({ t700: 5, t500: -12, td700: -16 }, "alta")!.cls, "baixo");
  // high: ΔT 22 → 3 ; dd 15 → 2 → 5
  assert.equal(haines({ t700: 5, t500: -17, td700: -10 }, "alta")!.hi, 5);
});

test("never computed without the pressure levels it needs (no surface substitute)", () => {
  assert.equal(haines({ t850: 20, td850: 10 }, "baixa"), null);
  assert.equal(haines({ t850: 20, t700: null, td850: 10 }, "media"), null);
  assert.equal(haines({ t700: 5, t500: -15 }, "alta"), null);
  assert.equal(haines({ t700: 5, t500: NaN, td700: 0 }, "alta"), null);
});

const now = new Date("2026-11-24T12:00:00Z");
const hourly = (vals: Record<string, number | null>) => {
  const time = ["2026-11-24T18:00", "2026-11-25T18:00"];
  return Object.fromEntries([["time", time], ...Object.entries(vals).map(([k, v]) => [k, [v, v]])]);
};

test("service: indisponivel with the API reason (quota), never a fabricated value", async () => {
  const r = await hainesForPoint(-10.1, -50.1, 300, { now, fetchJson: async () => ({ ok: false, status: 429, json: async () => ({ error: true, reason: "Daily API request limit exceeded." }) }) });
  assert.equal(r.status, "indisponivel");
  assert.match((r as any).reason, /limit exceeded/);
});

test("service: indisponivel when a required level is missing", async () => {
  const r = await hainesForPoint(-10.2, -50.2, 300, { now, fetchJson: async () => ({ ok: true, status: 200, json: async () => ({ elevation: 300, hourly: hourly({ temperature_850hPa: 20, dew_point_850hPa: 10 }) }) }) });
  assert.equal(r.status, "indisponivel");
});

test("service: computes from model pressure levels at 18 UTC, labelled as model data", async () => {
  const r: any = await hainesForPoint(-10.3, -50.3, null, { now, fetchJson: async () => ({ ok: true, status: 200, json: async () => ({ elevation: 300,
    hourly: hourly({ temperature_950hPa: 28, temperature_850hPa: 20, dew_point_850hPa: 10, temperature_700hPa: 10, dew_point_700hPa: 0, temperature_500hPa: -8 }) }) }) });
  assert.equal(r.status, "ok"); assert.equal(r.variant, "baixa"); assert.equal(r.nature, "estimado_modelo");
  assert.equal(r.values[0].at, "2026-11-24T18:00Z"); assert.equal(r.values[0].result.hi, 6);
});
