/**
 * Single-use account links (password reset, invitation) and their delivery.
 *
 * Delivery: e-mail when SMTP is configured (SMTP_URL + MAIL_FROM). Without
 * SMTP, the link is returned ONCE to the administrator who issued it so it can
 * be passed on through another channel; self-service requests then tell the
 * person to contact their organisation's administrator. Only the SHA-256 of a
 * token is stored.
 */
import crypto from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import type { Request } from "express";
import { db } from "../db";
import { passwordResetTokens } from "@shared/schema";

export const RESET_TTL_MIN = 30;
export const ADMIN_LINK_TTL_H = 72;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

let transport: Transporter | null | undefined;
export function mailer(): Transporter | null {
  if (transport !== undefined) return transport;
  const url = process.env.SMTP_URL?.trim();
  transport = url && process.env.MAIL_FROM ? nodemailer.createTransport(url) : null;
  return transport;
}
export const mailConfigured = () => mailer() !== null;
/** Tests replace the transport (e.g. nodemailer's jsonTransport). */
export function setMailerForTests(t: Transporter | null | undefined) {
  transport = t;
}

export function baseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

export async function issueAccountLink(req: Request, userId: number, ttlMs: number): Promise<{ link: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(passwordResetTokens).values({ userId, tokenHash: sha256(token), expiresAt });
  return { link: `${baseUrl(req)}/reset-password?token=${token}`, expiresAt };
}

export async function sendAccountEmail(to: string, kind: "reset" | "invite", link: string, extra: { orgName?: string; expiresAt: Date }): Promise<boolean> {
  const t = mailer();
  if (!t) return false;
  const until = extra.expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const subject = kind === "invite" ? `Convite para a ARTEMIS AI${extra.orgName ? ` — ${extra.orgName}` : ""}` : "Redefinição de senha — ARTEMIS AI";
  const intro = kind === "invite"
    ? `Você foi convidado(a) para acessar a ARTEMIS AI${extra.orgName ? ` na organização ${extra.orgName}` : ""}. Defina sua senha pelo link abaixo:`
    : "Recebemos um pedido para redefinir a sua senha na ARTEMIS AI. Para continuar, use o link abaixo:";
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text: `${intro}\n\n${link}\n\nO link vale até ${until} (horário de Brasília) e só pode ser usado uma vez.\nSe você não esperava esta mensagem, ignore-a.\n\nARTEMIS AI`,
    });
    return true;
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "mail_send_failed", kind, err: err instanceof Error ? err.message : String(err) }));
    return false;
  }
}
