/**
 * ARTEMIS AI — security middleware.
 *
 * - Security headers (no extra dependency).
 * - Origin check for state-changing requests (CSRF defence in depth; session
 *   cookies are also SameSite=Lax).
 * - In-memory sliding-window rate limiter (adequate for a single VPS process).
 * - Authentication / organization / role guards.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { organizationMembers, users, ORG_ROLES, type OrgRole } from "@shared/schema";

// ─── Context ─────────────────────────────────────────────────────────────────

export interface AuthContext {
  userId: number;
  organizationId: number;
  role: OrgRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: AuthContext;
    }
  }
}

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  analyst: 2,
  manager: 3,
  admin: 4,
  owner: 5,
};

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min];
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

export function clientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "").slice(0, 64);
}

// ─── Headers ─────────────────────────────────────────────────────────────────

export function securityHeaders(): RequestHandler {
  const isProd = process.env.NODE_ENV === "production";
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (isProd) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      // Vite dev server needs inline scripts / HMR, so CSP is production only.
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:",
          "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com",
          "connect-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      );
    }
    next();
  };
}

// ─── Origin check ────────────────────────────────────────────────────────────

export function originCheck(): RequestHandler {
  const extra = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (!req.path.startsWith("/api")) return next();
    const origin = req.get("origin");
    if (!origin) return next(); // non-browser clients (curl, server-to-server)
    try {
      const o = new URL(origin);
      const host = req.get("host");
      if (o.host === host || extra.includes(origin)) return next();
    } catch {
      /* fall through */
    }
    return res.status(403).json({ message: "Origem não autorizada." });
  };
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

interface Bucket {
  hits: number[];
}

export function rateLimit(opts: { windowMs: number; max: number; key?: string }): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const disabled = process.env.RATE_LIMIT_DISABLED === "true";

  // periodic cleanup to bound memory
  const timer = setInterval(() => {
    const now = Date.now();
    buckets.forEach((b, k) => {
      b.hits = b.hits.filter((t) => now - t < opts.windowMs);
      if (b.hits.length === 0) buckets.delete(k);
    });
  }, Math.max(opts.windowMs, 60_000));
  timer.unref?.();

  return (req, res, next) => {
    if (disabled) return next();
    const k = `${opts.key ?? req.path}:${clientIp(req)}`;
    const now = Date.now();
    const bucket = buckets.get(k) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => now - t < opts.windowMs);
    if (bucket.hits.length >= opts.max) {
      const retry = Math.ceil((opts.windowMs - (now - bucket.hits[0])) / 1000);
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ message: "Muitas tentativas. Aguarde e tente novamente." });
    }
    bucket.hits.push(now);
    buckets.set(k, bucket);
    next();
  };
}

// ─── Guards ──────────────────────────────────────────────────────────────────

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Autenticação necessária." });
  }
  next();
};

/**
 * Resolves the active organization from the session and verifies, against
 * the database on every request, that the user is still a member.
 */
export function requireOrg(minRole: OrgRole = "viewer"): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session?.userId;
      const organizationId = req.session?.organizationId;
      if (!userId) return res.status(401).json({ message: "Autenticação necessária." });
      if (!organizationId) {
        return res.status(403).json({ message: "Nenhuma organização ativa para este usuário." });
      }
      const [membership] = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, userId),
            eq(organizationMembers.organizationId, organizationId),
          ),
        );
      if (!membership || !isOrgRole(membership.role)) {
        return res.status(403).json({ message: "Acesso não autorizado a esta organização." });
      }
      if (!roleAtLeast(membership.role, minRole)) {
        return res.status(403).json({ message: "Permissão insuficiente para esta operação." });
      }
      req.ctx = { userId, organizationId, role: membership.role };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Parses a positive integer route param, or returns null. */
export function idParam(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 2_147_483_647 ? n : null;
}

/** Platform-level administrator (users.role = 'platform_admin'). Re-checked on every request. */
export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.session?.userId) return res.status(401).json({ message: "Autenticação necessária." });
    const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.session.userId));
    if (u?.role !== "platform_admin") return res.status(403).json({ message: "Acesso restrito à administração da plataforma." });
    next();
  } catch (err) {
    next(err);
  }
}
