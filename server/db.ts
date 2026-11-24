import fs from "node:fs";
import path from "node:path";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { resolveDatabaseUrl, describeDbUrl } from "./db-url";

const { Pool } = pg;

const loadDotenv = () => {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const [key, ...valueParts] = line.split("=");
    if (!key || valueParts.length === 0) continue;

    const rawValue = valueParts.join("=").trim();
    const value = rawValue.replace(/^"|"$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};


loadDotenv();
const resolved = resolveDatabaseUrl();
resolved.warnings.forEach((w) => console.warn(`[db] ${w}`));
const databaseUrl = resolved.url;

const poolConfig: pg.PoolConfig & { family?: number } = {
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
};

if (databaseUrl && (databaseUrl.includes("supabase.co") || process.env.PGSSLMODE === "require")) {
  poolConfig.ssl = { rejectUnauthorized: false };
  poolConfig.family = 4;
}

// Log target without credentials
console.log(`[db] ${describeDbUrl(databaseUrl)} (origem: ${resolved.origin})`);

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
export const db: NodePgDatabase<typeof schema> = databaseUrl
  ? drizzle(pool as pg.Pool, { schema })
  : (createFallbackDb() as NodePgDatabase<typeof schema>);
