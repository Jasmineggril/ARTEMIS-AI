/**
 * Alert notifications by e-mail, with a persistent delivery log.
 *
 *  1. enqueueAlertDeliveries(tx, …) runs IN THE SAME TRANSACTION that creates
 *     the alert: one row per eligible member (preferences: channel on, minimum
 *     severity, alert kinds). Unique (alert, user, channel) → never duplicated.
 *  2. processDeliveries() (scheduler, every few minutes) sends what is due:
 *       - no SMTP configured → 'bloqueado_configuracao' (NOT sent, NOT a
 *         failure of the alert); picked up again automatically once SMTP exists;
 *       - send error → attempts+1, next attempt with backoff (5, 15, 45, 135 min);
 *         after MAX_ATTEMPTS → 'falha' with the last error;
 *       - accepted by the SMTP server → 'enviado' with sent_at.
 *     Rows are claimed with FOR UPDATE SKIP LOCKED, so two instances never send
 *     the same e-mail.
 * Nothing here ever reports an e-mail as sent unless the transport accepted it.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, monitoredAreas, notificationDeliveries, notificationPreferences, organizationMembers, users, NOTIFICATION_SEVERITIES } from "@shared/schema";
import { mailer } from "./account-links";

export const MAX_ATTEMPTS = 5;
const RANK: Record<string, number> = { baixo: 0, moderado: 1, alto: 2, "crítico": 3, critico: 3 };
export const DEFAULT_PREFS = { emailEnabled: true, minSeverity: "alto" as (typeof NOTIFICATION_SEVERITIES)[number], kinds: ["risco", "foco_proximo"] };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Members (any role) of the organisation whose preferences accept this alert. */
export async function enqueueAlertDeliveries(tx: Tx, alert: { id: number; organizationId: number; severity: string; kind: string }): Promise<number> {
  const members = await tx.select({ userId: organizationMembers.userId, prefs: notificationPreferences })
    .from(organizationMembers)
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, alert.organizationId));
  const sev = RANK[alert.severity] ?? 0;
  const eligible = members.filter((m) => {
    const p = m.prefs ?? DEFAULT_PREFS;
    return p.emailEnabled && sev >= (RANK[p.minSeverity] ?? 2) && p.kinds.includes(alert.kind);
  });
  if (!eligible.length) return 0;
  const rows = await tx.insert(notificationDeliveries)
    .values(eligible.map((m) => ({ alertId: alert.id, userId: m.userId, organizationId: alert.organizationId })))
    .onConflictDoNothing().returning({ id: notificationDeliveries.id });
  return rows.length;
}

export function backoffMinutes(attempt: number): number { return 5 * 3 ** Math.max(0, attempt - 1); }

export interface ProcessResult { claimed: number; sent: number; failed: number; retrying: number; blocked: number }

export async function processDeliveries(opts: { limit?: number; now?: Date; appUrl?: string } = {}): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  const out: ProcessResult = { claimed: 0, sent: 0, failed: 0, retrying: 0, blocked: 0 };
  const transport = mailer();
  const appUrl = (opts.appUrl ?? process.env.APP_URL ?? "").replace(/\/$/, "");

  // Blocked rows become due again only when there is a transport to send them.
  const statuses = transport ? ["pendente", "bloqueado_configuracao"] : ["pendente"];
  const due = await db.transaction(async (tx) => {
    const r = await tx.execute<{ id: number }>(sql`
      SELECT id FROM notification_deliveries
      WHERE status IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)}) AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at LIMIT ${opts.limit ?? 100} FOR UPDATE SKIP LOCKED`);
    const ids = r.rows.map((x) => x.id);
    if (ids.length) {
      // lease: push next_attempt_at so a concurrent run does not pick them while we send
      await tx.update(notificationDeliveries).set({ nextAttemptAt: new Date(now.getTime() + 10 * 60_000) }).where(inArray(notificationDeliveries.id, ids));
    }
    return ids;
  });
  out.claimed = due.length;
  if (!due.length) return out;

  const rows = await db.select({ d: notificationDeliveries, email: users.email, name: users.name, alert: alerts, areaName: monitoredAreas.name })
    .from(notificationDeliveries)
    .innerJoin(users, eq(users.id, notificationDeliveries.userId))
    .innerJoin(alerts, eq(alerts.id, notificationDeliveries.alertId))
    .leftJoin(monitoredAreas, eq(monitoredAreas.id, alerts.areaId))
    .where(inArray(notificationDeliveries.id, due));

  for (const r of rows) {
    const set = (v: Partial<typeof notificationDeliveries.$inferInsert>) =>
      db.update(notificationDeliveries).set({ ...v, updatedAt: new Date() }).where(eq(notificationDeliveries.id, r.d.id));
    if (!transport) {
      await set({ status: "bloqueado_configuracao", lastError: "SMTP não configurado (SMTP_URL e MAIL_FROM). E-mail não enviado.", nextAttemptAt: now });
      out.blocked++;
      continue;
    }
    const a = r.alert;
    const link = appUrl ? `${appUrl}/alerts` : "";
    try {
      await transport.sendMail({
        from: process.env.MAIL_FROM,
        to: r.email,
        subject: `[ARTEMIS AI] ${a.title}`,
        text: [
          `Olá, ${r.name ?? ""}`.trim() + ",", "",
          `${a.title}${r.areaName ? ` — área: ${r.areaName}` : ""}`,
          `Severidade: ${a.severity}`, "", a.reason ?? a.message ?? "", "",
          `Fonte: ${a.dataSource ?? "—"}${a.dataReferenceAt ? ` · referência: ${new Date(a.dataReferenceAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}`,
          link ? `Acompanhe e registre ações: ${link}` : "",
          "", "Foco de calor é detecção por satélite, não incêndio confirmado. Em caso de fogo, ligue 193 (Bombeiros).",
          "Para mudar o que você recebe: Configurações → Notificações.",
        ].filter((l) => l !== null).join("\n"),
      });
      await set({ status: "enviado", sentAt: new Date(), attempts: r.d.attempts + 1, lastError: null });
      out.sent++;
    } catch (err) {
      const attempts = r.d.attempts + 1;
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      if (attempts >= MAX_ATTEMPTS) { await set({ status: "falha", attempts, lastError: msg }); out.failed++; }
      else { await set({ status: "pendente", attempts, lastError: msg, nextAttemptAt: new Date(now.getTime() + backoffMinutes(attempts) * 60_000) }); out.retrying++; }
      console.error(JSON.stringify({ level: "error", msg: "alert_email_failed", deliveryId: r.d.id, attempts, err: msg }));
    }
  }
  return out;
}

/** Counts by status, for the admin panel and the evidence report. */
export async function deliveryStats(from: Date, to: Date, organizationId?: number) {
  const rows = await db.select({ status: notificationDeliveries.status, n: sql<number>`count(*)::int` })
    .from(notificationDeliveries)
    .where(and(sql`${notificationDeliveries.createdAt} >= ${from}`, lte(notificationDeliveries.createdAt, to),
      organizationId ? eq(notificationDeliveries.organizationId, organizationId) : sql`true`))
    .groupBy(notificationDeliveries.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return { pendente: by.pendente ?? 0, enviado: by.enviado ?? 0, falha: by.falha ?? 0, bloqueado_configuracao: by.bloqueado_configuracao ?? 0, smtpConfigured: mailer() !== null };
}
