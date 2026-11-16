import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkMigrationFiles } from "../../server/migrate";

function dir(files: Record<string, string | Buffer>) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c);
  return { d, names: Object.keys(files).sort() };
}

test("the repository's own migrations pass the guard", () => {
  const d = path.resolve("migrations");
  checkMigrationFiles(d, fs.readdirSync(d).filter((f) => f.endsWith(".sql")).sort());
});

test("two branches each adding their own 0004 are refused before anything runs", () => {
  const { d, names } = dir({ "0004_integrity.sql": "select 1;", "0004_integrity_indexes.sql": "select 1;" });
  assert.throws(() => checkMigrationFiles(d, names), /Numeração duplicada: 0004_integrity.sql \+ 0004_integrity_indexes.sql/);
});

test("BOM and Latin-1 double-encoded text (e.g. 'concluÃ­do') are refused", () => {
  const bom = dir({ "0001_a.sql": "﻿select 1;" });
  assert.throws(() => checkMigrationFiles(bom.d, bom.names), /BOM/);
  const moji = dir({ "0001_a.sql": "ALTER TABLE x ALTER COLUMN s SET DEFAULT 'concluÃ­do';" });
  assert.throws(() => checkMigrationFiles(moji.d, moji.names), /codificação corrompida/);
  const ok = dir({ "0001_a.sql": "-- ARTEMIS AI — 'concluído', 'válido', ROI do Sisfogo" });
  checkMigrationFiles(ok.d, ok.names);
});

test("file names must follow NNNN_name.sql", () => {
  const { d, names } = dir({ "fix.sql": "select 1;" });
  assert.throws(() => checkMigrationFiles(d, names), /fora do padrão/);
});

test("an applied migration edited afterwards is detected (fails unless MIGRATION_ALLOW_CHANGED=1)", async () => {
  const { compareChecksums } = await import("../../server/migrate");
  const crypto = await import("node:crypto");
  const { d } = dir({ "0001_a.sql": "select 1;" });
  const sum = crypto.createHash("sha256").update("select 1;", "utf8").digest("hex");
  assert.deepEqual(compareChecksums(d, [{ name: "0001_a.sql", checksum: sum }]), []);
  fs.writeFileSync(path.join(d, "0001_a.sql"), "select 2;");
  assert.throws(() => compareChecksums(d, [{ name: "0001_a.sql", checksum: sum }]), /já aplicada foi alterada depois: 0001_a.sql/);
  process.env.MIGRATION_ALLOW_CHANGED = "1";
  try {
    assert.deepEqual(compareChecksums(d, [{ name: "0001_a.sql", checksum: sum }]), ["0001_a.sql"]);
  } finally {
    delete process.env.MIGRATION_ALLOW_CHANGED;
  }
  assert.deepEqual(compareChecksums(d, [{ name: "0001_a.sql", checksum: null }]), [], "legacy rows without checksum are not judged");
});
