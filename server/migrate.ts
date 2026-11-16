import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { pool as appPool } from "./db";

const sha256 = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Refuses a migrations directory that could silently corrupt the schema:
 * two files with the same number (e.g. branches that each added their own
 * 0004_*), a byte-order mark, or text double-encoded as Latin-1
 * ("concluÃ­do"), which would end up inside DEFAULT values.
 */
export function checkMigrationFiles(dir: string, files: string[]): void {
  const byNumber = new Map<string, string[]>();
  for (const f of files) {
    const n = f.match(/^(\d+)_/)?.[1];
    if (!n) throw new Error(`[migrate] Nome fora do padrão NNNN_descricao.sql: ${f}`);
    byNumber.set(n, [...(byNumber.get(n) ?? []), f]);
  }
  const dup = Array.from(byNumber.values()).filter((v) => v.length > 1);
  if (dup.length) throw new Error(`[migrate] Numeração duplicada: ${dup.map((d) => d.join(" + ")).join("; ")}. Renumere antes de aplicar.`);
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    if (text.charCodeAt(0) === 0xfeff) throw new Error(`[migrate] ${f} começa com BOM; salve em UTF-8 sem BOM.`);
    if (/Ã[¡-ÿ]|â€/.test(text)) throw new Error(`[migrate] ${f} contém texto com codificação corrompida (ex.: "Ã¡"); restaure a versão UTF-8.`);
  }
}

/** Fails if an applied migration file was edited afterwards (set MIGRATION_ALLOW_CHANGED=1 to only warn). */
export function compareChecksums(dir: string, applied: { name: string; checksum: string | null }[]): string[] {
  const changed: string[] = [];
  for (const a of applied) {
    const file = path.join(dir, a.name);
    if (!a.checksum || !fs.existsSync(file)) continue;
    if (sha256(fs.readFileSync(file, "utf8")) !== a.checksum) changed.push(a.name);
  }
  if (changed.length) {
    const msg = `[migrate] Migração já aplicada foi alterada depois: ${changed.join(", ")}. Crie uma nova migração em vez de editar.`;
    if (process.env.MIGRATION_ALLOW_CHANGED === "1") console.warn(msg);
    else throw new Error(msg);
  }
  return changed;
}

/**
 * Runs all pending SQL migrations from the ./migrations directory.
 * Tracks applied migrations in a `_drizzle_migrations` table.
 * Safe to call on every startup — already-applied migrations are skipped.
 */
export interface MigrateOptions {
  /** Apply only up to and including this file (tests / staged rollout). */
  upTo?: string;
  /** Only report pending migrations, change nothing. */
  dryRun?: boolean;
}

export async function runMigrations(opts: MigrateOptions = {}): Promise<string[]> {
  // Migrations may run with a different (owner) role than the application.
  const ownPool = process.env.MIGRATION_DATABASE_URL
    ? new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 })
    : null;
  const pool = ownPool ?? appPool;
  if (!pool) {
    console.warn("[migrate] No database pool — skipping migrations");
    return [];
  }

  const client = await pool.connect();
  try {
    // Read-only check (runtime role has no CREATE privilege): never issue DDL here.
    if (opts.dryRun) {
      const { rows: [t] } = await client.query(`SELECT to_regclass('public._drizzle_migrations') AS t`);
      const migrationsDir = path.resolve(process.cwd(), "migrations");
      const files = fs.existsSync(migrationsDir)
        ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort().filter((f) => !opts.upTo || f <= opts.upTo)
        : [];
      checkMigrationFiles(migrationsDir, files);
      let appliedRows: { name: string; checksum: string | null }[] = [];
      if (t?.t) {
        const { rows: [c] } = await client.query(`SELECT 1 AS ok FROM information_schema.columns WHERE table_name = '_drizzle_migrations' AND column_name = 'checksum'`);
        appliedRows = (await client.query(c ? `SELECT name, checksum FROM "_drizzle_migrations"` : `SELECT name, NULL AS checksum FROM "_drizzle_migrations"`)).rows;
      }
      compareChecksums(migrationsDir, appliedRows);
      const applied = new Set(appliedRows.map((r) => r.name));
      const pending = files.filter((f) => !applied.has(f));
      console.log(pending.length ? `[migrate] pendentes: ${pending.join(", ")}` : "[migrate] nenhuma migração pendente");
      return pending;
    }

    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_drizzle_migrations" (
        id serial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        applied_at timestamp DEFAULT now()
      )
    `);

    const migrationsDir = path.resolve(process.cwd(), "migrations");
    if (!fs.existsSync(migrationsDir)) {
      console.log("[migrate] No migrations directory found — skipping");
      return [];
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => !opts.upTo || f <= opts.upTo);

    if (files.length === 0) {
      console.log("[migrate] No migration files found");
      return [];
    }

    checkMigrationFiles(migrationsDir, files);
    const { rows: [hasChecksum] } = await client.query(
      `SELECT 1 AS ok FROM information_schema.columns WHERE table_name = '_drizzle_migrations' AND column_name = 'checksum'`
    );
    if (!hasChecksum) await client.query(`ALTER TABLE "_drizzle_migrations" ADD COLUMN "checksum" text`);

    // Fetch already-applied migrations
    const { rows: applied } = await client.query(
      `SELECT name, checksum FROM "_drizzle_migrations"`
    );
    compareChecksums(migrationsDir, applied);
    // Record checksums of migrations applied before tracking existed (trust on first use).
    for (const a of applied as { name: string; checksum: string | null }[]) {
      const file = path.join(migrationsDir, a.name);
      if (!a.checksum && fs.existsSync(file)) {
        await client.query(`UPDATE "_drizzle_migrations" SET checksum = $1 WHERE name = $2`, [sha256(fs.readFileSync(file, "utf8")), a.name]);
      }
    }
    const appliedSet = new Set(applied.map((r: { name: string }) => r.name));

    let count = 0;
    const pending = files.filter((f) => !appliedSet.has(f));
    if (opts.dryRun) {
      console.log(pending.length ? `[migrate] pendentes: ${pending.join(", ")}` : "[migrate] nenhuma migração pendente");
      return pending;
    }
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      console.log(`[migrate] Applying ${file}…`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

      // drizzle-kit uses --> statement-breakpoint as separator
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      await client.query("BEGIN");
      try {
        for (const statement of statements) {
          await client.query(statement);
        }
        await client.query(
          `INSERT INTO "_drizzle_migrations" (name, checksum) VALUES ($1, $2)`,
          [file, sha256(sql)]
        );
        await client.query("COMMIT");
        console.log(`[migrate] ✓ ${file}`);
        count++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${file} failed: ${err instanceof Error ? err.message : err}`
        );
      }
    }

    if (count === 0) {
      console.log("[migrate] All migrations already applied");
    } else {
      console.log(`[migrate] Applied ${count} migration(s)`);
    }
    return pending;
  } finally {
    client.release();
    await ownPool?.end();
  }
}
