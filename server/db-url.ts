/**
 * ARTEMIS AI — single source of truth for the PostgreSQL connection string.
 * Used by server/db.ts and drizzle.config.ts.
 *
 * Precedence (first match wins):
 *   1. DATABASE_URL                       — recommended (VPS: postgresql://artemis_app:…@db:5432/artemis_ai)
 *   2. PGHOST (+ PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
 *   3. SUPABASE_DATABASE_URL              — LEGACY. Ignored whenever 1 or 2 is set. In production it
 *                                           is refused unless ALLOW_LEGACY_SUPABASE=true, so an old
 *                                           variable can never silently redirect production.
 *   4. development only: postgresql://localhost:5432/artemis_ai
 *
 * Never logs credentials: `describe()` returns host, port and database only.
 */

export type DbUrlOrigin = "DATABASE_URL" | "PG*" | "SUPABASE_DATABASE_URL" | "default-dev";

export interface ResolvedDbUrl {
  url: string;
  origin: DbUrlOrigin;
  warnings: string[];
}

type Env = Record<string, string | undefined>;

export function resolveDatabaseUrl(env: Env = process.env): ResolvedDbUrl {
  const warnings: string[] = [];
  const isProd = env.NODE_ENV === "production";
  const databaseUrl = env.DATABASE_URL?.trim();
  const supabaseUrl = env.SUPABASE_DATABASE_URL?.trim();

  if (databaseUrl && databaseUrl.includes("://")) {
    if (supabaseUrl) warnings.push("SUPABASE_DATABASE_URL definida, mas IGNORADA porque DATABASE_URL tem prioridade.");
    return { url: databaseUrl, origin: "DATABASE_URL", warnings };
  }

  if (env.PGHOST?.trim()) {
    if (supabaseUrl) warnings.push("SUPABASE_DATABASE_URL definida, mas IGNORADA porque PGHOST tem prioridade.");
    const host = env.PGHOST.trim();
    const port = env.PGPORT?.trim() || "5432";
    const user = encodeURIComponent(env.PGUSER?.trim() || "artemis_app");
    const password = env.PGPASSWORD ? `:${encodeURIComponent(env.PGPASSWORD)}` : "";
    const database = encodeURIComponent(env.PGDATABASE?.trim() || "artemis_ai");
    return { url: `postgresql://${user}${password}@${host}:${port}/${database}`, origin: "PG*", warnings };
  }

  if (supabaseUrl && supabaseUrl.includes("://")) {
    if (isProd && env.ALLOW_LEGACY_SUPABASE !== "true") {
      throw new Error(
        "Somente SUPABASE_DATABASE_URL está definida. Em produção defina DATABASE_URL (PostgreSQL da VPS) " +
          "ou, se o uso do Supabase for intencional, ALLOW_LEGACY_SUPABASE=true.",
      );
    }
    warnings.push("Usando SUPABASE_DATABASE_URL (configuração legada). Prefira DATABASE_URL.");
    return { url: supabaseUrl, origin: "SUPABASE_DATABASE_URL", warnings };
  }

  if (isProd) {
    throw new Error("DATABASE_URL não definida. A aplicação não inicia em produção sem banco configurado.");
  }
  return { url: "postgresql://localhost:5432/artemis_ai", origin: "default-dev", warnings };
}

/** Safe description for logs: never includes user or password. */
export function describeDbUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return "(URL inválida)";
  }
}
