/**
 * Testes do Motor Transparente de Classificação de Risco de Incêndio
 * Motor v1.0.0 — baseado em regras documentadas
 *
 * Execute com: npm run test:risk
 */

import { calculateRisk, validateRiskInput, scoreToLevel, DEMO_SCENARIOS, type RiskInput } from "../shared/risk-engine.ts";
import assert from "node:assert/strict";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ─── Cenário 1: Baixo risco ───────────────────────────────────────────────────
console.log("\n📋 Cenário 1 — Baixo risco");

const LOW_INPUT: RiskInput = DEMO_SCENARIOS.baixo.input;

test("Cenário baixo: score deve estar entre 0 e 24", () => {
  const r = calculateRisk(LOW_INPUT, true);
  assert.ok(r.score >= 0 && r.score <= 24, `Score foi ${r.score}, esperado 0–24`);
});

test("Cenário baixo: nível deve ser 'baixo'", () => {
  const r = calculateRisk(LOW_INPUT, true);
  assert.equal(r.level, "baixo");
});

test("Cenário baixo: deve ter recomendações de monitoramento", () => {
  const r = calculateRisk(LOW_INPUT, true);
  assert.ok(r.recommendations.length > 0, "Deve ter pelo menos uma recomendação");
  assert.ok(r.recommendations.some(rec => rec.priority === "monitoramento" || rec.priority === "preventiva"));
});

// ─── Cenário 2: Moderado ──────────────────────────────────────────────────────
console.log("\n📋 Cenário 2 — Moderado");

const MODERATE_INPUT: RiskInput = DEMO_SCENARIOS.moderado.input;

test("Cenário moderado: score deve estar entre 25 e 49", () => {
  const r = calculateRisk(MODERATE_INPUT, true);
  assert.ok(r.score >= 25 && r.score <= 49, `Score foi ${r.score}, esperado 25–49`);
});

test("Cenário moderado: nível deve ser 'moderado'", () => {
  const r = calculateRisk(MODERATE_INPUT, true);
  assert.equal(r.level, "moderado");
});

test("Cenário moderado: deve ter fator de temperatura ou umidade", () => {
  const r = calculateRisk(MODERATE_INPUT, true);
  const hasTemp = r.factors.some(f => f.name.toLowerCase().includes("temperatura"));
  const hasHum  = r.factors.some(f => f.name.toLowerCase().includes("umidade"));
  assert.ok(hasTemp || hasHum, "Deve identificar temperatura ou umidade como fator");
});

// ─── Cenário 3: Alto ──────────────────────────────────────────────────────────
console.log("\n📋 Cenário 3 — Alto risco");

const HIGH_INPUT: RiskInput = DEMO_SCENARIOS.alto.input;

test("Cenário alto: score deve estar entre 50 e 74", () => {
  const r = calculateRisk(HIGH_INPUT, true);
  assert.ok(r.score >= 50 && r.score <= 74, `Score foi ${r.score}, esperado 50–74`);
});

test("Cenário alto: nível deve ser 'alto'", () => {
  const r = calculateRisk(HIGH_INPUT, true);
  assert.equal(r.level, "alto");
});

test("Cenário alto: deve ter recomendação urgente", () => {
  const r = calculateRisk(HIGH_INPUT, true);
  assert.ok(r.recommendations.some(rec => rec.priority === "urgente" || rec.priority === "imediata"));
});

// ─── Cenário 4: Crítico ───────────────────────────────────────────────────────
console.log("\n📋 Cenário 4 — Risco crítico");

const CRITICAL_INPUT: RiskInput = DEMO_SCENARIOS.crítico.input;

test("Cenário crítico: score deve estar entre 75 e 100", () => {
  const r = calculateRisk(CRITICAL_INPUT, true);
  assert.ok(r.score >= 75 && r.score <= 100, `Score foi ${r.score}, esperado 75–100`);
});

test("Cenário crítico: nível deve ser 'crítico'", () => {
  const r = calculateRisk(CRITICAL_INPUT, true);
  assert.equal(r.level, "crítico");
});

test("Cenário crítico: deve ter recomendação imediata", () => {
  const r = calculateRisk(CRITICAL_INPUT, true);
  assert.ok(r.recommendations.some(rec => rec.priority === "imediata"), "Deve ter ação imediata");
});

test("Cenário crítico: deve ter múltiplos fatores identificados", () => {
  const r = calculateRisk(CRITICAL_INPUT, true);
  assert.ok(r.factors.length >= 3, `Esperado ≥3 fatores, encontrado ${r.factors.length}`);
});

// ─── Determinismo ─────────────────────────────────────────────────────────────
console.log("\n📋 Estabilidade e determinismo");

test("Motor é determinístico: mesma entrada produz mesmo score", () => {
  const r1 = calculateRisk(CRITICAL_INPUT, true);
  const r2 = calculateRisk(CRITICAL_INPUT, true);
  assert.equal(r1.score, r2.score, "Scores devem ser idênticos para mesma entrada");
  assert.equal(r1.level, r2.level);
});

test("Score mínimo nunca é negativo", () => {
  const zeroRisk: RiskInput = { temperature: 15, humidity: 95, windSpeed: 0, recentRainfall: 50, vegetationCondition: 3, nearbyHotspot: false, hotspotDistance: 0, historicalOccurrences: 0, dataQuality: 3 };
  const r = calculateRisk(zeroRisk, true);
  assert.ok(r.score >= 0, `Score negativo: ${r.score}`);
});

test("Score máximo nunca excede 100", () => {
  const maxRisk: RiskInput = { temperature: 50, humidity: 5, windSpeed: 100, recentRainfall: 0, vegetationCondition: 0, nearbyHotspot: true, hotspotDistance: 1, historicalOccurrences: 20, dataQuality: 3 };
  const r = calculateRisk(maxRisk, true);
  assert.ok(r.score <= 100, `Score excedeu 100: ${r.score}`);
});

test("calculationVersion está presente no resultado", () => {
  const r = calculateRisk(LOW_INPUT, true);
  assert.ok(r.calculationVersion && r.calculationVersion.length > 0);
});

test("calculatedAt é um ISO 8601 válido", () => {
  const r = calculateRisk(LOW_INPUT, false);
  const d = new Date(r.calculatedAt);
  assert.ok(!isNaN(d.getTime()), "calculatedAt inválido");
});

test("isSimulated é preservado corretamente", () => {
  const simulated = calculateRisk(LOW_INPUT, true);
  const real = calculateRisk(LOW_INPUT, false);
  assert.equal(simulated.isSimulated, true);
  assert.equal(real.isSimulated, false);
});

// ─── Entradas inválidas ───────────────────────────────────────────────────────
console.log("\n📋 Validação de entradas");

test("Deve lançar erro se temperatura estiver ausente", () => {
  const invalid = { ...LOW_INPUT, temperature: undefined as any };
  assert.throws(() => calculateRisk(invalid, true), /temperatura/i);
});

test("Deve lançar erro se umidade for maior que 100", () => {
  const invalid = { ...LOW_INPUT, humidity: 150 };
  assert.throws(() => calculateRisk(invalid, true), /umidade/i);
});

test("Deve lançar erro se umidade for negativa", () => {
  const invalid = { ...LOW_INPUT, humidity: -5 };
  assert.throws(() => calculateRisk(invalid, true), /umidade/i);
});

test("Deve lançar erro se vento for negativo", () => {
  const invalid = { ...LOW_INPUT, windSpeed: -10 };
  assert.throws(() => calculateRisk(invalid, true), /vento/i);
});

test("Deve lançar erro se vegetationCondition for inválido", () => {
  const invalid = { ...LOW_INPUT, vegetationCondition: 5 as any };
  assert.throws(() => calculateRisk(invalid, true), /vegeta/i);
});

test("validateRiskInput: retorna erros para entrada vazia", () => {
  const result = validateRiskInput({});
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validateRiskInput: retorna válido para cenário correto", () => {
  const result = validateRiskInput(LOW_INPUT);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

// ─── scoreToLevel ─────────────────────────────────────────────────────────────
console.log("\n📋 Classificação de nível");

test("scoreToLevel(0) = 'baixo'",    () => assert.equal(scoreToLevel(0), "baixo"));
test("scoreToLevel(24) = 'baixo'",   () => assert.equal(scoreToLevel(24), "baixo"));
test("scoreToLevel(25) = 'moderado'",() => assert.equal(scoreToLevel(25), "moderado"));
test("scoreToLevel(49) = 'moderado'",() => assert.equal(scoreToLevel(49), "moderado"));
test("scoreToLevel(50) = 'alto'",    () => assert.equal(scoreToLevel(50), "alto"));
test("scoreToLevel(74) = 'alto'",    () => assert.equal(scoreToLevel(74), "alto"));
test("scoreToLevel(75) = 'crítico'", () => assert.equal(scoreToLevel(75), "crítico"));
test("scoreToLevel(100) = 'crítico'",() => assert.equal(scoreToLevel(100), "crítico"));

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Resultado: ${passed} passaram · ${failed} falharam`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("✅ Todos os testes passaram!\n");
}
