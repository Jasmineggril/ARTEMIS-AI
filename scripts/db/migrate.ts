/**
 * Versioned migrations (the only supported way to change the schema).
 *   npm run db:status            -> list pending migrations, change nothing (alias: --dry-run)
 *   npm run db:migrate           -> apply pending migrations (each in its own transaction)
 * Production: take a backup first (scripts/ops/backup.sh) and apply only after approval.
 */
import { runMigrations } from "../../server/migrate";
import { pool } from "../../server/db";

const args = process.argv.slice(2);
const unknown = args.filter((a) => !["--status", "--dry-run"].includes(a));
if (unknown.length) {
  // Never fall through to "apply" because a flag was mistyped.
  console.error(`[migrate] Opção desconhecida: ${unknown.join(" ")}. Use --status (ou --dry-run) para só listar.`);
  process.exit(2);
}
const dryRun = args.includes("--status") || args.includes("--dry-run");
runMigrations({ dryRun })
  .then(() => pool?.end())
  .catch(async (e) => {
    console.error("[migrate] FALHOU — nada desta migração foi aplicado:", e instanceof Error ? e.message : e);
    await pool?.end();
    process.exit(1);
  });
