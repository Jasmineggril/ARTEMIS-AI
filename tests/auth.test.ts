/**
 * Testes de autenticação — hashPassword / verifyPassword
 *
 * Cobertura:
 *  1. signup cria um hash bcrypt válido
 *  2. login com senha correta (bcrypt) retorna true
 *  3. login com senha errada (bcrypt) retorna false
 *  4. hash SHA-256 legado é aceito e atualizado para bcrypt
 *
 * Execute com: npm run test:auth
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword } from "../server/auth.ts";

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

console.log("\n🔐 Testes de Autenticação\n");

// ── 1. signup cria hash bcrypt ────────────────────────────────────────────────
console.log("📋 hashPassword");

await test("cria um hash bcrypt ($2b$ prefix)", async () => {
  const hash = await hashPassword("minhasenha123");
  assert.ok(hash.startsWith("$2"), `hash deve começar com $2, recebeu: ${hash}`);
});

await test("hash não contém a senha em texto plano", async () => {
  const password = "minhasenha123";
  const hash = await hashPassword(password);
  assert.ok(!hash.includes(password));
});

await test("hashes distintos para a mesma senha (salt aleatório)", async () => {
  const hash1 = await hashPassword("mesmasenha");
  const hash2 = await hashPassword("mesmasenha");
  assert.notEqual(hash1, hash2);
});

// ── 2. login com bcrypt correto ───────────────────────────────────────────────
console.log("\n📋 verifyPassword — bcrypt");

await test("senha correta retorna true", async () => {
  const hash = await hashPassword("senha_correta");
  const result = await verifyPassword("senha_correta", hash, 1);
  assert.equal(result, true);
});

await test("senha errada retorna false", async () => {
  const hash = await hashPassword("senha_correta");
  const result = await verifyPassword("senha_errada", hash, 1);
  assert.equal(result, false);
});

await test("string vazia retorna false", async () => {
  const hash = await hashPassword("senha_correta");
  const result = await verifyPassword("", hash, 1);
  assert.equal(result, false);
});

// ── 3. hash SHA-256 legado ────────────────────────────────────────────────────
console.log("\n📋 verifyPassword — SHA-256 legado");

await test("hash SHA-256 correto retorna true", async () => {
  const password = "senhalegada";
  const sha256 = crypto.createHash("sha256").update(password).digest("hex");
  const result = await verifyPassword(password, sha256, 42);
  assert.equal(result, true);
});

await test("hash SHA-256 errado retorna false", async () => {
  const sha256 = crypto.createHash("sha256").update("outrasenha").digest("hex");
  const result = await verifyPassword("senhaerrada", sha256, 42);
  assert.equal(result, false);
});

await test("após validação SHA-256, upgradeHash é chamado com hash bcrypt", async () => {
  const password = "senhalegada";
  const sha256 = crypto.createHash("sha256").update(password).digest("hex");

  let upgradedUserId: number | null = null;
  let upgradedHash: string | null = null;

  await verifyPassword(password, sha256, 99, async (userId, newHash) => {
    upgradedUserId = userId;
    upgradedHash = newHash;
  });

  assert.equal(upgradedUserId, 99);
  assert.ok(upgradedHash !== null, "novo hash não deve ser null");
  assert.ok(
    (upgradedHash as string).startsWith("$2"),
    `hash atualizado deve ser bcrypt, recebeu: ${upgradedHash}`,
  );

  // Confirma que o novo hash bcrypt valida a mesma senha
  const valid = await bcrypt.compare(password, upgradedHash as string);
  assert.equal(valid, true, "hash atualizado deve validar a senha original");
});

await test("falha no upgradeHash não propaga erro", async () => {
  const password = "senhalegada";
  const sha256 = crypto.createHash("sha256").update(password).digest("hex");

  const result = await verifyPassword(password, sha256, 99, async () => {
    throw new Error("DB indisponível");
  });

  // verifyPassword ainda retorna true mesmo quando o upgrade falha
  assert.equal(result, true);
});

// ── Resultado ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Resultado: ${passed} passou, ${failed} falhou\n`);

if (failed > 0) {
  process.exit(1);
}
