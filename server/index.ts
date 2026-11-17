import { createApp, logJson } from "./app";
import { startScheduler, stopScheduler } from "./services/scheduler";
import { startTelemetry, stopTelemetry } from "./services/ops-telemetry";
import { serveStatic } from "./static";
import { runMigrations } from "./migrate";

export function log(message: string, source = "express") {
  logJson({ level: "info", source, msg: message });
}

(async () => {
  // Migrations: in the production stack a one-shot `migrate` service applies
  // them with the owner role (RUN_MIGRATIONS_ON_START=false here), and the API
  // only verifies that nothing is pending. In development they run on start.
  try {
    if (process.env.RUN_MIGRATIONS_ON_START === "false") {
      const pending = await runMigrations({ dryRun: true });
      if (pending.length) throw new Error(`migrações pendentes: ${pending.join(", ")}`);
    } else {
      await runMigrations();
    }
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
  httpServer.listen({ port, host }, () => { log(`serving on ${host}:${port}`); startScheduler(); startTelemetry(); });

  const shutdown = (signal: string) => {
    log(`${signal} received, shutting down`);
    stopScheduler();
    void stopTelemetry();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
