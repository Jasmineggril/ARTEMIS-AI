/**
 * ARTEMIS AI — authentication routes (server-side sessions, bcrypt).
 */
import crypto from "node:crypto";
import type { Express, Request } from "express";
import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  users, organizations, organizationMembers, passwordResetTokens,
} from "@shared/schema";
import { hashPassword, verifyPassword } from "./auth";
import { rateLimit, requireAuth } from "./security";
import { audit } from "./services/audit";

const passwordSchema = z
  .string()
  .min(8, "A senha deve ter pelo menos 8 caracteres.")
  .max(128, "Senha muito longa.")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "A senha deve conter letras e números.");

const signupSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(254),
  password: passwordSchema,
  organizationName: z.string().trim().min(2).max(160).optional(),
  organizationType: z.enum(["produtor", "empresa", "pesquisa", "gestao_publica", "outro"]).default("produtor"),
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: "É necessário aceitar a política de privacidade." }) }),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  password: z.string().min(1, "Informe a senha.").max(128),
});

export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "org";
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

function save(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}

async function firstMembership(userId: number) {
  const rows = await db
    .select({ organizationId: organizationMembers.organizationId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .orderBy(organizationMembers.id)
    .limit(1);
  return rows[0] ?? null;
}

async function startSession(req: Request, user: { id: number; email: string; name: string }) {
  await regenerate(req); // prevents session fixation
  const membership = await firstMembership(user.id);
  req.session.userId = user.id;
  req.session.email = user.email;
  req.session.name = user.name;
  req.session.organizationId = membership?.organizationId;
  await save(req);
}

export const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

export function registerAuthRoutes(app: Express) {
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, key: "auth" });
  const resetLimiter = rateLimit({ windowMs: 60 * 60_000, max: 5, key: "reset" });

  app.post("/api/auth/signup", authLimiter, async (req, res, next) => {
    try {
      const input = signupSchema.parse(req.body);
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
      if (existing) {
        // Same message shape as success-path errors; does not reveal more than necessary.
        return res.status(409).json({ message: "Não foi possível concluir o cadastro com este e-mail." });
      }
      const passwordHash = await hashPassword(input.password);
      const orgName = input.organizationName ?? `Organização de ${input.name}`;

      const user = await db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({ email: input.email, password: passwordHash, name: input.name, firstName: input.name.split(" ")[0] })
          .returning();
        const [org] = await tx
          .insert(organizations)
          .values({ name: orgName, slug: slugify(orgName), type: input.organizationType })
          .returning();
        await tx.insert(organizationMembers).values({ organizationId: org.id, userId: u.id, role: "owner" });
        return u;
      });

      await startSession(req, user);
      await audit(req, "auth.signup", { type: "user", id: user.id });
      res.status(201).json({ id: user.id, email: user.email, name: user.name });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      next(err);
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      const [user] = await db.select().from(users).where(eq(users.email, input.email));
      const ok =
        !!user &&
        (await verifyPassword(input.password, user.password, user.id, async (id, h) => {
          await db.update(users).set({ password: h }).where(eq(users.id, id));
        }));
      if (!ok) {
        await audit(req, "auth.login_failed", { type: "user" }, { emailHash: sha256(input.email).slice(0, 16) }, { userId: null, organizationId: null });
        return res.status(401).json({ message: "E-mail ou senha inválidos." });
      }
      await startSession(req, user!);
      await audit(req, "auth.login", { type: "user", id: user!.id });
      res.json({ id: user!.id, email: user!.email, name: user!.name });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      next(err);
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    if (req.session?.userId) await audit(req, "auth.logout", { type: "user", id: req.session.userId });
    req.session.destroy(() => {
      res.clearCookie("artemis.sid");
      res.json({});
    });
  });

  app.get("/api/auth/status", async (req, res, next) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: "Não autenticado." });
      const [user] = await db
        .select({ id: users.id, email: users.email, name: users.name, platformRole: users.role })
        .from(users)
        .where(eq(users.id, req.session.userId));
      if (!user) {
        req.session.destroy(() => {});
        return res.status(401).json({ message: "Não autenticado." });
      }
      let organization: { id: number; name: string; type: string; role: string } | null = null;
      if (req.session.organizationId) {
        const [row] = await db
          .select({ id: organizations.id, name: organizations.name, type: organizations.type, role: organizationMembers.role })
          .from(organizationMembers)
          .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
          .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.organizationId, req.session.organizationId)));
        organization = row ?? null;
      }
      if (!organization) {
        // Active organization missing or membership revoked: move the session
        // to another organization the user still belongs to (if any).
        const next = await firstMembership(user.id);
        req.session.organizationId = next?.organizationId;
        await save(req);
        if (next) {
          const [row] = await db
            .select({ id: organizations.id, name: organizations.name, type: organizations.type, role: organizationMembers.role })
            .from(organizationMembers)
            .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
            .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.organizationId, next.organizationId)));
          organization = row ?? null;
        }
      }
      res.json({ userId: user.id, email: user.email, name: user.name, platformRole: user.platformRole, organization });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/auth/organizations", requireAuth, async (req, res, next) => {
    try {
      const rows = await db
        .select({ id: organizations.id, name: organizations.name, type: organizations.type, role: organizationMembers.role })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, req.session.userId!))
        .orderBy(organizations.name);
      res.json(rows.map((r) => ({ ...r, active: r.id === req.session.organizationId })));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/auth/switch-organization", requireAuth, async (req, res, next) => {
    try {
      const { organizationId } = z.object({ organizationId: z.number().int().positive() }).strict().parse(req.body);
      const [m] = await db
        .select()
        .from(organizationMembers)
        .where(and(eq(organizationMembers.userId, req.session.userId!), eq(organizationMembers.organizationId, organizationId)));
      if (!m) return res.status(403).json({ message: "Você não é membro desta organização." });
      req.session.organizationId = organizationId;
      await save(req);
      await audit(req, "auth.organization_switched", { type: "organization", id: organizationId });
      res.json({ organizationId, role: m.role });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      next(err);
    }
  });

  app.put("/api/auth/password", requireAuth, authLimiter, async (req, res, next) => {
    try {
      const input = z
        .object({ currentPassword: z.string().min(1, "Senha atual é obrigatória."), newPassword: passwordSchema })
        .parse(req.body);
      const [user] = await db.select().from(users).where(eq(users.id, req.session.userId!));
      if (!user) return res.status(404).json({ message: "Usuário não encontrado." });
      const ok = await verifyPassword(input.currentPassword, user.password, user.id);
      if (!ok) return res.status(400).json({ message: "Senha atual incorreta." });
      await db.update(users).set({ password: await hashPassword(input.newPassword) }).where(eq(users.id, user.id));
      await audit(req, "auth.password_changed", { type: "user", id: user.id });
      res.json({ message: "Senha alterada com sucesso." });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      next(err);
    }
  });

  // ── Password reset (temporary single-use token; only its hash is stored) ──
  app.post("/api/auth/password-reset/request", resetLimiter, async (req, res, next) => {
    try {
      const { email } = z.object({ email: z.string().trim().toLowerCase().email("E-mail inválido.") }).parse(req.body);
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (user) {
        const token = crypto.randomBytes(32).toString("base64url");
        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 30 * 60_000),
        });
        const link = `${process.env.PUBLIC_BASE_URL ?? ""}/reset-password?token=${token}`;
        // E-mail delivery is not configured yet (SMTP pending). Outside
        // production the link is printed to the server console for testing.
        if (process.env.NODE_ENV !== "production") {
          console.log(`[password-reset] link de redefinição (somente desenvolvimento): ${link}`);
        }
        await audit(req, "auth.password_reset_requested", { type: "user", id: user.id }, undefined, { userId: user.id });
      }
      // Always the same response: does not reveal whether the e-mail exists.
      res.json({ message: "Se o e-mail estiver cadastrado, você receberá instruções para redefinir a senha." });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      next(err);
    }
  });

  app.post("/api/auth/password-reset/confirm", resetLimiter, async (req, res, next) => {
    try {
      const input = z.object({ token: z.string().min(20).max(200), newPassword: passwordSchema }).parse(req.body);
      const [row] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, sha256(input.token)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        );
      if (!row) return res.status(400).json({ message: "Link inválido ou expirado." });
      await db.transaction(async (tx) => {
        await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
        await tx.update(users).set({ password: await hashPassword(input.newPassword) }).where(eq(users.id, row.userId));
      });
      await audit(req, "auth.password_reset_completed", { type: "user", id: row.userId }, undefined, { userId: row.userId });
      res.json({ message: "Senha redefinida. Faça login com a nova senha." });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      next(err);
    }
  });
}
