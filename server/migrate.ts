import fs from "node:fs";
import path from "node:path";
import { pool } from "./db";

/**
 * Runs all pending SQL migrations from the ./migrations directory.
 * Tracks applied migrations in a `_drizzle_migrations` table.
 * Safe to call on every startup — already-applied migrations are skipped.
 */
export async function runMigrations(): Promise<void> {
  if (!pool) {
    console.warn("[migrate] No database pool — skipping migrations");
    return;
  }

  const client = await pool.connect();
  try {
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
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("[migrate] No migration files found");
      return;
    }

    // Fetch already-applied migrations
    const { rows: applied } = await client.query(
      `SELECT name FROM "_drizzle_migrations"`
    );
    const appliedSet = new Set(applied.map((r: { name: string }) => r.name));

    let count = 0;
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
  } finally {
    client.release();
  }
}
