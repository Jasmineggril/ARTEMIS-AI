/**
 * Evidence collected from real use (Proof of Value / TRL 7–9):
 *   POST  /api/alerts/:id/evaluation      analyst+: expert verdict on an alert
 *   POST  /api/feedback                   any signed-in user: problem / suggestion / praise / question
 *   POST  /api/sus                        any signed-in user: System Usability Scale (10 items)
 *   GET   /api/admin/feedback             platform admin
 *   PATCH /api/admin/feedback/:id         platform admin: status + response
 */
import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { alerts, alertEvents, userFeedback, susResponses, users, organizations } from "@shared/schema";
import { requireAuth, requireOrg, requirePlatformAdmin, rateLimit, idParam } from "./security";
import { audit } from "./services/audit";

export const EVALUATIONS = ["pertinente", "parcialmente_pertinente", "nao_pertinente"] as const;
const EVAL_LABEL: Record<(typeof EVALUATIONS)[number], string> = {
  pertinente: "pertinente", parcialmente_pertinente: "parcialmente pertinente", nao_pertinente: "não pertinente",
};

/** SUS score (Brooke 1996): odd items (x−1), even items (5−x), sum × 2.5 → 0–100. */
export function susScore(a: number[]): number {
  if (a.length !== 10 || a.some((x) => !Number.isInteger(x) || x < 1 || x > 5)) throw new Error("SUS: 10 respostas de 1 a 5.");
  return a.reduce((s, x, i) => s + (i % 2 === 0 ? x - 1 : 5 - x), 0) * 2.5;
}

export function registerEvidenceRoutes(app: Express) {
  const limiter = rateLimit({ windowMs: 60 * 60_000, max: 30, key: "feedback" });

  app.post("/api/alerts/:id/evaluation", requireOrg("analyst"), async (req, res, next) => {
    try {
      const id = idParam(req.params.id);
      const body = z.object({ evaluation: z.enum(EVALUATIONS), note: z.string().trim().max(2000).optional() }).strict()
        .refine((b) => b.evaluation === "pertinente" || (b.note && b.note.length >= 5), "Justifique quando o alerta não for pertinente (mín. 5 caracteres).")
        .safeParse(req.body);
      if (!id) return res.status(400).json({ message: "Identificador inválido." });
      if (!body.success) return res.status(400).json({ message: body.error.issues[0].message });
      const [a] = await db.select().from(alerts).where(and(eq(alerts.id, id), eq(alerts.organizationId, req.ctx!.organizationId)));
      if (!a) return res.status(404).json({ message: "Alerta não encontrado." });
      const [u] = await db.update(alerts).set({
        evaluation: body.data.evaluation, evaluationNote: body.data.note ?? null, evaluatedBy: req.ctx!.userId, evaluatedAt: new Date(), updatedAt: new Date(),
      }).where(eq(alerts.id, id)).returning();
      await db.insert(alertEvents).values({
        alertId: id, fromStatus: a.status, toStatus: a.status, userId: req.ctx!.userId,
        note: `Avaliação do alerta: ${EVAL_LABEL[body.data.evaluation]}${body.data.note ? ` — ${body.data.note}` : ""}`,
      });
      await audit(req, "alert.evaluated", { type: "alert", id }, { evaluation: body.data.evaluation });
      res.json(u);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/feedback", requireAuth, limiter, async (req, res, next) => {
    try {
      const b = z.object({
        page: z.string().trim().min(1).max(200),
        category: z.enum(["problema", "sugestao", "elogio", "duvida"]),
        rating: z.number().int().min(1).max(5).optional(),
        message: z.string().trim().min(3).max(4000),
      }).strict().safeParse(req.body);
      if (!b.success) return res.status(400).json({ message: b.error.issues[0].message });
      const [row] = await db.insert(userFeedback).values({
        ...b.data, page: b.data.page.split("?")[0], userId: req.session!.userId!, organizationId: req.session!.organizationId ?? null,
      }).returning({ id: userFeedback.id });
      await audit(req, "feedback.created", { type: "feedback", id: row.id }, { category: b.data.category });
      res.status(201).json({ id: row.id, message: "Obrigado! Sua mensagem foi registrada e será analisada pela equipe." });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/sus", requireAuth, limiter, async (req, res, next) => {
    try {
      const b = z.object({ answers: z.array(z.number().int().min(1).max(5)).length(10), comment: z.string().trim().max(4000).optional() }).strict().safeParse(req.body);
      if (!b.success) return res.status(400).json({ message: "Responda às 10 afirmações (1 a 5)." });
      const score = susScore(b.data.answers);
      const [row] = await db.insert(susResponses).values({
        answers: b.data.answers, score, comment: b.data.comment ?? null, userId: req.session!.userId!, organizationId: req.session!.organizationId ?? null,
      }).returning({ id: susResponses.id });
      await audit(req, "sus.answered", { type: "sus", id: row.id }, { score });
      res.status(201).json({ id: row.id, score });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/admin/feedback", requirePlatformAdmin, async (_req, res, next) => {
    try {
      const rows = await db.select({
        id: userFeedback.id, page: userFeedback.page, category: userFeedback.category, rating: userFeedback.rating, message: userFeedback.message,
        status: userFeedback.status, response: userFeedback.response, createdAt: userFeedback.createdAt, userEmail: users.email, organization: organizations.name,
      }).from(userFeedback)
        .leftJoin(users, eq(users.id, userFeedback.userId))
        .leftJoin(organizations, eq(organizations.id, userFeedback.organizationId))
        .orderBy(desc(userFeedback.createdAt)).limit(200);
      res.setHeader("Cache-Control", "no-store");
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  app.patch("/api/admin/feedback/:id", requirePlatformAdmin, async (req, res, next) => {
    try {
      const id = idParam(req.params.id);
      const b = z.object({ status: z.enum(["novo", "em_analise", "resolvido", "arquivado"]), response: z.string().trim().max(4000).optional() }).strict().safeParse(req.body);
      if (!id || !b.success) return res.status(400).json({ message: "Parâmetros inválidos." });
      const [row] = await db.update(userFeedback).set({ status: b.data.status, response: b.data.response ?? null, updatedAt: sql`now()` })
        .where(eq(userFeedback.id, id)).returning();
      if (!row) return res.status(404).json({ message: "Mensagem não encontrada." });
      await audit(req, "feedback.updated", { type: "feedback", id }, { status: b.data.status });
      res.json(row);
    } catch (err) {
      next(err);
    }
  });
}
