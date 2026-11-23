import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { isConnectionError } from "./db";
import { runMigrations } from "./migrate";
import { createSessionMiddleware } from "./session";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Behind a reverse proxy (Hostinger, Nginx, Vercel…) this makes req.secure /
// req.protocol reflect the original HTTPS request, needed for secure cookies.
app.set("trust proxy", 1);

// gzip responses — the JS bundle shrinks ~70%, which matters a lot on mobile.
app.use(compression());

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function registerBodyParsers() {
  const verify = (req: any, _res: unknown, buf: Buffer) => {
    req.rawBody = buf;
  };
  const jsonParser = express.json({ limit: "1mb", verify });
  // Imports send every parsed row of a file of up to 10 MB in one request.
  const importJsonParser = express.json({ limit: "30mb" });

  app.use((req, res, next) =>
    req.path === "/api/import-batches" ? importJsonParser(req, res, next) : jsonParser(req, res, next),
  );
  app.use(express.urlencoded({ extended: false }));
}

function registerRequestLogger() {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: unknown = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        // Don't log credentials/personal data and keep big payloads out of the log.
        if (capturedJsonResponse !== undefined && !path.startsWith("/api/auth")) {
          const body = JSON.stringify(capturedJsonResponse) ?? "";
          logLine += ` :: ${body.length > 200 ? `${body.slice(0, 200)}…` : body}`;
        }
        log(logLine);
      }
    });

    next();
  });
}

(async () => {
  // Apply any pending DB migrations on startup (runs automatically on deployment)
  let databaseAvailable = true;
  try {
    await runMigrations();
  } catch (err) {
    databaseAvailable = !isConnectionError(err);
    console.warn("[migrate] Migration skipped or failed:", err instanceof Error ? err.message : err);
    if (!databaseAvailable) {
      console.warn(
        "[db] PostgreSQL inacessível — o app vai rodar em modo demonstração, com dados em memória. " +
          "Confira a variável DATABASE_URL no arquivo .env.",
      );
    }
  }

  app.use(createSessionMiddleware({ useDatabase: databaseAvailable }));
  registerBodyParsers();
  registerRequestLogger();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error("Unhandled server error:", err);
    else console.warn(`[http] ${status}: ${err.message}`);

    // Client errors (bad JSON, payload too large…) keep their message; internal
    // errors get a generic one so database details are never exposed.
    let message = "Erro interno do servidor";
    if (status === 413) message = "Arquivo muito grande para ser enviado.";
    else if (status < 500) message = err.expose && err.message ? err.message : "Requisição inválida";
    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Serve the app on the port specified in the environment variable PORT
  // (default 5000). This serves both the API and the client.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n[server] A porta ${port} já está em uso. Feche o outro programa ou rode com outra porta, ` +
          `por exemplo definindo PORT=3000 no arquivo .env.\n` +
          `(No macOS, a porta 5000 costuma ser usada pelo "Receptor AirPlay".)\n`,
      );
    } else {
      console.error("[server] Falha ao iniciar o servidor:", err);
    }
    process.exit(1);
  });

  httpServer.listen({ port, host }, () => {
    log(`serving on port ${port}`);
    if (process.env.NODE_ENV !== "production") {
      log(`abra http://localhost:${port} no navegador`);
    }
  });
})();
