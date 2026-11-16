import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRoi, parseSisfogoPage, sisfogoPageUrl, localDate, localTime } from "../../server/connectors/sisfogo";
import { roi, page } from "../fixtures/sisfogo";

test("sisfogo: page URL clamps size to 1..500 and rejects page < 1", () => {
  const u = new URL(sisfogoPageUrl(2, 1000));
  assert.equal(u.pathname, "/api/v1/roi/publico");
  assert.equal(u.searchParams.get("page"), "2");
  assert.equal(u.searchParams.get("size"), "500");
  assert.equal(new URL(sisfogoPageUrl(1, 0)).searchParams.get("size"), "1");
  assert.throws(() => sisfogoPageUrl(0));
});

test("sisfogo: normalizeRoi maps documented fields without inventing a time zone", () => {
  const r = normalizeRoi(roi(1));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.warnings, []);
  assert.equal(r.row.startedOn, "2026-08-12");
  assert.equal(r.row.startedLocalTime, "14:30");
  assert.equal(r.row.extinguishedOn, "2026-08-13");
  assert.equal(r.row.state, "TO");
  assert.equal(r.row.municipality, "Palmas");
  assert.equal(r.row.biome, "Cerrado");
  assert.equal(r.row.burnedAreaHa, 12.5);
  assert.equal(r.row.vegetation, "Cerrado sentido restrito");
  assert.equal(r.row.roiNumber, "ROI.TESTE.1");
});

test("sisfogo: invalid values become NULL (never guessed); bad records are rejected", () => {
  const bad = normalizeRoi(roi(2, {
    localIncendio: { latitude: 999, longitude: -48, municipio: { unidadeFederativa: { siglaUnidadeFederativa: "Tocantins" } } },
    informacoesPosIncendio: { estimativaAreaQueimada: -3 },
    dataInicioIncendio: "2026-02-30T10:00:00",
  }));
  assert.ok(bad.ok);
  if (!bad.ok) return;
  assert.equal(bad.row.latitude, null);
  assert.equal(bad.row.longitude, null, "half a coordinate is dropped too");
  assert.equal(bad.row.burnedAreaHa, null);
  assert.equal(bad.row.state, null);
  assert.equal(bad.row.startedOn, null, "impossible date");
  assert.deepEqual(bad.warnings.sort(), ["area_negativa", "coordenada_incompleta", "latitude_invalida", "uf_invalida"]);
  assert.deepEqual(normalizeRoi({ numeroRoi: "x" }), { ok: false, reason: "sem_identificador" });
  assert.deepEqual(normalizeRoi(roi(3, { statusRoi: "EM_ANDAMENTO" })), { ok: false, reason: "status_nao_finalizado" });
});

test("sisfogo: page envelope must match the documented shape", () => {
  const p = parseSisfogoPage(page([roi(1)], 1, 3), 1);
  assert.equal(p.totalPages, 3);
  assert.equal(p.items.length, 1);
  assert.throws(() => parseSisfogoPage({ content: [] }, 1), /fora do formato documentado.*content/);
  assert.throws(() => parseSisfogoPage({ itens: [] }, 1), /totalPaginas/);
  assert.equal(localDate("2026-13-01"), null);
  assert.equal(localTime("2026-08-12T25:00:00"), null);
});
