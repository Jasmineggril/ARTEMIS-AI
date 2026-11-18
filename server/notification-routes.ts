/**
 * Alert notification settings and delivery log.
 *   GET  /api/notifications/preferences          signed-in member: own preferences (defaults if never saved)
 *   PUT  /api/notifications/preferences          signed-in member: update own preferences
 *   GET  /api/alerts/:id/deliveries              member of the alert's organisation: delivery log of that alert
 *   GET  /api/admin/notifications                platform admin: counts + recent failures/blocked
 *   POST /api/admin/notifications/process        platform admin: process due deliveries now
 */
import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { alerts, notificationDeliveries, notificationPreferences, users, NOTIFICATION_SEVERITIES } from "@shared/schema";
import { requireOrg, requirePlatformAdmin, idParam } from "./security";
import { audit } from "./services/audit";
import { DEFAULT_PREFS, deliveryStats, processDeliveries } from "./services/notifications";
import { mailConfigured } from "./services/account-links";

const prefsSchema = z.object({
  emailEnabled: z.boolean(),
  minSeverity: z.enum(NOTIFICATION_SEVERITIES),
  kinds: z.array(z.enum(["risco", "foco_proximo"])).max(2),
}).strict();

export function registerNotificationRoutes(app: Express) {
  app.get("/api/notifications/preferences", requireOrg("viewer"), async (req, res, next) => {
    try {
      const [p] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, req.ctx!.userId));
      res.json({ ...(p ? { emailEnabled: p.emailEnabled, minSeverity: p.minSeverity, kinds: p.kinds } : DEFAULT_PREFS), saved: !!p, smtpConfigured: mailConfigured() });
    } catch (err) { next(err); }
  });

  app.put("/api/notifications/preferences", requireOrg("viewer"), async (req, res, next) => {
    try {
      const b = prefsSchema.safeParse(req.body);
      if (!b.success) return res.status(400).json({ message: b.error.issues[0].message });
      const v = { ...b.data, kinds: Array.from(new Set(b.data.kinds)), updatedAt: new Date() };
      await db.insert(notificationPreferences).values({ userId: req.ctx!.userId, ...v })
        .onConflictDoUpdate({ target: notificationPreferences.userId, set: v });
      await audit(req, "notifications.preferences_updated", { type: "user", id: req.ctx!.userId }, b.data);
      res.json({ ...v, saved: true, smtpConfigured: mailConfigured() });
    } catch (err) { next(err); }
  });

  app.get("/api/alerts/:id/deliveries", requireOrg("viewer"), async (req, res, next) => {
    try {
      const id = idParam(req.params.id);
      if (!id) return res.status(400).json({ message: "Identificador inválido." });
      const [a] = await db.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.id, id), eq(alerts.organizationId, req.ctx!.organizationId)));
      if (!a) return res.status(404).json({ message: "Alerta não encontrado." });
      const rows = await db.select({
        id: notificationDeliveries.id, channel: notificationDeliveries.channel, status: notificationDeliveries.status,
        attempts: notificationDeliveries.attempts, lastError: notificationDeliveries.lastError, sentAt: notificationDeliveries.sentAt,
        createdAt: notificationDeliveries.createdAt, recipient: users.name,
      }).from(notificationDeliveries).innerJoin(users, eq(users.id, notificationDeliveries.userId))
        .where(eq(notificationDeliveries.alertId, id)).orderBy(notificationDeliveries.id);
      res.json({ smtpConfigured: mailConfigured(), deliveries: rows });
    } catch (err) { next(err); }
  });

  app.get("/api/admin/notifications", requirePlatformAdmin, async (req, res, next) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 366);
      const to = new Date(), from = new Date(to.getTime() - days * 86_400_000);
      const recent = await db.select({ id: notificationDeliveries.id, alertId: notificationDeliveries.alertId, status: notificationDeliveries.status,
        attempts: notificationDeliveries.attempts, lastError: notificationDeliveries.lastError, updatedAt: notificationDeliveries.updatedAt })
        .from(notificationDeliveries).where(inArray(notificationDeliveries.status, ["falha", "bloqueado_configuracao"]))
        .orderBy(desc(notificationDeliveries.updatedAt)).limit(50);
      res.json({ ...(await deliveryStats(from, to)), days, recentProblems: recent });
    } catch (err) { next(err); }
  });

  app.post("/api/admin/notifications/process", requirePlatformAdmin, async (req, res, next) => {
    try {
      const r = await processDeliveries();
      await audit(req, "notifications.processed", { type: "notification_deliveries" }, { ...r });
      res.json(r);
    } catch (err) { next(err); }
  });
}
