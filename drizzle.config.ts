import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

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

// Prefer Supabase URL — it persists across deployments
const dbUrl = process.env.SUPABASE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";

if (!dbUrl) {
  throw new Error("No database URL found. Set SUPABASE_DATABASE_URL or DATABASE_URL.");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
    ssl: dbUrl.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
  },
});
