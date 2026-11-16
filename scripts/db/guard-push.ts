/**
 * Guard for `drizzle-kit push`: it applies schema diffs directly (it can drop
 * or alter columns) and is allowed ONLY against a local development database.
 * Use `npm run db:migrate` with reviewed SQL files for anything else.
 */
import { resolveDatabaseUrl, describeDbUrl } from "../../server/db-url";

const { url } = resolveDatabaseUrl();
const host = new URL(url).hostname;
const local = ["localhost", "127.0.0.1", "::1"].includes(host);
if (process.env.NODE_ENV === "production" || !local) {
  console.error(`[db:push] BLOQUEADO para ${describeDbUrl(url)}. Use migrações versionadas: npm run db:migrate`);
  process.exit(1);
}
console.warn(`[db:push] permitido apenas em desenvolvimento local (${describeDbUrl(url)}).`);
