import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import type { Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { db, isConnectionError } from "./db";
import { desc, eq } from "drizzle-orm";
import { importBatches, fireOccurrences, dataSources } from "@shared/schema";
import { hashPassword, verifyPassword } from "./auth";
import { calculateRisk, validateRiskInput, type RiskInput } from "@shared/risk-engine";

declare module "express-session" {
  interface SessionData {
    userId: number;
    email: string;
    name: string;
  }
}

const PYTHON_SERVICE_URL = (process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

/** Demo account advertised on the login page. Seeded automatically (see ensureDemoUser). */
export const DEMO_USER = {
  email: "demo@ceres.ai",
  password: "Demo123!",
  name: "Seu Raimundo",
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Express 4 does not catch rejected promises from async handlers: the error
 * becomes an unhandled rejection and crashes the whole Node process. This
 * wrapper forwards the error to the error-handling middleware instead.
 */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Rejects requests without an authenticated server session. */
const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session?.userId) {
    res.status(401).json({ message: "Não autenticado. Faça login novamente." });
    return;
  }
  next();
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isDemoAccount(email: string | undefined) {
  return !!email && normalizeEmail(email) === DEMO_USER.email;
}

/** Starts a fresh session for the user (regenerating the id prevents session fixation). */
function startSession(req: Request, user: { id: number; email: string; name: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.name = user.name;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

function zodMessage(err: z.ZodError) {
  return err.errors[0]?.message ?? "Dados inválidos";
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function getSupabaseServerConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  return url && anonKey ? { url, anonKey } : null;
}

// ─── Validation schemas ─────────────────────────────────────────────────────

const signupSchema = z.object({
  name: z.string().trim().min(1, "O nome é obrigatório.").max(120),
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres.").max(200),
});

const loginSchema = z.object({
  email: z.string().trim().min(1, "Informe o e-mail."),
  password: z.string().min(1, "Informe a senha."),
});

const propertyProfileSchema = z.object({
  municipality: z.string().max(120).optional(),
  state: z.string().max(60).optional(),
  biome: z.string().max(60).optional(),
  propertySize: z.string().max(60).optional(),
});

const chatSchema = z.object({
  message: z.string().trim().min(1, "Campo 'message' é obrigatório.").max(2000, "Mensagem muito longa."),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .optional(),
  propertyProfile: propertyProfileSchema.optional(),
});

const denunciaSchema = z.object({
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().trim().min(1).max(5000),
  categoria: z.string().trim().min(1).max(100),
  latitude: z.coerce.number().finite().optional().nullable(),
  longitude: z.coerce.number().finite().optional().nullable(),
  municipio: z.string().max(120).optional().nullable(),
});

// ─── Risk analysis (TypeScript fallback) ────────────────────────────────────

const VEGETATION_MAP: Record<string, RiskInput["vegetationCondition"]> = { very_dry: 0, dry: 1, moderate: 2, humid: 3 };
const QUALITY_MAP: Record<string, RiskInput["dataQuality"]> = { poor: 0, regular: 1, good: 2, excellent: 3 };

/**
 * Runs the TypeScript rule engine with the same input/output contract as the
 * Python service (POST /analyze-risk), so the frontend renders both alike.
 */
function analyzeWithRuleEngine(body: Record<string, unknown>) {
  const num = (value: unknown, fallback: number) => toNumberOrNull(value) ?? fallback;
  const input: RiskInput = {
    temperature: num(body.temperature, 30),
    humidity: num(body.humidity, 50),
    windSpeed: num(body.wind_speed, 10),
    recentRainfall: num(body.recent_rainfall, 0),
    vegetationCondition: VEGETATION_MAP[String(body.vegetation_condition)] ?? 2,
    nearbyHotspot: Boolean(body.nearby_hotspot),
    hotspotDistance: num(body.hotspot_distance, 0),
    historicalOccurrences: num(body.historical_occurrences, 0),
    dataQuality: QUALITY_MAP[String(body.data_quality)] ?? 2,
  };

  const validation = validateRiskInput(input);
  if (!validation.valid) {
    return { ok: false as const, errors: validation.errors };
  }

  const result = calculateRisk(input, false);
  return {
    ok: true as const,
    data: {
      score: result.score,
      level: result.level,
      confidence: result.confidence,
      factors: result.factors,
      recommendations: result.recommendations,
      model_type: "transparent-rule-engine-ts-fallback",
      model_version: result.calculationVersion,
      dataset_type: "rule-based",
      is_simulated: false,
      calculated_at: result.calculatedAt,
      _fallback: true,
    },
  };
}

/** Turns a FastAPI 422 body into a readable Portuguese message. */
function describePythonValidationError(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as { detail?: unknown };
    if (Array.isArray(parsed.detail)) {
      const messages = parsed.detail
        .map((d) => (typeof d === "string" ? d : typeof d === "object" && d && "msg" in d ? String((d as { msg: unknown }).msg) : ""))
        .filter(Boolean);
      if (messages.length > 0) return `Dados inválidos: ${messages.join("; ")}`;
    }
  } catch {
    /* body is not JSON */
  }
  return "Dados de entrada inválidos.";
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  app.post(api.auth.signup.path, asyncHandler(async (req, res) => {
    try {
      const input = signupSchema.parse(req.body ?? {});
      const email = normalizeEmail(input.email);
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ message: "Este e-mail já está cadastrado. Faça login ou redefina sua senha." });
      }

      const user = await storage.createUser({
        email,
        name: input.name,
        password: await hashPassword(input.password),
      });

      await startSession(req, user);
      res.status(201).json({ id: user.id, email: user.email, name: user.name });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: zodMessage(err) });
      }
      throw err;
    }
  }));

  app.post(api.auth.login.path, asyncHandler(async (req, res) => {
    try {
      const input = loginSchema.parse(req.body ?? {});
      const user = await storage.getUserByEmail(input.email);

      const passwordValid = !!user && await verifyPassword(
        input.password,
        user.password,
        user.id,
        async (userId, newHash) => {
          await storage.updateUser(userId, { password: newHash });
        },
      );
      if (!user || !passwordValid) {
        return res.status(401).json({ message: "Email ou senha inválidos" });
      }

      await startSession(req, user);
      res.json({ id: user.id, email: user.email, name: user.name });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: zodMessage(err) });
      }
      throw err;
    }
  }));

  /**
   * Bridges a Supabase login to a server session: the access token is checked
   * against Supabase and the user is mirrored in the local users table, so
   * API routes that require a session work in Supabase mode too.
   */
  app.post("/api/auth/supabase-session", asyncHandler(async (req, res) => {
    const accessToken = typeof req.body?.accessToken === "string" ? req.body.accessToken : "";
    const config = getSupabaseServerConfig();
    if (!accessToken) return res.status(400).json({ message: "Token de acesso ausente." });
    if (!config) return res.status(501).json({ message: "Supabase não configurado no servidor." });

    let supabaseUser: { email?: string; user_metadata?: { full_name?: string } } | null = null;
    try {
      const response = await fetch(`${config.url}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${accessToken}`, apikey: config.anonKey },
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) supabaseUser = await response.json();
    } catch (err) {
      console.warn("[auth] Supabase indisponível:", err instanceof Error ? err.message : err);
      return res.status(503).json({ message: "Não foi possível validar a sessão no Supabase." });
    }

    if (!supabaseUser?.email) {
      return res.status(401).json({ message: "Sessão Supabase inválida ou expirada." });
    }

    const email = normalizeEmail(supabaseUser.email);
    let user = await storage.getUserByEmail(email);
    if (!user) {
      user = await storage.createUser({
        email,
        name: supabaseUser.user_metadata?.full_name?.trim() || email.split("@")[0],
        // Login happens through Supabase; this random password is never used.
        password: await hashPassword(crypto.randomBytes(32).toString("hex")),
      });
    }

    await startSession(req, user);
    res.json({ id: user.id, email: user.email, name: user.name });
  }));

  app.post(api.auth.logout.path, (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid", { path: "/" });
      res.json({});
    });
  });

  app.put("/api/auth/password", requireAuth, asyncHandler(async (req, res) => {
    try {
      const input = z.object({
        currentPassword: z.string().min(1, "Senha atual é obrigatória"),
        newPassword: z.string().min(6, "A nova senha deve ter pelo menos 6 caracteres"),
      }).parse(req.body ?? {});

      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }
      if (isDemoAccount(user.email)) {
        return res.status(403).json({ message: "A senha da conta de demonstração não pode ser alterada." });
      }

      const passwordValid = await verifyPassword(input.currentPassword, user.password, user.id);
      if (!passwordValid) {
        return res.status(400).json({ message: "Senha atual incorreta" });
      }

      await storage.updateUser(user.id, { password: await hashPassword(input.newPassword) });
      res.json({ message: "Senha alterada com sucesso" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: zodMessage(err) });
      }
      throw err;
    }
  }));

  app.get(api.auth.status.path, (req, res) => {
    if (req.session?.userId) {
      res.json({ userId: req.session.userId, email: req.session.email, name: req.session.name });
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  app.get(api.user.profile.get.path, requireAuth, asyncHandler(async (req, res) => {
    const user = await storage.getUserById(req.session.userId!);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      email: user.email,
      role: user.role,
      bio: user.bio ?? "",
      avatar: user.avatar ?? "",
      usingFallback: storage.isFallbackActive(),
    });
  }));

  app.put(api.user.profile.update.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const input = api.user.profile.update.input.parse(req.body ?? {});
      const userId = req.session.userId!;

      if (input.email) {
        input.email = normalizeEmail(input.email);
        if (isDemoAccount(req.session.email) && input.email !== DEMO_USER.email) {
          return res.status(403).json({ message: "O e-mail da conta de demonstração não pode ser alterado." });
        }
        const existing = await storage.getUserByEmail(input.email);
        if (existing && existing.id !== userId) {
          return res.status(400).json({ message: "Email já está em uso" });
        }
      }

      // "role" is not user-editable through this endpoint.
      const { role: _ignoredRole, ...updates } = input;
      const updated = await storage.updateUser(userId, updates);
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      req.session.email = updated.email;

      res.json({
        firstName: updated.firstName ?? "",
        lastName: updated.lastName ?? "",
        email: updated.email,
        role: updated.role,
        bio: updated.bio ?? "",
        avatar: updated.avatar ?? "",
        usingFallback: storage.isFallbackActive(),
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: zodMessage(err) });
      }
      throw err;
    }
  }));

  // ── Sensors ───────────────────────────────────────────────────────────────
  app.get(api.sensors.list.path, asyncHandler(async (_req, res) => {
    res.json(await storage.getSensors());
  }));

  app.get(api.sensors.get.path, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const sensor = Number.isInteger(id) ? await storage.getSensor(id) : undefined;
    if (!sensor) return res.status(404).json({ message: "Sensor not found" });
    res.json(sensor);
  }));

  app.post(api.sensors.create.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const input = api.sensors.create.input.parse(req.body);
      const sensor = await storage.createSensor(input);
      res.status(201).json(sensor);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: zodMessage(err) });
      }
      throw err;
    }
  }));

  app.put(api.sensors.update.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const input = api.sensors.update.input.parse(req.body);
      const sensor = await storage.updateSensor(Number(req.params.id), input);
      if (!sensor) return res.status(404).json({ message: "Sensor not found" });
      res.json(sensor);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: zodMessage(err) });
      }
      throw err;
    }
  }));

  app.delete(api.sensors.delete.path, requireAuth, asyncHandler(async (req, res) => {
    await storage.deleteSensor(Number(req.params.id));
    res.status(204).send();
  }));

  // ── Readings ──────────────────────────────────────────────────────────────
  app.get(api.readings.list.path, asyncHandler(async (req, res) => {
    const sensorId = req.query.sensorId ? Number(req.query.sensorId) : undefined;
    res.json(await storage.getReadings(Number.isInteger(sensorId) ? sensorId : undefined));
  }));

  app.post(api.readings.create.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const input = api.readings.create.input.parse(req.body);
      const reading = await storage.createReading(input);
      res.status(201).json(reading);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: zodMessage(err) });
      }
      throw err;
    }
  }));

  // ── Alerts ────────────────────────────────────────────────────────────────
  app.get(api.alerts.list.path, asyncHandler(async (_req, res) => {
    res.json(await storage.getAlerts());
  }));

  app.post(api.alerts.create.path, requireAuth, asyncHandler(async (req, res) => {
    try {
      const input = api.alerts.create.input.parse(req.body);
      const alert = await storage.createAlert(input);
      res.status(201).json(alert);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: zodMessage(err) });
      }
      throw err;
    }
  }));

  app.patch(api.alerts.resolve.path, requireAuth, asyncHandler(async (req, res) => {
    const alert = await storage.resolveAlert(Number(req.params.id));
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    res.json(alert);
  }));

  // ── Gamification — user stats (legacy) ────────────────────────────────────
  app.get("/api/user-stats/me", requireAuth, asyncHandler(async (req, res) => {
    const userId = req.session.userId!;
    let stats = await storage.getUserStats(userId);
    if (!stats) {
      stats = await storage.createUserStats({ userId, points: 0, level: 1, denunciasCount: 0, achievement: "iniciante" });
    }
    res.json(stats);
  }));

  app.get("/api/user-stats/:userId", requireAuth, asyncHandler(async (req, res) => {
    const stats = await storage.getUserStats(Number(req.params.userId));
    if (!stats) return res.status(404).json({ message: "Stats not found" });
    res.json(stats);
  }));

  app.post("/api/user-stats/:userId/add-points", requireAuth, asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    if (userId !== req.session.userId) {
      return res.status(403).json({ message: "Operação não permitida" });
    }
    const points = Number(req.body?.points);
    if (!Number.isInteger(points) || points < 0 || points > 1000) {
      return res.status(400).json({ message: "Quantidade de pontos inválida" });
    }
    const updated = await storage.addPoints(userId, points);
    if (!updated) return res.status(404).json({ message: "Stats not found" });
    res.json(updated);
  }));

  // ── Denúncias (legacy) ────────────────────────────────────────────────────
  app.get("/api/denuncias", requireAuth, asyncHandler(async (_req, res) => {
    res.json(await storage.getDenuncias());
  }));

  app.post("/api/denuncias", asyncHandler(async (req, res) => {
    const parsed = denunciaSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Campos obrigatórios: titulo, descricao, categoria" });
    }
    const userId = req.session?.userId ?? null;
    const denuncia = await storage.createDenuncia({ ...parsed.data, userId });
    // Award points if authenticated
    if (userId) {
      const stats = await storage.getUserStats(userId);
      if (!stats) {
        await storage.createUserStats({ userId, points: 50, level: 1, denunciasCount: 1, achievement: "iniciante" });
      } else {
        await storage.addPoints(userId, 50);
        await storage.incrementDenuncias(userId);
      }
    }
    res.status(201).json(denuncia);
  }));

  // ── Chat property profile ─────────────────────────────────────────────────
  app.get("/api/chat/property-profile", requireAuth, asyncHandler(async (req, res) => {
    const profile = await storage.getPropertyProfile(req.session.userId!);
    res.json(profile ?? {});
  }));

  app.put("/api/chat/property-profile", requireAuth, asyncHandler(async (req, res) => {
    try {
      const profile = propertyProfileSchema.parse(req.body ?? {});
      const cleaned = Object.fromEntries(
        Object.entries(profile).filter(([, v]) => v !== undefined)
      ) as Record<string, string>;
      await storage.setPropertyProfile(req.session.userId!, Object.keys(cleaned).length > 0 ? cleaned : null);
      res.json(cleaned);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: zodMessage(err) });
      }
      throw err;
    }
  }));

  app.delete("/api/chat/property-profile", requireAuth, asyncHandler(async (req, res) => {
    await storage.setPropertyProfile(req.session.userId!, null);
    res.json({});
  }));

  // ── Chat IA ───────────────────────────────────────────────────────────────

  // Lightweight status check — no message consumed. Cached for 60s so polling
  // clients don't hit the OpenAI API on every request.
  let chatStatusCache: { at: number; body: { online: boolean; reason?: string } } | null = null;
  app.get("/api/chat/status", asyncHandler(async (_req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.json({ online: false, reason: "no_key" });
    }
    if (chatStatusCache && Date.now() - chatStatusCache.at < 60_000) {
      return res.json(chatStatusCache.body);
    }
    let body: { online: boolean; reason?: string };
    try {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(4000),
      });
      body = { online: r.ok };
    } catch {
      body = { online: false, reason: "unreachable" };
    }
    chatStatusCache = { at: Date.now(), body };
    return res.json(body);
  }));

  app.post("/api/chat", asyncHandler(async (req, res) => {
    const parsed = chatSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: zodMessage(parsed.error) });
    }
    try {
      const { message, history, propertyProfile } = parsed.data;
      const { getChatResponse } = await import("./chat-service.js");
      const result = await getChatResponse(message, history ?? [], propertyProfile ?? {});
      res.json(result);
    } catch (err) {
      console.error("[/api/chat] error:", err);
      // Return a structured 200 so the client can display the fallback gracefully
      res.json({
        response:
          "Sou o Assistente da Plataforma Preditiva de Inteligência Ambiental. No momento estou operando offline — posso ajudar com dúvidas sobre o índice de risco, fatores ambientais, protocolos de prevenção e como usar a plataforma.",
        usedFallback: true,
      });
    }
  }));

  // ── Python risk analysis proxy ────────────────────────────────────────────
  // POST /api/python-risk-analysis
  // Forwards the request to the FastAPI service. Falls back to the TypeScript
  // rule engine (same response format) if the Python service is unavailable.
  app.post("/api/python-risk-analysis", asyncHandler(async (req, res) => {
    const body: Record<string, unknown> =
      req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

    let pyRes: globalThis.Response | null = null;
    try {
      pyRes = await fetch(`${PYTHON_SERVICE_URL}/analyze-risk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      pyRes = null;
    }

    if (!pyRes) {
      // Python service unavailable — fall back to the TypeScript engine
      console.warn("[python-proxy] Serviço Python indisponível, usando o motor TypeScript");
      const fallback = analyzeWithRuleEngine(body);
      if (!fallback.ok) {
        return res.status(422).json({ message: `Dados inválidos: ${fallback.errors.join("; ")}` });
      }
      return res.json(fallback.data);
    }

    if (!pyRes.ok) {
      const errBody = await pyRes.text().catch(() => "");
      if (pyRes.status === 422) {
        return res.status(422).json({ message: describePythonValidationError(errBody) });
      }
      console.error("[python-proxy] Python service error:", pyRes.status, errBody.slice(0, 500));
      return res.status(502).json({ message: "Erro no serviço de análise Python" });
    }

    const data = await pyRes.json();
    // The Python service uses "critico" (no accent); the frontend uses "crítico".
    if (data && data.level === "critico") data.level = "crítico";
    return res.json(data);
  }));

  // ── Import Batches & Fire Occurrences ─────────────────────────────────────
  // POST /api/import-batches — save a validated import batch
  app.post("/api/import-batches", requireAuth, asyncHandler(async (req, res) => {
    const { filename, sourceName, records } = req.body ?? {};
    if (!filename || !Array.isArray(records)) {
      return res.status(400).json({ message: "filename e records são obrigatórios" });
    }
    if (records.length > 100_000) {
      return res.status(413).json({ message: "Arquivo com registros demais (máximo 100.000 por lote)." });
    }

    const statusOf = (r: any) => String(r?.validationStatus ?? "válido");
    const valid   = records.filter((r: any) => statusOf(r) === "válido").length;
    const warning = records.filter((r: any) => statusOf(r) === "válido com ressalvas").length;
    const invalid = records.filter((r: any) => statusOf(r) === "inválido").length;
    const dup     = records.filter((r: any) => statusOf(r) === "duplicado").length;

    // Persist only usable records (invalid and duplicate rows are counted, not stored)
    const toInsert = records.filter((r: any) => statusOf(r) !== "inválido" && statusOf(r) !== "duplicado");

    try {
      const batchId = await db.transaction(async (tx) => {
        const [batch] = await tx.insert(importBatches).values({
          filename: String(filename).slice(0, 255),
          sourceName: String(sourceName ?? "").slice(0, 255),
          sourceType: "arquivo importado",
          totalRows: records.length,
          validRows: valid,
          warningRows: warning,
          invalidRows: invalid,
          duplicateRows: dup,
          status: "concluído",
          importedBy: req.session.userId ?? null,
        }).returning();

        // PostgreSQL accepts at most 65535 parameters per statement — insert in chunks.
        const CHUNK_SIZE = 500;
        for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
          await tx.insert(fireOccurrences).values(
            toInsert.slice(i, i + CHUNK_SIZE).map((r: any) => ({
              importBatchId: batch.id,
              occurrenceDate: toStringOrNull(r.occurrenceDate),
              occurrenceTime: toStringOrNull(r.occurrenceTime),
              municipality: toStringOrNull(r.municipality),
              state: toStringOrNull(r.state),
              latitude: toNumberOrNull(r.latitude),
              longitude: toNumberOrNull(r.longitude),
              occurrenceType: toStringOrNull(r.occurrenceType),
              occurrenceStatus: toStringOrNull(r.occurrenceStatus),
              affectedArea: toNumberOrNull(r.affectedArea),
              cause: toStringOrNull(r.cause),
              vegetationCondition: toStringOrNull(r.vegetationCondition),
              notes: toStringOrNull(r.notes),
              source: toStringOrNull(r.source),
              sourceReference: toStringOrNull(r.sourceReference),
              validationStatus: statusOf(r),
              rawData: r.rawData ?? null,
            }))
          );
        }
        return batch.id;
      });

      return res.json({ batchId, saved: toInsert.length });
    } catch (err) {
      console.error("[import-batches] POST error:", err);
      if (isConnectionError(err)) {
        return res.status(503).json({ message: "Banco de dados indisponível. Verifique a configuração do DATABASE_URL." });
      }
      return res.status(500).json({ message: "Erro ao salvar lote de importação" });
    }
  }));

  // GET /api/import-batches
  app.get("/api/import-batches", requireAuth, asyncHandler(async (_req, res) => {
    try {
      const batches = await db.select().from(importBatches).orderBy(desc(importBatches.importedAt));
      return res.json(batches);
    } catch (err) {
      console.error("[import-batches] GET error:", err);
      return res.status(500).json({ message: "Erro ao listar lotes" });
    }
  }));

  // GET /api/fire-occurrences
  app.get("/api/fire-occurrences", requireAuth, asyncHandler(async (req, res) => {
    try {
      const batchId = req.query.batchId ? Number(req.query.batchId) : undefined;
      const rows = batchId && Number.isInteger(batchId)
        ? await db.select().from(fireOccurrences).where(eq(fireOccurrences.importBatchId, batchId))
        : await db.select().from(fireOccurrences);
      return res.json(rows);
    } catch (err) {
      console.error("[fire-occurrences] GET error:", err);
      return res.status(500).json({ message: "Erro ao listar ocorrências" });
    }
  }));

  // GET /api/data-sources
  app.get("/api/data-sources", asyncHandler(async (_req, res) => {
    try {
      const rows = await db.select().from(dataSources);
      return res.json(rows);
    } catch (err) {
      console.error("[data-sources] GET error:", err);
      return res.status(500).json({ message: "Erro ao listar fontes de dados" });
    }
  }));

  // Unknown API routes must answer with JSON 404 — not with the SPA's index.html.
  app.use("/api", (_req, res) => {
    res.status(404).json({ message: "Rota da API não encontrada" });
  });

  // Demo data (sensors, alerts, data sources and the demo account) is seeded
  // only into empty tables. Set SEED_DEMO_DATA=false to disable it.
  if (process.env.SEED_DEMO_DATA !== "false") {
    await seedDatabase();
  }

  return httpServer;
}

/** Creates the demo account shown on the login page (demo@ceres.ai / Demo123!) if missing. */
export async function ensureDemoUser() {
  const existing = await storage.getUserByEmail(DEMO_USER.email);
  if (existing) return;
  await storage.createUser({
    email: DEMO_USER.email,
    name: DEMO_USER.name,
    password: await hashPassword(DEMO_USER.password),
  });
  console.log(`[seed] Conta de demonstração criada: ${DEMO_USER.email}`);
}

async function seedDataSources() {
  const existing = await db.select({ id: dataSources.id }).from(dataSources).limit(1);
  if (existing.length > 0) return;
  await db.insert(dataSources).values([
    { name: "Open-Meteo — dados climáticos", type: "API ambiental", status: "em integração", isSimulated: false, quality: 0.9, description: "API pública de previsão meteorológica (temperatura, umidade, vento e precipitação). Integração em andamento." },
    { name: "Estações meteorológicas (demonstração)", type: "estação climática", status: "simulado", isSimulated: true, quality: 0.85, description: "Leituras de temperatura e umidade geradas para demonstração do fluxo de dados." },
    { name: "Sensores IoT de campo (demonstração)", type: "sensor IoT", status: "simulado", isSimulated: true, quality: 0.8, description: "Sensores simulados nas áreas monitoradas. A integração com sensores reais está prevista para a Prova de Valor." },
    { name: "Ocorrências históricas importadas", type: "base histórica", status: "ativo", isSimulated: false, quality: 0.75, description: "Registros de ocorrências importados por arquivo (CSV, XLS ou XLSX) no módulo de importação." },
    { name: "Base geográfica das áreas monitoradas", type: "base geográfica", status: "simulado", isSimulated: true, quality: 0.8, description: "Limites e coordenadas das áreas demonstrativas exibidas no mapa de risco." },
    { name: "Cenários do motor de risco", type: "simulação", status: "simulado", isSimulated: true, quality: 1, description: "Cenários demonstrativos (baixo, moderado, alto e crítico) usados para validar o motor de regras." },
  ]);
  console.log("[seed] Fontes de dados demonstrativas criadas");
}

export async function seedDatabase() {
  try {
    await ensureDemoUser();
  } catch (error) {
    console.warn("[seed] Conta de demonstração não criada:", error instanceof Error ? error.message : error);
  }

  try {
    await seedDataSources();
  } catch (error) {
    console.warn("[seed] Fontes de dados não criadas:", error instanceof Error ? error.message : error);
  }

  try {
    const sensors = await storage.getSensors();
    if (sensors.length === 0) {
      console.log("Seeding database...");
      const s1 = await storage.createSensor({
        name: "Estação Alfa",
        type: "Ambiental",
        location: "Setor Norte – Chapada dos Veadeiros",
        latitude: -14.1414,
        longitude: -47.6792,
        status: "active"
      });
      const s2 = await storage.createSensor({
        name: "Estação Beta",
        type: "Detecção de Incêndio",
        location: "Setor Leste – Vale do Paranã",
        latitude: -13.9500,
        longitude: -47.2000,
        status: "active"
      });
      const s3 = await storage.createSensor({
        name: "Estação Gama",
        type: "Qualidade do Ar",
        location: "Setor Sul – Alto Paraíso",
        latitude: -14.1230,
        longitude: -47.5100,
        status: "active"
      });

      await storage.createReading({ sensorId: s1.id, value: 36.8, unit: "°C" });
      await storage.createReading({ sensorId: s1.id, value: 28, unit: "%" });
      await storage.createReading({ sensorId: s2.id, value: 42.1, unit: "°C" });
      await storage.createReading({ sensorId: s3.id, value: 185, unit: "AQI" });

      console.log("Database seeded!");
    }

    const existingAlerts = await storage.getAlerts();

    if (existingAlerts.length === 0) {
      const allSensors = await storage.getSensors();
      const s1id = allSensors[0]?.id ?? 1;
      const s2id = allSensors[1]?.id ?? 2;
      const s3id = allSensors[2]?.id ?? (allSensors[0]?.id ?? 1);

      await storage.createAlert({
        sensorId: s2id,
        title: "🔥 Foco de Incêndio Detectado",
        message: "Sensor Beta registrou temperatura acima de 60°C no Setor Leste – Vale do Paranã. Possível foco ativo de queimada. Equipe de campo notificada para inspeção imediata.",
        severity: "critical"
      });

      await storage.createAlert({
        sensorId: s1id,
        title: "🌡️ Temperatura Crítica no Cerrado",
        message: "A temperatura no Setor Norte atingiu 42°C, superando o limiar de risco para incêndios. Umidade relativa abaixo de 15%. Risco de propagação de fogo é MUITO ALTO.",
        severity: "critical"
      });

      await storage.createAlert({
        sensorId: s3id,
        title: "💨 Qualidade do Ar – Nível Prejudicial",
        message: "Índice de Qualidade do Ar (IQA) atingiu 185 μg/m³ no Setor Sul. Partículas finas (PM2.5) em concentração prejudicial à saúde. Evite atividades ao ar livre.",
        severity: "critical"
      });

      await storage.createAlert({
        sensorId: s1id,
        title: "⚠️ Risco Elevado de Queimada",
        message: "Condições meteorológicas favoráveis a incêndios detectadas: ventos de 40 km/h, umidade 18%, temperatura 38°C. Período de seca prolongada na região há 45 dias.",
        severity: "medium"
      });

      await storage.createAlert({
        sensorId: s2id,
        title: "📡 Falha de Comunicação – Estação Beta",
        message: "A Estação Beta não transmite dados há 2 horas. Pode indicar dano físico por incêndio, queda de energia ou falha de rede. Manutenção preventiva solicitada.",
        severity: "medium"
      });

      await storage.createAlert({
        sensorId: s3id,
        title: "🌧️ Período de Seca Severa",
        message: "Dados meteorológicos indicam 52 dias sem chuva no Cerrado Central. Reservatórios locais abaixo de 20% da capacidade. Alerta de escassez hídrica para municípios da região.",
        severity: "medium"
      });

      await storage.createAlert({
        sensorId: s1id,
        title: "ℹ️ Atualização do Sistema",
        message: "Módulo de análise preditiva atualizado para versão 2.1. Novo algoritmo de detecção de focos com 94% de precisão integrado. Dados históricos do INPE incorporados à base.",
        severity: "low"
      });

      const resolved = await storage.createAlert({
        sensorId: s2id,
        title: "✅ Foco Controlado – Setor Leste",
        message: "Foco de incêndio no Setor Leste contido com sucesso pelas equipes do IBAMA. Área de 12 hectares afetada. Reflorestamento emergencial será iniciado em 30 dias.",
        severity: "medium"
      });
      await storage.resolveAlert(resolved.id);

      console.log("Alertas re-semeados em Português!");
    }
  } catch (error) {
    console.warn("Seed ignorado devido à indisponibilidade do banco:", error instanceof Error ? error.message : error);
  }
}
