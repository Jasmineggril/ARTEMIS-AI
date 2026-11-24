import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOpenMeteo, fetchRiskWeather, buildOpenMeteoUrl, ConnectorError } from "../../server/connectors/open-meteo";
import { resolveInputs, normalizeLevel, MissingInputError, buildLimitations, runEngine, distanceKm } from "../../server/services/risk-service";
import { canTransition, allowedTransitions, shouldAlert } from "../../server/services/alert-service";
import { rateLimit, roleAtLeast } from "../../server/security";
import { toCsv, boundarySchema } from "../../server/artemis-routes";
import { revalidateImportRecord } from "../../server/routes";

function hourlySeries(refIso: string, hours: number, value: number) {
  const ref = Date.parse(refIso);
  const time: string[] = [];
  const precipitation: number[] = [];
  for (let h = hours - 1; h >= -12; h--) {
    time.push(new Date(ref - h * 3600_000).toISOString().slice(0, 16));
    precipitation.push(value);
  }
  return { time, precipitation };
}

const REF = "2026-09-01T15:00";
const okPayload = {
  current: { time: REF, temperature_2m: 36.2, relative_humidity_2m: 18, wind_speed_10m: 22.5 },
  hourly: hourlySeries(`${REF}Z`, 80, 0.5),
};

// ── Open-Meteo connector ─────────────────────────────────────────────────────

test("open-meteo: parses current values and sums only the last 72 h up to the reference time", () => {
  const w = parseOpenMeteo(okPayload);
  assert.equal(w.temperature, 36.2);
  assert.equal(w.humidity, 18);
  assert.equal(w.windSpeed, 22.5);
  assert.equal(w.precipitation72h, 36); // 72 h × 0.5 mm; future hours excluded
  assert.equal(w.referenceAt, "2026-09-01T15:00:00.000Z");
});

test("open-meteo: rejects missing current block, out-of-range values and incomplete series", () => {
  assert.throws(() => parseOpenMeteo({}), ConnectorError);
  assert.throws(() => parseOpenMeteo({ ...okPayload, current: { ...okPayload.current, relative_humidity_2m: 140 } }), ConnectorError);
  assert.throws(() => parseOpenMeteo({ ...okPayload, hourly: hourlySeries(`${REF}Z`, 20, 1) }), /incompleta/);
});

test("open-meteo: HTTP errors and network failures become ConnectorError (no invented data)", async () => {
  await assert.rejects(fetchRiskWeather(-14, -47, async () => ({ ok: false, status: 503, json: async () => ({}) })), /HTTP 503/);
  await assert.rejects(fetchRiskWeather(-14, -47, async () => { throw new Error("ECONNRESET"); }), /indisponível/);
  const w = await fetchRiskWeather(-14, -47, async () => ({ ok: true, status: 200, json: async () => okPayload }));
  assert.equal(w.source, "open-meteo");
});

test("open-meteo: URL requests km/h wind and 3 past days", () => {
  const u = new URL(buildOpenMeteoUrl(-14.123456, -47.5));
  assert.equal(u.searchParams.get("wind_speed_unit"), "kmh");
  assert.equal(u.searchParams.get("past_days"), "3");
  assert.equal(u.searchParams.get("latitude"), "-14.1235");
});

// ── Risk service ─────────────────────────────────────────────────────────────

const area = { latitude: -14.1, longitude: -47.5 };

test("risk-service: manual values win over live data; live fills only gaps, with provenance", async () => {
  const r = await resolveInputs(
    { useLiveWeather: true, inputs: { temperature: 30, vegetationCondition: "dry", nearbyHotspot: false } },
    area, 3, async () => ({ ok: true, status: 200, json: async () => okPayload }),
  );
  assert.equal(r.engineInput.temperature, 30);
  assert.equal(r.engineInput.humidity, 18);
  const origin = Object.fromEntries(r.provenance.map((p) => [p.field, p.origin]));
  assert.equal(origin.temperature, "manual");
  assert.equal(origin.humidity, "open-meteo");
  assert.equal(origin.historicalOccurrences, "base-historica-organizacao");
  assert.equal(r.engineInput.historicalOccurrences, 3);
});

test("risk-service: missing values with failing source → MissingInputError carrying the connector error", async () => {
  await assert.rejects(
    resolveInputs({ useLiveWeather: true, inputs: { vegetationCondition: "dry", nearbyHotspot: false } }, area, null,
      async () => ({ ok: false, status: 500, json: async () => ({}) })),
    (e: unknown) => e instanceof MissingInputError && e.missing.length === 4 && /HTTP 500/.test(e.connectorError ?? ""),
  );
  await assert.rejects(
    resolveInputs({ useLiveWeather: true, inputs: { vegetationCondition: "dry", nearbyHotspot: false } }, { latitude: null, longitude: null }, null),
    (e: unknown) => e instanceof MissingInputError && /sem coordenadas/.test(e.connectorError ?? ""),
  );
});

test("risk-service: Python response is normalised; ML synthetic is flagged experimental", async () => {
  const resolved = await resolveInputs(
    { useLiveWeather: false, inputs: { temperature: 38, humidity: 15, windSpeed: 40, recentRainfall: 0, vegetationCondition: "very_dry", nearbyHotspot: false } },
    area, null,
  );
  const fakePy = (async () => new Response(JSON.stringify({
    score: 87, level: "critico", factors: [], recommendations: [], model_type: "supervised-ml",
    model_version: "1.0.0-sklearn-rf", dataset_type: "synthetic", is_experimental: true,
  }), { status: 200 })) as typeof fetch;
  const out = await runEngine(resolved, fakePy);
  assert.equal(out.level, "crítico");
  assert.equal(out.isExperimental, true);
  assert.ok(buildLimitations(resolved, out).some((l) => /EXPERIMENTAL/.test(l)));

  const badPy = (async () => new Response(JSON.stringify({ score: 999 }), { status: 200 })) as typeof fetch;
  const fb = await runEngine(resolved, badPy);
  assert.equal(fb.engineType, "transparent-rule-engine-ts-fallback", "invalid python output → fallback");
});

test("risk-service: level normalisation and distance", () => {
  assert.equal(normalizeLevel("CRÍTICO"), "crítico");
  assert.equal(normalizeLevel("moderado"), "moderado");
  assert.throws(() => normalizeLevel("extremo"));
  assert.ok(Math.abs(distanceKm(-15.78, -47.93, -16.68, -49.25) - 172) < 5); // Brasília–Goiânia ≈ 172 km
});

// ── Alerts ───────────────────────────────────────────────────────────────────

test("alerts: transition table", () => {
  assert.ok(canTransition("novo", "reconhecido"));
  assert.ok(canTransition("resolvido", "em_acompanhamento"));
  assert.ok(!canTransition("resolvido", "novo"));
  assert.ok(!canTransition("em_acompanhamento", "novo"));
  assert.deepEqual(allowedTransitions("descartado"), ["reconhecido"]);
  assert.ok(shouldAlert("crítico") && shouldAlert("alto") && !shouldAlert("moderado"));
});

// ── Security helpers ─────────────────────────────────────────────────────────

test("security: role hierarchy", () => {
  assert.ok(roleAtLeast("owner", "admin"));
  assert.ok(roleAtLeast("analyst", "analyst"));
  assert.ok(!roleAtLeast("viewer", "analyst"));
});

test("security: rate limiter blocks after max hits per window", async () => {
  delete process.env.RATE_LIMIT_DISABLED;
  const mw = rateLimit({ windowMs: 60_000, max: 2, key: "t" });
  const statuses: number[] = [];
  for (let i = 0; i < 3; i++) {
    let code = 200;
    const res: any = { setHeader() {}, status(c: number) { code = c; return { json() {} }; } };
    await new Promise<void>((resolve) => {
      mw({ path: "/x", ip: "1.2.3.4", socket: {} } as any, res, () => resolve());
      if (code !== 200) resolve();
    });
    statuses.push(code);
  }
  assert.deepEqual(statuses, [200, 200, 429]);
});

// ── CSV / GeoJSON / import ───────────────────────────────────────────────────

test("csv: quotes separators and neutralises formulas", () => {
  const out = toCsv(["a", "b"], [["=1+1", 'x,"y"'], ["-2", null]]);
  assert.equal(out, "a,b\n'=1+1,\"x,\"\"y\"\"\"\n'-2,\n");
});

test("geojson: accepts closed Polygon, rejects open ring and invalid coordinates", () => {
  const closed = [[[-47, -14], [-46, -14], [-46, -15], [-47, -14]]];
  assert.ok(boundarySchema.safeParse({ type: "Polygon", coordinates: closed }).success);
  assert.ok(!boundarySchema.safeParse({ type: "Polygon", coordinates: [[[-47, -14], [-46, -14], [-46, -15], [-47, -15]]] }).success);
  assert.ok(!boundarySchema.safeParse({ type: "Polygon", coordinates: [[[-247, -14], [-46, -14], [-46, -15], [-247, -14]]] }).success);
  assert.ok(!boundarySchema.safeParse({ type: "Point", coordinates: [-47, -14] }).success);
});

test("import: server re-validation downgrades physically impossible records", () => {
  assert.equal(revalidateImportRecord({ validationStatus: "válido", latitude: -14, longitude: -47 }).status, "válido");
  const bad = revalidateImportRecord({ validationStatus: "válido", latitude: 95, longitude: -47, affectedArea: -1 });
  assert.equal(bad.status, "inválido");
  assert.equal(bad.reasons.length, 2);
  assert.equal(revalidateImportRecord({ validationStatus: "válido", occurrenceDate: "31/31/2025" }).status, "inválido");
  assert.equal(revalidateImportRecord({ validationStatus: "válido", occurrenceDate: "31/02/2025" }).status, "inválido");
  const br = revalidateImportRecord({ validationStatus: "válido", occurrenceDate: "10/08/2025" });
  assert.equal(br.status, "válido");
  assert.equal(br.isoDate, "2025-08-10");
});

// ── INPE connector (real sample + marked synthetic invalid rows) ─────────────
import { readFileSync } from "node:fs";
import { parseInpeCsv, inpeDailyUrl, recentUtcDays, IBGE_UF } from "../../server/connectors/inpe";

const INPE_SAMPLE = readFileSync(new URL("../fixtures/inpe_focos_diario_amostra.csv", import.meta.url), "utf8");

test("inpe: parses the real CSV format, -999 and empty values become null, UTC timestamps", () => {
  const r = parseInpeCsv(INPE_SAMPLE);
  assert.equal(r.read, 16);
  assert.equal(r.rows.length, 12);
  assert.deepEqual(r.rejected, {
    "sem identificador": 1, "coordenadas inválidas": 1, "data/hora inválida": 1, "identificador repetido no arquivo": 1,
  });
  const first = r.rows[0];
  assert.match(first.externalId, /^[0-9a-f-]{36}$/);
  assert.equal(first.detectedAt.toISOString(), "2026-11-15T00:00:00.000Z");
  assert.equal(first.state, "PA");
  assert.equal(first.municipalityIbgeCode, "1500503");
  assert.ok(r.rows.some((x) => x.daysWithoutRain === null), "-999 -> null");
  assert.ok(r.rows.some((x) => x.frpMw === null), "empty FRP -> null");
  assert.ok(r.rows.every((x) => x.fireRisk === null || (x.fireRisk >= 0 && x.fireRisk <= 1)));
  assert.ok(r.rows.some((x) => x.state === "GO" && x.biome === "Cerrado"));
});

test("inpe: unexpected header is rejected instead of guessed", () => {
  assert.throws(() => parseInpeCsv("lat,lon\n1,2\n"), /colunas ausentes/);
  assert.throws(() => parseInpeCsv(""), /vazio/);
});

test("inpe: URL, recent days and UF table", () => {
  assert.equal(inpeDailyUrl("2026-11-15"), "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/focos_diario_br_20261115.csv");
  assert.deepEqual(recentUtcDays(2, new Date("2026-11-16T01:00:00Z")), ["2026-11-16", "2026-11-15"]);
  assert.equal(Object.keys(IBGE_UF).length, 27);
  assert.equal(IBGE_UF["52"], "GO");
});

test("db-url: DATABASE_URL wins, Supabase is legacy and refused in production", async () => {
  const { resolveDatabaseUrl, describeDbUrl } = await import("../../server/db-url");
  const both = resolveDatabaseUrl({ DATABASE_URL: "postgresql://a:secret@db:5432/artemis_ai", SUPABASE_DATABASE_URL: "postgresql://x@sb.supabase.co/p" });
  assert.equal(both.origin, "DATABASE_URL");
  assert.match(both.warnings[0], /IGNORADA/);
  assert.equal(resolveDatabaseUrl({ PGHOST: "db", PGPASSWORD: "p@ss" }).url, "postgresql://artemis_app:p%40ss@db:5432/artemis_ai");
  assert.throws(() => resolveDatabaseUrl({ NODE_ENV: "production", SUPABASE_DATABASE_URL: "postgresql://x@sb.supabase.co/p" }), /ALLOW_LEGACY_SUPABASE/);
  assert.equal(resolveDatabaseUrl({ NODE_ENV: "production", SUPABASE_DATABASE_URL: "postgresql://x@sb.supabase.co/p", ALLOW_LEGACY_SUPABASE: "true" }).origin, "SUPABASE_DATABASE_URL");
  assert.throws(() => resolveDatabaseUrl({ NODE_ENV: "production" }), /DATABASE_URL não definida/);
  assert.equal(describeDbUrl("postgresql://user:secret@db:5432/artemis_ai"), "db:5432/artemis_ai", "no credentials");
});

test("risk-service: hotspot proximity — manual wins, fresh INPE data is used, stale data is flagged", async () => {
  const base = { temperature: 30, humidity: 30, windSpeed: 10, recentRainfall: 0, vegetationCondition: "dry" as const };
  const fresh = { fresh: true, lastSyncAt: new Date("2026-11-16T10:00:00Z"), nearestKm: 3.2, count: 4, radiusKm: 10, windowHours: 48 };
  const a = await resolveInputs({ useLiveWeather: false, inputs: { ...base } }, area, null, undefined, { hotspots: fresh });
  assert.equal(a.engineInput.nearbyHotspot, true);
  assert.equal(a.engineInput.hotspotDistance, 3.2);
  assert.equal(a.hotspotOrigin, "inpe-queimadas");
  const b = await resolveInputs({ useLiveWeather: false, inputs: { ...base, nearbyHotspot: false } }, area, null, undefined, { hotspots: fresh });
  assert.equal(b.engineInput.nearbyHotspot, false, "user statement wins");
  const c = await resolveInputs({ useLiveWeather: false, inputs: { ...base } }, area, null, undefined, { hotspots: { ...fresh, fresh: false } });
  assert.equal(c.hotspotOrigin, "nao-verificado");
  const eng = await runEngine(c, (async () => { throw new Error("off"); }) as any);
  assert.ok(buildLimitations(c, eng).some((l) => /NÃO verificada/.test(l)));
});
