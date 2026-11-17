/**
 * ARTEMIS AI — Express application factory (shared by the Node server and
 * the integration tests).
 */
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { requestMetrics } from "./services/ops-telemetry";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createServer, type Server } from "http";
import { pool } from "./db";
import { registerRoutes } from "./routes";
import { securityHeaders, originCheck } from "./security";

declare module "express-session" {
  interface SessionData {
    userId: number;
    email: string;
    name: string;
    organizationId: number;
  }
}

export function resolveSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret.length < 32) {
      throw new Error("SESSION_SECRET ausente ou curto (mín. 32 caracteres). Recusando iniciar em produção.");
    }
    return secret;
  }
  return secret || "artemis-dev-only-secret-not-for-production";
}

/** Structured JSON log line — never includes request/response bodies. */
export function logJson(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }));
}

export async function createApp(): Promise<{ app: Express; httpServer: Server }> {
  const app = express();
  const httpServer = createServer(app);
  const isProd = process.env.NODE_ENV === "production";

  // Behind Caddy/Nginx: trust the first proxy hop so req.ip / secure cookies work.
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? (isProd ? 1 : 0)));
  app.disable("x-powered-by");

  app.use(securityHeaders());
  app.use(requestMetrics());

  const PgSession = connectPgSimple(session);
  app.use(
    session({
      name: "artemis.sid",
      // table created by migration 0009 (runtime role has no CREATE privilege)
      store: pool ? new PgSession({ pool, createTableIfMissing: false }) : new session.MemoryStore(),
      secret: resolveSessionSecret(),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        maxAge: 8 * 60 * 60 * 1000, // 8 h, renewed on activity
        httpOnly: true,
        sameSite: "lax",
        secure: isProd && process.env.COOKIE_SECURE !== "false",
      },
    }),
  );

  app.use(originCheck());
  app.use(express.json({ limit: "15mb" })); // import batches of up to 50k rows
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) return next();
    const start = Date.now();
    res.on("finish", () => {
      logJson({
        level: res.statusCode >= 500 ? "error" : "info",
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
        user: req.session?.userId ?? null,
      });
    });
    next();
  });

  await registerRoutes(httpServer, app);

  app.use("/api", (_req, res) => res.status(404).json({ message: "Rota não encontrada." }));

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = Number(err.status || err.statusCode) || 500;
    logJson({ level: "error", msg: "unhandled_error", path: req.path, status, err: String(err?.stack ?? err) });
    if (res.headersSent) return;
    // Never leak internal error messages on 5xx.
    res.status(status).json({ message: status >= 500 ? "Erro interno. Tente novamente mais tarde." : err.message });
  });

  return { app, httpServer };
}
