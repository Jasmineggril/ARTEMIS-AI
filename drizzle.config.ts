import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";
import { resolveDatabaseUrl } from "./server/db-url";

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

// Same precedence as the server (DATABASE_URL > PG* > legacy Supabase). See server/db-url.ts.
const resolved = resolveDatabaseUrl();
resolved.warnings.forEach((w) => console.warn(`[drizzle] ${w}`));
const dbUrl = resolved.url;

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
    ssl: dbUrl.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
  },
});
