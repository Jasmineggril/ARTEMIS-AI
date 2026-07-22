/**
 * Vercel serverless entry-point.
 *
 * Wraps the existing Express app as a single serverless function that handles
 * every /api/* request. The app is initialized once per cold start (lazy
 * singleton) so migrations and route registration run only on the first
 * invocation.
 *
 * Static frontend files are served by Vercel's CDN (see vercel.json).
 * The Python FastAPI service is not available on Vercel — the request handler
 * in server/routes.ts already falls back to the TypeScript risk engine when
 * the Python service is unreachable.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createServer } from "http";
import { pool } from "../server/db";
import { runMigrations } from "../server/migrate";
import { registerRoutes } from "../server/routes";

const PgSession = connectPgSimple(session);

// Survive warm re-use: build the app once and reuse across invocations.
let initPromise: Promise<express.Express> | null = null;

async function buildApp(): Promise<express.Express> {
  const app = express();
  // createServer is only used so registerRoutes can return it; no listen() here.
  const httpServer = createServer(app);

  const sessionStore = (() => {
    try {
      if (pool) return new PgSession({ pool, createTableIfMissing: true });
    } catch {
      /* fall through */
    }
    return new session.MemoryStore();
  })();

  const isProduction = process.env.NODE_ENV === "production";

  app.use(
    session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET || "ceres-ai-dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
      },
    })
  );

  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: false }));

  try {
    await runMigrations();
  } catch (err) {
    console.warn(
      "[migrate] skipped:",
      err instanceof Error ? err.message : err
    );
  }

  await registerRoutes(httpServer, app);

  // Generic error handler
  app.use(
    (err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error("Unhandled server error:", err);
      res.status(status).json({ message });
    }
  );

  return app;
}

function getApp(): Promise<express.Express> {
  if (!initPromise) initPromise = buildApp();
  return initPromise;
}

export default async function handler(req: Request, res: Response) {
  const app = await getApp();
  app(req, res);
}
