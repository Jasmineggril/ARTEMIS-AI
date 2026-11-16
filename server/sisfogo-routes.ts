/**
 * Sisfogo connector status and manual synchronisation.
 *   GET  /api/connectors/sisfogo/status     any signed-in user: state, counts, last runs (no raw data)
 *   POST /api/admin/connectors/sisfogo/sync platform administrators only; starts a run in the
 *                                           background (202) or answers 409 if one is running.
 * The Sisfogo API is only READ; nothing is ever sent to the government system.
 */
import type { Express } from "express";
import { z } from "zod";
import { rateLimit, requireAuth, requirePlatformAdmin } from "./security";
import { audit } from "./services/audit";
import { syncSisfogo, sisfogoStatus, SisfogoBusyError } from "./services/sisfogo-sync";

const syncBody = z.object({ mode: z.enum(["incremental", "completa"]).default("incremental") }).strict();

/** Overridable in tests (fake fetch, no waits). */
export const sisfogoRouteDeps: { syncOptions: Parameters<typeof syncSisfogo>[0] } = { syncOptions: {} };

export function registerSisfogoRoutes(app: Express) {
  app.get("/api/connectors/sisfogo/status", requireAuth, async (_req, res, next) => {
    try {
      const s = await sisfogoStatus(15);
      if (!s) return res.status(404).json({ message: "Fonte Sisfogo não cadastrada." });
      res.setHeader("Cache-Control", "no-store");
      res.json(s);
    } catch (err) {
      next(err);
    }
  });

  app.post(
    "/api/admin/connectors/sisfogo/sync",
    rateLimit({ windowMs: 60_000, max: 3, key: "sisfogo-sync" }),
    requirePlatformAdmin,
    async (req, res, next) => {
      const parsed = syncBody.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Parâmetros inválidos.", issues: parsed.error.issues });
      const userId = req.session!.userId!;
      try {
        // Answer once the run is registered (202) or refused (409); the sync itself continues in background.
        const started = await new Promise<number>((resolve, reject) => {
          syncSisfogo({ ...sisfogoRouteDeps.syncOptions, mode: parsed.data.mode, trigger: "manual", triggeredBy: userId, onStarted: resolve })
            .then((r) => resolve(r.runId))
            .catch((err) => {
              // after the 202 this is the only place the error surfaces
              if (!(err instanceof SisfogoBusyError)) console.error(JSON.stringify({ time: new Date().toISOString(), level: "error", source: "sisfogo-roi", msg: "sync_crashed", err: String(err) }));
              reject(err);
            });
        });
        await audit(req, "sisfogo.sync.iniciada", { type: "source_sync_run", id: started }, { mode: parsed.data.mode });
        res.status(202).json({ runId: started, mode: parsed.data.mode, message: "Sincronização iniciada. Acompanhe o andamento nesta tela." });
      } catch (err) {
        if (err instanceof SisfogoBusyError) return res.status(409).json({ message: err.message });
        next(err);
      }
    },
  );
}
