import fs from "node:fs";
import path from "node:path";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

/**
 * Loads variables from the project's .env file into process.env (without
 * overriding variables already defined by the shell or the hosting panel).
 */
const loadDotenv = () => {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;

    const [key, ...valueParts] = line.split("=");
    if (!key || valueParts.length === 0) continue;

    const rawValue = valueParts.join("=").trim();
    const value = rawValue.replace(/^(["'])(.*)\1$/, "$2");

    if (!process.env[key.trim()]) {
      process.env[key.trim()] = value;
    }
  }
};

const getDatabaseUrl = (): string => {
  loadDotenv();

  // Prefer Supabase URL when set — it persists across deployments
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL?.trim();
  if (supabaseUrl && supabaseUrl.includes("://")) {
    return supabaseUrl;
  }

  const url = process.env.DATABASE_URL?.trim() || "";
  if (url.includes("://")) return url;

  const host = process.env.PGHOST || "localhost";
  const port = process.env.PGPORT || "5432";
  const user = process.env.PGUSER || "postgres";
  const password = process.env.PGPASSWORD || "";
  const database = process.env.PGDATABASE || "postgres";
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
};

const databaseUrl = getDatabaseUrl();

const poolConfig: pg.PoolConfig & { family?: number } = {
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
};

if (databaseUrl && (databaseUrl.includes("supabase.co") || process.env.PGSSLMODE === "require")) {
  poolConfig.ssl = { rejectUnauthorized: false };
  poolConfig.family = 4;
}

// Log host (no credentials) for diagnostics
try {
  const u = new URL(databaseUrl);
  console.log(`[db] connecting to ${u.hostname}:${u.port || 5432}`);
} catch { /* ignore */ }

const createFallbackDb = () => {
  const error = new Error("Database not configured: using in-memory fallback");
  const handler: ProxyHandler<any> = {
    get() {
      return () => Promise.reject(error);
    },
  };
  return new Proxy({}, handler) as any;
};

export const pool = databaseUrl ? new Pool(poolConfig) : undefined;

// Idle clients can lose their connection (DB restart, network hiccup). Without
// this listener the "error" event would crash the whole Node process.
pool?.on("error", (err) => {
  console.warn("[db] Conexão ociosa com o PostgreSQL encerrada:", err.message);
});

export const db: NodePgDatabase<typeof schema> = databaseUrl
  ? drizzle(pool as pg.Pool, { schema })
  : createFallbackDb();

// Error codes that mean "the database cannot be reached" (Node network errors
// and PostgreSQL connection/authentication SQLSTATE codes). Any other error —
// constraint violations, bad input, etc. — is a normal query error.
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN",
  "EHOSTUNREACH", "ENETUNREACH", "EPIPE",
  "08000", "08001", "08003", "08004", "08006", // connection_exception
  "57P01", "57P02", "57P03",                   // server shutting down / not accepting connections
  "3D000",                                     // database does not exist
  "28000", "28P01",                            // invalid authorization / password
]);

/** True when the error means the database could not be reached at all. */
export function isConnectionError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const err = error as { code?: unknown; message?: unknown; errors?: unknown; cause?: unknown };
  if (typeof err.code === "string" && CONNECTION_ERROR_CODES.has(err.code)) return true;
  if (Array.isArray(err.errors) && err.errors.some((e) => isConnectionError(e, depth + 1))) return true;
  if (err.cause && isConnectionError(err.cause, depth + 1)) return true;
  const message = typeof err.message === "string" ? err.message : "";
  return /Database not configured|Connection terminated|timeout exceeded when trying to connect|connection timeout/i.test(message);
}
