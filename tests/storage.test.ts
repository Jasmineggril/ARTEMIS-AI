/**
 * Testes do armazenamento — quando usar o fallback em memória
 *
 * Cobertura:
 *  1. isConnectionError distingue "banco inacessível" de erros comuns de consulta
 *  2. Banco inacessível desde o início → usa o armazenamento em memória
 *  3. Erro de consulta (ex.: violação de restrição) → o erro é propagado e o
 *     servidor continua usando o banco (antes, qualquer erro trocava o servidor
 *     inteiro para memória e os usuários "sumiam")
 *  4. Banco que já respondeu e falha depois → erro propagado, sem trocar de armazenamento
 *
 * Execute com: npm run test:storage
 */

import assert from "node:assert/strict";
import { isConnectionError } from "../server/db.ts";
import { DatabaseStorage } from "../server/storage.ts";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function errorWithCode(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

type Runner = <T>(operation: () => Promise<T>, fallback: () => T) => Promise<T>;
const runnerOf = (storage: DatabaseStorage): Runner =>
  (storage as unknown as { runWithFallback: Runner }).runWithFallback.bind(storage);

console.log("\n🗄️  Testes de Armazenamento\n");

console.log("📋 isConnectionError");

await test("ECONNREFUSED é erro de conexão", async () => {
  assert.equal(isConnectionError(errorWithCode("ECONNREFUSED")), true);
});

await test("AggregateError com ECONNREFUSED (IPv4 + IPv6) é erro de conexão", async () => {
  const agg = new AggregateError([errorWithCode("ECONNREFUSED"), errorWithCode("ECONNREFUSED")], "connect failed");
  assert.equal(isConnectionError(agg), true);
});

await test("erro encapsulado (cause) com ENOTFOUND é erro de conexão", async () => {
  const wrapped = new Error("Failed query", { cause: errorWithCode("ENOTFOUND") });
  assert.equal(isConnectionError(wrapped), true);
});

await test("timeout ao conectar é erro de conexão", async () => {
  assert.equal(isConnectionError(new Error("timeout exceeded when trying to connect")), true);
});

await test("senha inválida do PostgreSQL (28P01) é erro de conexão", async () => {
  assert.equal(isConnectionError(errorWithCode("28P01", "password authentication failed")), true);
});

await test("violação de unicidade (23505) NÃO é erro de conexão", async () => {
  assert.equal(isConnectionError(errorWithCode("23505", "duplicate key value violates unique constraint")), false);
});

await test("NOT NULL violado (23502) NÃO é erro de conexão", async () => {
  assert.equal(isConnectionError(errorWithCode("23502", 'null value in column "user_id" violates not-null constraint')), false);
});

await test("valores que não são erros NÃO são erros de conexão", async () => {
  assert.equal(isConnectionError(undefined), false);
  assert.equal(isConnectionError("ECONNREFUSED"), false);
});

console.log("\n📋 DatabaseStorage.runWithFallback");

await test("banco inacessível desde o início → usa memória", async () => {
  const storage = new DatabaseStorage();
  const result = await runnerOf(storage)(() => Promise.reject(errorWithCode("ECONNREFUSED")), () => "memória");
  assert.equal(result, "memória");
  assert.equal(storage.isFallbackActive(), true);
});

await test("erro de consulta é propagado e NÃO ativa a memória", async () => {
  const storage = new DatabaseStorage();
  await assert.rejects(
    runnerOf(storage)(() => Promise.reject(errorWithCode("23502", "not-null violation")), () => "memória"),
    /not-null violation/,
  );
  assert.equal(storage.isFallbackActive(), false);
});

await test("banco que já respondeu e cai depois → erro propagado, sem trocar de armazenamento", async () => {
  const storage = new DatabaseStorage();
  const run = runnerOf(storage);
  assert.equal(await run(() => Promise.resolve("banco"), () => "memória"), "banco");
  await assert.rejects(run(() => Promise.reject(errorWithCode("ECONNRESET")), () => "memória"));
  assert.equal(storage.isFallbackActive(), false);
});

console.log(`\n${"─".repeat(50)}`);
console.log(`Resultado: ${passed} passou, ${failed} falhou\n`);

if (failed > 0) {
  process.exit(1);
}
