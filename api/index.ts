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
import { createServer } from "http";
import { isConnectionError } from "../server/db";
import { runMigrations } from "../server/migrate";
import { registerRoutes } from "../server/routes";
import { createSessionMiddleware } from "../server/session";

// Survive warm re-use: build the app once and reuse across invocations.
let initPromise: Promise<express.Express> | null = null;

async function buildApp(): Promise<express.Express> {
  const app = express();
  // createServer is only used so registerRoutes can return it; no listen() here.
  const httpServer = createServer(app);
  app.set("trust proxy", 1);

  let databaseAvailable = true;
  try {
    await runMigrations();
  } catch (err) {
    databaseAvailable = !isConnectionError(err);
    console.warn(
      "[migrate] skipped:",
      err instanceof Error ? err.message : err
    );
  }

  app.use(createSessionMiddleware({ useDatabase: databaseAvailable }));
  app.use(
    express.json({
      // Vercel itself limits request bodies to ~4.5 MB.
      limit: "5mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: false }));

  await registerRoutes(httpServer, app);

  // Generic error handler
  app.use(
    (err: any, _req: Request, res: Response, next: NextFunction) => {
      if (res.headersSent) return next(err);
      const status = err.status || err.statusCode || 500;
      if (status >= 500) console.error("Unhandled server error:", err);
      else console.warn(`[http] ${status}: ${err.message}`);
      let message = "Erro interno do servidor";
      if (status === 413) message = "Arquivo muito grande para ser enviado.";
      else if (status < 500) message = err.expose && err.message ? err.message : "Requisição inválida";
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
