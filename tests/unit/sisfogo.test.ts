import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRoi, buildSisfogoUrl } from "../../server/connectors/sisfogo";

const sampleRoi = {
  id: "11111111-2222-3333-4444-555555555555",
  numeroRoi: "ROI.12082026.TO.0006",
  statusRoi: "FINALIZADO",
  retificado: false,
  localIncendio: {
    latitude: -10.5,
    longitude: -48.3,
    municipio: { nomeMunicipio: "Palmas", unidadeFederativa: { siglaUnidadeFederativa: "TO", nomeUnidadeFederativa: "Tocantins" } },
    bioma: { nomeBioma: "Cerrado" },
  },
  dataInicioIncendio: "2026-08-12T14:30:00",
  dataDeteccaoIncendio: "2026-08-12T15:00:00",
  dataExtincaoIncendio: "2026-08-12T18:00:00",
  informacoesPosIncendio: {
    estimativaAreaQueimada: 12.5,
    vegetacoesAtingidas: [{ vegetacao: "Pastagem cultivada" }, { vegetacao: "Vegetação nativa" }],
  },
};

test("sisfogo: normalizeRoi extracts fields and marks valid", () => {
  const { record, errors } = normalizeRoi(sampleRoi);
  assert.deepEqual(errors, []);
  assert.equal(record.validationStatus, "válido");
  assert.equal(record.occurrenceDate, "2026-08-12");
  assert.equal(record.occurrenceTime, "14:30");
  assert.equal(record.municipality, "Palmas");
  assert.equal(record.state, "TO");
  assert.equal(record.latitude, -10.5);
  assert.equal(record.longitude, -48.3);
  assert.equal(record.affectedArea, 12.5);
  assert.equal(record.vegetationCondition, "Pastagem cultivada; Vegetação nativa");
  assert.equal(record.source, "sisfogo");
  assert.equal(record.sourceReference, "ROI.12082026.TO.0006");
  assert.equal(record.dedupKey, "sisfogo:ROI.12082026.TO.0006");
});

test("sisfogo: normalizeRoi marks invalid for out-of-range coords and negative area", () => {
  const bad = { ...sampleRoi, localIncendio: { ...sampleRoi.localIncendio, latitude: 999 }, informacoesPosIncendio: { estimativaAreaQueimada: -1 } };
  const { record, errors } = normalizeRoi(bad);
  assert.equal(record.validationStatus, "inválido");
  assert.ok(errors.includes("latitude fora da faixa válida"));
  assert.ok(errors.includes("área afetada negativa"));
});

test("sisfogo: buildSisfogoUrl limits page size to 500", () => {
  const u = new URL(buildSisfogoUrl(2, 1000));
  assert.equal(u.searchParams.get("page"), "2");
  assert.equal(u.searchParams.get("size"), "500");
  const u2 = new URL(buildSisfogoUrl(1, 50));
  assert.equal(u2.searchParams.get("size"), "50");
});