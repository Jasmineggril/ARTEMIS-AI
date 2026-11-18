import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRoi, parseSisfogoPage, sisfogoPageUrl, sisfogoBaseUrl, parseInstant, brasiliaParts, contentHash,
  fetchSisfogoPage, retryDelay, clampPageSize, SisfogoHttpError, SisfogoContractError, DEFAULT_RETRY,
} from "../../server/connectors/sisfogo";
import { REAL_ROIS, roi, page } from "../fixtures/sisfogo";

const noSleep = { sleep: async () => {}, baseDelayMs: 1, timeoutMs: 50 };

test("contract: every real ROI in the fixture normalizes, dates read from datasIncendio", () => {
  for (const r of REAL_ROIS) {
    const n = normalizeRoi(r);
    assert.ok(n.ok, `${r.numeroRoi} should normalize`);
    if (!n.ok) continue;
    assert.equal(n.row.startedAt.toISOString(), new Date(r.datasIncendio.dataInicioIncendio).toISOString());
    assert.equal(n.row.roiNumber, r.numeroRoi);
    assert.equal(n.row.state, r.localIncendio.municipio.unidadeFederativa.siglaUnidadeFederativa);
    assert.equal(n.row.latitude, r.localIncendio.latitude);
    assert.equal(n.row.institutionAcronym, r.instituicaoResponsavel.sigla);
  }
});

test("contract: all five fire stages are kept distinct; absent stages stay NULL", () => {
  const full = normalizeRoi(REAL_ROIS[0]);
  assert.ok(full.ok);
  if (!full.ok) return;
  const d = REAL_ROIS[0].datasIncendio;
  assert.equal(full.row.detectedAt?.toISOString(), new Date(d.dataDeteccaoIncendio).toISOString());
  assert.equal(full.row.firstAttackAt?.toISOString(), new Date(d.dataPrimeiroAtaque).toISOString());
  assert.equal(full.row.controlledAt?.toISOString(), new Date(d.dataControleIncendio).toISOString());
  assert.equal(full.row.extinguishedAt?.toISOString(), new Date(d.dataExtincaoIncendio).toISOString());
  assert.equal(full.row.burnedAreaHa, REAL_ROIS[0].informacoesPosIncendio.estimativaAreaQueimada);

  const partial = normalizeRoi(REAL_ROIS[1]); // no combat: only start + detection published
  assert.ok(partial.ok);
  if (!partial.ok) return;
  assert.equal(partial.row.controlledAt, null);
  assert.equal(partial.row.extinguishedAt, null);
  assert.equal(partial.row.burnedAreaHa, null, "absent estimate is NULL, never 0");
  assert.deepEqual(partial.warnings, []);
});

test("dates: UTC instants only; no zone → not guessed; Brasília parts derived from the instant", () => {
  assert.equal(parseInstant("2026-10-24T09:30:00Z")?.toISOString(), "2026-10-24T09:30:00.000Z");
  assert.equal(parseInstant("2026-11-02T16:13:11.99906Z")?.toISOString(), "2026-11-02T16:13:11.999Z");
  assert.equal(parseInstant("2026-10-24T09:30:00-03:00")?.toISOString(), "2026-10-24T12:30:00.000Z");
  assert.equal(parseInstant("2026-10-24T09:30:00"), null, "no zone");
  assert.equal(parseInstant("2026-02-30T10:00:00Z"), null, "impossible date");
  assert.equal(parseInstant("2026-10-24"), null);
  assert.deepEqual(brasiliaParts(new Date("2026-10-24T02:30:00Z")), { date: "2026-10-23", time: "23:30" });
  const noZone = normalizeRoi(roi(1, { datasIncendio: { dataInicioIncendio: "2026-10-24T09:30:00" } }));
  assert.deepEqual(noZone, { ok: false, reason: "data_inicio_invalida", externalId: "00000000-0000-4000-8000-000000000001" });
  const badStage = normalizeRoi(roi(2, { datasIncendio: { dataControleIncendio: "ontem" } }));
  assert.ok(badStage.ok && badStage.row.controlledAt === null && badStage.warnings.includes("data_controle_invalida"));
});

test("identification: no UUID, bad UUID, no ROI number or not FINALIZADO are rejected; nothing is invented", () => {
  const { id, ...noId } = roi(3);
  assert.equal(normalizeRoi(noId).ok, false);
  assert.deepEqual(normalizeRoi(roi(4, { id: "123" })), { ok: false, reason: "identificador_invalido", externalId: null });
  assert.equal((normalizeRoi(roi(5, { numeroRoi: "" })) as any).reason, "sem_numero_roi");
  assert.equal((normalizeRoi(roi(6, { statusRoi: "EM_RETIFICACAO" })) as any).reason, "status_nao_finalizado");
  const { datasIncendio, ...noDates } = roi(7);
  assert.equal((normalizeRoi(noDates) as any).reason, "sem_data_inicio");
});

test("location: missing/partial/out-of-Brazil coordinates become NULL (never 0); invalid UF dropped", () => {
  const none = normalizeRoi(roi(8, { localIncendio: { latitude: undefined, longitude: undefined } }));
  assert.ok(none.ok && none.row.latitude === null && none.row.longitude === null && none.warnings.length === 0);
  const half = normalizeRoi(roi(9, { localIncendio: { longitude: undefined } }));
  assert.ok(half.ok && half.row.latitude === null && half.warnings.includes("coordenada_incompleta"));
  const abroad = normalizeRoi(roi(10, { localIncendio: { latitude: 48.85, longitude: 2.35 } }));
  assert.ok(abroad.ok && abroad.row.latitude === null && abroad.warnings.includes("coordenada_fora_do_brasil"));
  const zero = normalizeRoi(roi(11, { localIncendio: { latitude: 0, longitude: 0 } }));
  assert.ok(zero.ok && zero.row.latitude === null, "0,0 is in the ocean: dropped, not stored");
  const uf = normalizeRoi(roi(12, { localIncendio: { municipio: { unidadeFederativa: { siglaUnidadeFederativa: "Amazonas" } } } }));
  assert.ok(uf.ok && uf.row.state === null && uf.warnings.includes("uf_invalida"));
});

test("burned area: estimate kept as published (ha); negative or non-numeric dropped with a warning", () => {
  const neg = normalizeRoi(roi(13, { informacoesPosIncendio: { estimativaAreaQueimada: -1 } }));
  assert.ok(neg.ok && neg.row.burnedAreaHa === null && neg.warnings.includes("area_negativa"));
  const txt = normalizeRoi(roi(14, { informacoesPosIncendio: { estimativaAreaQueimada: "12" } }));
  assert.ok(txt.ok && txt.row.burnedAreaHa === null && txt.warnings.includes("area_nao_numerica"));
});

test("content hash is key-order independent and changes with content", () => {
  const a = roi(15);
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(contentHash(a), contentHash(reordered));
  assert.notEqual(contentHash(a), contentHash({ ...a, retificado: !a.retificado }));
});

test("page envelope: strict contract with informative errors", () => {
  const p = parseSisfogoPage(page([roi(1)], 1, 3), 1);
  assert.deepEqual([p.page, p.totalPages, p.items.length], [1, 3, 1]);
  assert.throws(() => parseSisfogoPage({ content: [] }, 1), /faltam itens, totalPaginas, totalItens.*content/);
  assert.throws(() => parseSisfogoPage({ itens: {}, totalPaginas: 1, totalItens: 1 }, 1), /não é uma lista/);
  assert.throws(() => parseSisfogoPage([], 1), /não é um objeto/);
});

test("URL: 1-based pages, size clamped to 1..50, base URL restricted to Ibama hosts (SSRF)", () => {
  const u = new URL(sisfogoPageUrl(2, 500, "https://sisfogo.sistema.gov.br"));
  assert.equal(u.toString(), "https://sisfogo.sistema.gov.br/api/v1/roi/publico?page=2&size=50");
  assert.equal(clampPageSize(0), 1);
  assert.equal(clampPageSize("x"), 20);
  assert.throws(() => sisfogoPageUrl(0, 20, "https://sisfogo.sistema.gov.br"));
  assert.equal(sisfogoBaseUrl("https://sisfogo.hom.ibama.gov.br/"), "https://sisfogo.hom.ibama.gov.br");
  for (const bad of ["http://sisfogo.sistema.gov.br", "https://evil.example", "https://sisfogo.sistema.gov.br.evil.io", "https://sisfogo.sistema.gov.br:8443", "https://u:p@sisfogo.sistema.gov.br", "https://169.254.169.254"]) {
    assert.throws(() => sisfogoBaseUrl(bad), /SISFOGO_BASE_URL/, bad);
  }
});

test("HTTP: 429 honours Retry-After, 502 retried with backoff, then succeeds", async () => {
  const waits: number[] = [];
  const seq = [{ status: 429, retryAfter: "3" }, { status: 502, retryAfter: null }, { status: 200, retryAfter: null, json: page([roi(1)], 1, 1) }];
  let i = 0;
  const p = await fetchSisfogoPage(1, 20, {
    base: "https://sisfogo.sistema.gov.br",
    fetchJson: async () => ({ json: null, ...seq[i++] }) as any,
    retry: { ...noSleep, baseDelayMs: 1000, sleep: async (ms) => { waits.push(ms); } },
  });
  assert.equal(p.attempts, 3);
  assert.equal(waits[0], 3000, "Retry-After in seconds");
  assert.ok(waits[1] >= 2400 && waits[1] <= 3600, `second wait is base*3 ±20% (${waits[1]})`);
});

test("HTTP: timeout aborts and retries; gives up after N attempts with a clear message", async () => {
  let calls = 0;
  const hang = (_url: string, signal: AbortSignal) => new Promise<any>((_, reject) => { calls++; signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))); });
  await assert.rejects(
    fetchSisfogoPage(1, 20, { base: "https://sisfogo.sistema.gov.br", fetchJson: hang, retry: { ...noSleep, attempts: 3 } }),
    (e: unknown) => e instanceof SisfogoHttpError && /após 3 tentativas \(sem resposta no tempo limite; página 1\)/.test(e.message),
  );
  assert.equal(calls, 3);
});

test("HTTP: 400/404 and contract errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(fetchSisfogoPage(1, 20, { base: "https://sisfogo.sistema.gov.br", fetchJson: async () => { calls++; return { status: 400, retryAfter: null, json: null }; }, retry: noSleep }), /HTTP 400/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(fetchSisfogoPage(1, 20, { base: "https://sisfogo.sistema.gov.br", fetchJson: async () => { calls++; return { status: 200, retryAfter: null, json: { foo: 1 } }; }, retry: noSleep }), SisfogoContractError);
  assert.equal(calls, 1);
});

test("backoff delay is capped and Retry-After dates are understood", () => {
  const p = { ...DEFAULT_RETRY, baseDelayMs: 5000, maxDelayMs: 60_000 };
  assert.equal(retryDelay(1, null, p, () => 0.5), 5000);
  assert.equal(retryDelay(2, null, p, () => 0.5), 15000);
  assert.equal(retryDelay(9, null, p, () => 0.5), 60_000);
  assert.equal(retryDelay(1, "999", p), 60_000);
  const inTen = new Date(Date.now() + 10_000).toUTCString();
  const d = retryDelay(1, inTen, p);
  assert.ok(d > 8000 && d <= 10_000, String(d));
});
