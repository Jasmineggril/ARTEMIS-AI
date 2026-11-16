import { createApp, logJson } from "./app";
import { serveStatic } from "./static";
import { runMigrations } from "./migrate";

export function log(message: string, source = "express") {
  logJson({ level: "info", source, msg: message });
}

(async () => {
  // Apply pending migrations on startup. In production a failure is fatal:
  // the API must not run against an outdated schema.
  try {
    await runMigrations();
  } catch (err) {
    console.error("[migrate] failed:", err instanceof Error ? err.message : err);
    if (process.env.NODE_ENV === "production") process.exit(1);
  }

  const { app, httpServer } = await createApp();

  if (process.env.NODE_ENV === "production") {
    if (process.env.SERVE_STATIC !== "false") serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen({ port, host }, () => log(`serving on ${host}:${port}`));

  const shutdown = (signal: string) => {
    log(`${signal} received, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
