import crypto from "crypto";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import createMemoryStore from "memorystore";
import { pool } from "./db";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function resolveSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    // A hard-coded fallback secret would let anyone forge session cookies.
    console.warn(
      "[session] SESSION_SECRET não definido — usando um segredo temporário. " +
        "Defina SESSION_SECRET nas variáveis de ambiente para manter os usuários logados após reinícios.",
    );
    return crypto.randomBytes(32).toString("hex");
  }
  return "ceres-ai-dev-secret";
}

/**
 * Session middleware shared by the Node server (server/index.ts) and the
 * Vercel function (api/index.ts). Sessions are stored in PostgreSQL when the
 * database is reachable, otherwise in memory (demo mode without a database).
 */
export function createSessionMiddleware({ useDatabase }: { useDatabase: boolean }) {
  let store: session.Store;
  if (useDatabase && pool) {
    const PgSession = connectPgSimple(session);
    store = new PgSession({ pool, createTableIfMissing: true });
  } else {
    const MemoryStore = createMemoryStore(session);
    store = new MemoryStore({ checkPeriod: 24 * 60 * 60 * 1000 });
  }

  return session({
    store,
    secret: resolveSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: SEVEN_DAYS_MS,
      httpOnly: true,
      sameSite: "lax",
      // "auto": Secure flag when the request arrived over HTTPS (requires "trust proxy").
      secure: "auto",
    },
  });
}
