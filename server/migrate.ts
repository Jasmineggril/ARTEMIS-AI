import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { pool as appPool } from "./db";

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
      const applied = t?.t ? new Set((await client.query(`SELECT name FROM "_drizzle_migrations"`)).rows.map((r: { name: string }) => r.name)) : new Set<string>();
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

    // Fetch already-applied migrations
    const { rows: applied } = await client.query(
      `SELECT name FROM "_drizzle_migrations"`
    );
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
          `INSERT INTO "_drizzle_migrations" (name) VALUES ($1)`,
          [file]
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
