import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { db } from "./db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { importBatches, fireOccurrences, dataSources, users, municipalities } from "@shared/schema";
import { calculateRisk } from "@shared/risk-engine";
import { registerAuthRoutes } from "./auth-routes";
import { registerArtemisRoutes } from "./artemis-routes";
import { registerPublicRoutes } from "./public-routes";
import { rateLimit, requireAuth, requireOrg, requirePlatformAdmin } from "./security";
import { registerSisfogoRoutes } from "./sisfogo-routes";
import { registerAdminRoutes } from "./admin-routes";
import { registerEvidenceRoutes } from "./evidence-routes";
import { registerNotificationRoutes } from "./notification-routes";
import { registerInmetRoutes } from "./inmet-routes";
import { audit } from "./services/audit";
import { fetchWeatherData } from "./weather-service";
import { normalizeOccurrenceDate } from "@shared/dates";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8000";


function zodError(res: Response, err: unknown) {
  if (err instanceof z.ZodError) {
    res.status(400).json({ message: err.errors[0].message });
    return true;
  }
  return false;
}

const profileUpdateSchema = z
  .object({
    firstName: z.string().trim().max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    bio: z.string().max(1000).optional(),
    // avatar accepts only https URLs or small data:image URIs
    avatar: z
      .string()
      .max(400_000)
      .refine((v) => v === "" || /^https:\/\//.test(v) || /^data:image\/(png|jpe?g|webp);base64,/.test(v), "Avatar inválido.")
      .optional(),
  })
  .strict(); // `role` is deliberately NOT accepted (previous privilege escalation)

const IMPORT_STATUSES = ["válido", "válido com ressalvas", "inválido", "duplicado"] as const;
const importRecordSchema = z
  .object({
    occurrenceDate: z.string().max(40).nullable().optional(),
    occurrenceTime: z.string().max(20).nullable().optional(),
    municipality: z.string().max(160).nullable().optional(),
    state: z.string().max(40).nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    occurrenceType: z.string().max(160).nullable().optional(),
    occurrenceStatus: z.string().max(160).nullable().optional(),
    affectedArea: z.number().nullable().optional(),
    cause: z.string().max(300).nullable().optional(),
    vegetationCondition: z.string().max(160).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    source: z.string().max(300).nullable().optional(),
    sourceReference: z.string().max(300).nullable().optional(),
    validationStatus: z.enum(IMPORT_STATUSES),
    validationMessages: z.array(z.string().max(300)).max(50).optional(),
    rawData: z.record(z.unknown()).nullable().optional(),
  })
  .passthrough();

/** Server-side re-validation: the client preview is never trusted alone. */
export function revalidateImportRecord(r: z.infer<typeof importRecordSchema>) {
  const reasons: string[] = [];
  let status: (typeof IMPORT_STATUSES)[number] = r.validationStatus;
  if (r.latitude != null && (r.latitude < -90 || r.latitude > 90)) reasons.push("latitude fora da faixa válida");
  if (r.longitude != null && (r.longitude < -180 || r.longitude > 180)) reasons.push("longitude fora da faixa válida");
  if (r.affectedArea != null && r.affectedArea < 0) reasons.push("área afetada negativa");
  let isoDate: string | null = null;
  if (r.occurrenceDate) {
    isoDate = normalizeOccurrenceDate(r.occurrenceDate);
    if (!isoDate) reasons.push("data inválida");
  }
  if (reasons.length) status = "inválido";
  return { status, reasons, isoDate };
}

/** Same normalisation as scripts/load-ibge-municipalities.ts. */
export function normalizeMunicipalityName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Resolves IBGE codes from (UF, name) using the municipalities table; NULL when unknown or table empty. */
async function municipalityResolver(tx: any, states: (string | null | undefined)[]) {
  const ufs = Array.from(new Set(states.filter(Boolean).map((s) => String(s).toUpperCase().slice(0, 2))));
  const map = new Map<string, string>();
  if (ufs.length) {
    const rows = await tx.select().from(municipalities).where(inArray(municipalities.state, ufs));
    for (const m of rows) map.set(`${m.state}|${m.nameNormalized}`, m.ibgeCode);
  }
  return (state?: string | null, name?: string | null) =>
    state && name ? map.get(`${state.toUpperCase().slice(0, 2)}|${normalizeMunicipalityName(name)}`) ?? null : null;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  registerAuthRoutes(app);
  registerArtemisRoutes(app);
  registerPublicRoutes(app);
  registerSisfogoRoutes(app);
  registerAdminRoutes(app);
  registerEvidenceRoutes(app);
  registerNotificationRoutes(app);
  registerInmetRoutes(app);

  // ── Profile ────────────────────────────────────────────────────────────────
  app.get(api.user.profile.get.path, requireAuth, async (req, res) => {
    const user = await storage.getUserById(req.session.userId!);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });
    res.json({
      firstName: user.firstName ?? "", lastName: user.lastName ?? "", email: user.email, role: user.role,
      bio: user.bio ?? "", avatar: user.avatar ?? "", usingFallback: storage.isFallbackActive(),
    });
  });

  app.put(api.user.profile.update.path, requireAuth, async (req, res, next) => {
    try {
      const input = profileUpdateSchema.parse(req.body);
      if (input.email) {
        const existing = await storage.getUserByEmail(input.email);
        if (existing && existing.id !== req.session.userId) return res.status(400).json({ message: "E-mail já está em uso." });
      }
      const updated = await storage.updateUser(req.session.userId!, input);
      if (!updated) return res.status(404).json({ message: "Usuário não encontrado." });
      await audit(req, "user.profile_updated", { type: "user", id: updated.id }, { fields: Object.keys(input) });
      res.json({
        firstName: updated.firstName ?? "", lastName: updated.lastName ?? "", email: updated.email, role: updated.role,
        bio: updated.bio ?? "", avatar: updated.avatar ?? "", usingFallback: storage.isFallbackActive(),
      });
    } catch (err) {
      if (!zodError(res, err)) next(err);
    }
  });

  // ── Sensors / readings (legacy, platform-level; not yet organization-scoped) ─
  app.get(api.sensors.list.path, requireAuth, async (_req, res) => res.json(await storage.getSensors()));
  app.get(api.sensors.get.path, requireAuth, async (req, res) => {
    const sensor = await storage.getSensor(Number(req.params.id));
    if (!sensor) return res.status(404).json({ message: "Sensor não encontrado." });
    res.json(sensor);
  });
  app.post(api.sensors.create.path, requirePlatformAdmin, async (req, res, next) => {
    try {
      res.status(201).json(await storage.createSensor(api.sensors.create.input.parse(req.body)));
    } catch (err) {
      if (!zodError(res, err)) next(err);
    }
  });
  app.put(api.sensors.update.path, requirePlatformAdmin, async (req, res, next) => {
    try {
      const sensor = await storage.updateSensor(Number(req.params.id), api.sensors.update.input.parse(req.body));
      if (!sensor) return res.status(404).json({ message: "Sensor não encontrado." });
      res.json(sensor);
    } catch (err) {
      if (!zodError(res, err)) next(err);
    }
  });
  app.delete(api.sensors.delete.path, requirePlatformAdmin, async (req, res) => {
    await storage.deleteSensor(Number(req.params.id));
    res.status(204).send();
  });
  app.get(api.readings.list.path, requireAuth, async (req, res) => {
    const sensorId = req.query.sensorId ? Number(req.query.sensorId) : undefined;
    res.json(await storage.getReadings(sensorId));
  });
  app.post(api.readings.create.path, requirePlatformAdmin, async (req, res, next) => {
    try {
      res.status(201).json(await storage.createReading(api.readings.create.input.parse(req.body)));
    } catch (err) {
      if (!zodError(res, err)) next(err);
    }
  });

  // ── Weather (legacy card) ──────────────────────────────────────────────────
  app.get(api.weather.latest.path, requireAuth, async (_req, res) => {
    res.json((await storage.getLatestWeather()) ?? null);
  });
  app.post(api.weather.fetch.path, requireAuth, rateLimit({ windowMs: 60_000, max: 10, key: "weather" }), async (req, res, next) => {
    try {
      const { latitude, longitude } = api.weather.fetch.input
        .refine((c) => Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180, "Coordenadas inválidas.")
        .parse(req.body);
      const w = await fetchWeatherData(latitude, longitude);
      if (!w) return res.status(503).json({ message: "Fonte meteorológica indisponível. Nenhum dado foi inventado." });
      res.status(201).json(await storage.createWeatherData(w));
    } catch (err) {
      if (!zodError(res, err)) next(err);
    }
  });

  // ── Gamification (legacy) — only the caller's own stats ───────────────────
  app.get("/api/user-stats/me", requireAuth, async (req, res) => {
    let stats = await storage.getUserStats(req.session.userId!);
    if (!stats) {
      stats = await storage.createUserStats({ userId: req.session.userId!, points: 0, level: 1, denunciasCount: 0, achievement: "iniciante" });
    }
    res.json(stats);
  });

  // ── Environmental reports (legacy "denúncias") ─────────────────────────────
  // Listing exposes personal data: restricted to platform administrators
  // until the moderated incident-report module is implemented.
  app.get("/api/denuncias", requirePlatformAdmin, async (_req, res) => res.json(await storage.getDenuncias()));

  const denunciaSchema = z
    .object({
      titulo: z.string().trim().min(3).max(160),
      descricao: z.string().trim().min(10).max(4000),
      categoria: z.string().trim().min(2).max(80),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
      municipio: z.string().trim().max(120).nullable().optional(),
    })
    .strict();
  app.post("/api/denuncias", rateLimit({ windowMs: 60 * 60_000, max: 5, key: "denuncia" }), async (req, res, next) => {
    try {
      const data = denunciaSchema.parse(req.body);
      const d = await storage.createDenuncia({ ...data, userId: req.session?.userId ?? null });
      res.status(201).json({
        id: d.id,
        status: d.status,
        message:
          "Relato registrado para análise. Este canal NÃO é um serviço de emergência e não aciona autoridades. " +
          "Em caso de perigo imediato, ligue 193 (Corpo de Bombeiros).",
      });
    } catch (err) {
      if (!zodError(res, err)) next(err);
    }
  });

  // ── Chat property profile ──────────────────────────────────────────────────
  const propertyProfileSchema = z
    .object({
      municipality: z.string().max(120).optional(),
      state: z.string().max(40).optional(),
      biome: z.string().max(60).optional(),
      propertySize: z.string().max(60).optional(),
    })
    .strict();

  app.get("/api/chat/property-profile", requireAuth, async (req, res) => {
    res.json((await storage.getPropertyProfile(req.session.userId!)) ?? {});
  });
  app.put("/api/chat/property-profile", requireAuth, async (req, res, next) => {
    try {
      const profile = propertyProfileSchema.parse(req.body);
      const cleaned = Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== undefined)) as Record<string, string>;
      await storage.setPropertyProfile(req.session.userId!, Object.keys(cleaned).length > 0 ? cleaned : null);
      res.json(cleaned);
    } catch (err) {
      if (!zodError(res, err)) next(err);
    }
  });
  app.delete("/api/chat/property-profile", requireAuth, async (req, res) => {
    await storage.setPropertyProfile(req.session.userId!, null);
    res.json({});
  });

  // ── Chat assistant (external paid API → auth + rate limit) ─────────────────
  const chatLimiter = rateLimit({ windowMs: 60_000, max: 10, key: "chat" });
  app.get("/api/chat/status", requireAuth, chatLimiter, async (_req, res) => {
    res.json({ online: Boolean(process.env.OPENAI_API_KEY), reason: process.env.OPENAI_API_KEY ? undefined : "no_key" });
  });
  app.post("/api/chat", requireAuth, chatLimiter, async (req, res) => {
    try {
      const body = z
        .object({
          message: z.string().trim().min(1).max(2000),
          history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(20).optional(),
          propertyProfile: z.record(z.string().max(120)).optional(),
        })
        .parse(req.body);
      const { getChatResponse } = await import("./chat-service.js");
      res.json(await getChatResponse(body.message, body.history ?? [], body.propertyProfile ?? {}));
    } catch (err) {
      if (zodError(res, err)) return;
      console.error(JSON.stringify({ level: "error", msg: "chat_failed", err: String(err) }));
      res.json({
        response: "O assistente está offline no momento. Consulte a Central de Ajuda para dúvidas sobre o índice de risco e protocolos de prevenção.",
        usedFallback: true,
      });
    }
  });

  // ── Public simulator (not stored; no organization data) ────────────────────
  const simulatorSchema = z.object({
    temperature: z.number().min(-20).max(60),
    humidity: z.number().min(0).max(100),
    wind_speed: z.number().min(0).max(200),
    recent_rainfall: z.number().min(0).max(2000).default(0),
    vegetation_condition: z.enum(["very_dry", "dry", "moderate", "humid"]).default("moderate"),
    nearby_hotspot: z.boolean().default(false),
    hotspot_distance: z.number().min(0).max(1000).nullable().optional(),
    historical_occurrences: z.number().int().min(0).max(100000).default(0),
    data_quality: z.enum(["poor", "regular", "good", "excellent"]).default("good"),
  });
  app.post("/api/python-risk-analysis", rateLimit({ windowMs: 60_000, max: 30, key: "simulator" }), async (req, res) => {
    let body: z.infer<typeof simulatorSchema>;
    try {
      body = simulatorSchema.parse(req.body);
    } catch (err) {
      zodError(res, err);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const pyRes = await fetch(`${PYTHON_SERVICE_URL}/analyze-risk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!pyRes.ok) return res.status(502).json({ message: "Serviço de análise retornou erro." });
      return res.json({ ...(await pyRes.json()), is_simulation: true });
    } catch {
      const vegMap: Record<string, 0 | 1 | 2 | 3> = { very_dry: 0, dry: 1, moderate: 2, humid: 3 };
      const qualityMap: Record<string, 0 | 1 | 2 | 3> = { poor: 0, regular: 1, good: 2, excellent: 3 };
      const result = calculateRisk({
        temperature: body.temperature, humidity: body.humidity, windSpeed: body.wind_speed,
        recentRainfall: body.recent_rainfall, vegetationCondition: vegMap[body.vegetation_condition],
        nearbyHotspot: body.nearby_hotspot, hotspotDistance: body.hotspot_distance ?? 0,
        historicalOccurrences: body.historical_occurrences, dataQuality: qualityMap[body.data_quality],
      }, false);
      return res.json({
        score: result.score, level: result.level, confidence: result.confidence,
        factors: result.factors, recommendations: result.recommendations,
        model_type: "transparent-rule-engine-ts-fallback", model_version: result.calculationVersion,
        dataset_type: "rule-based", is_simulated: false, is_experimental: false, is_simulation: true,
        calculated_at: result.calculatedAt, _fallback: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  // ── Import batches (organization-scoped) ───────────────────────────────────
  app.post("/api/import-batches", requireOrg("manager"), async (req, res, next) => {
    try {
      const body = z
        .object({
          filename: z.string().trim().min(1).max(255),
          sourceName: z.string().trim().max(255).optional(),
          records: z.array(importRecordSchema).min(1).max(50_000),
        })
        .parse(req.body);
      const orgId = req.ctx!.organizationId;

      const checked = body.records.map((r) => ({ r, ...revalidateImportRecord(r) }));
      const count = (s: string) => checked.filter((c) => c.status === s).length;
      const reasons: Record<string, number> = {};
      checked.forEach((c) => {
        const msgs = c.status === "inválido" || c.status === "duplicado" ? [...c.reasons, ...(c.r.validationMessages ?? [])] : [];
        if (c.status === "duplicado" && msgs.length === 0) msgs.push("registro duplicado");
        if (c.status === "inválido" && msgs.length === 0) msgs.push("inválido na validação do arquivo");
        msgs.forEach((m) => { reasons[m] = (reasons[m] ?? 0) + 1; });
      });

      const result = await db.transaction(async (tx) => {
        const [batch] = await tx
          .insert(importBatches)
          .values({
            filename: body.filename,
            sourceName: body.sourceName ?? "",
            sourceType: "arquivo importado",
            totalRows: checked.length,
            validRows: count("válido"),
            warningRows: count("válido com ressalvas"),
            invalidRows: count("inválido"),
            duplicateRows: count("duplicado"),
            status: "concluído",
            importedBy: req.ctx!.userId,
            organizationId: orgId,
            rejectionReasons: reasons,
            notes: "Importação manual de arquivo autorizado. Não representa integração oficial com o Sisfogo.",
          })
          .returning();
        const toInsert = checked.filter((c) => c.status === "válido" || c.status === "válido com ressalvas");
        const ibge = await municipalityResolver(tx, toInsert.map(({ r }) => r.state));
        let inserted = { valid: 0, warning: 0 };
        for (let i = 0; i < toInsert.length; i += 1000) {
          const rows = await tx
            .insert(fireOccurrences)
            .values(
              toInsert.slice(i, i + 1000).map(({ r, status, isoDate }) => ({
                importBatchId: batch.id,
                organizationId: orgId,
                occurrenceDate: isoDate,
                occurrenceTime: r.occurrenceTime ?? null,
                municipality: r.municipality ?? null,
                state: r.state ? r.state.toUpperCase().slice(0, 40) : null,
                municipalityIbgeCode: ibge(r.state, r.municipality),
                latitude: r.latitude ?? null,
                longitude: r.longitude ?? null,
                occurrenceType: r.occurrenceType ?? null,
                occurrenceStatus: r.occurrenceStatus ?? null,
                affectedArea: r.affectedArea ?? null,
                cause: r.cause ?? null,
                vegetationCondition: r.vegetationCondition ?? null,
                notes: r.notes ?? null,
                source: r.source ?? null,
                sourceReference: r.sourceReference ?? null,
                validationStatus: status,
                rawData: r.rawData ?? null,
              })),
            )
            // Same occurrence already stored for this organization (any batch): skip, count as duplicate.
            .onConflictDoNothing({
              target: [fireOccurrences.organizationId, fireOccurrences.dedupKey],
              where: sql`${fireOccurrences.dedupKey} IS NOT NULL`,
            })
            .returning({ status: fireOccurrences.validationStatus });
          rows.forEach((x) => { if (x.status === "válido") inserted.valid++; else inserted.warning++; });
        }
        const saved = inserted.valid + inserted.warning;
        const crossBatchDuplicates = toInsert.length - saved;
        let finalBatch = batch;
        if (crossBatchDuplicates > 0) {
          const reason = "duplicado de ocorrência já importada pela organização";
          [finalBatch] = await tx
            .update(importBatches)
            .set({
              validRows: inserted.valid,
              warningRows: inserted.warning,
              duplicateRows: count("duplicado") + crossBatchDuplicates,
              rejectionReasons: { ...reasons, [reason]: (reasons[reason] ?? 0) + crossBatchDuplicates },
            })
            .where(eq(importBatches.id, batch.id))
            .returning();
        }
        return { batch: finalBatch, saved };
      });

      await audit(req, "import.batch_created", { type: "import_batch", id: result.batch.id }, {
        filename: body.filename, total: checked.length, saved: result.saved,
      });
      res.status(201).json({ batchId: result.batch.id, saved: result.saved, report: result.batch });
    } catch (err) {
      if (!zodError(res, err)) next(err);
    }
  });

  app.get("/api/import-batches", requireOrg(), async (req, res, next) => {
    try {
      res.json(
        await db.select().from(importBatches).where(eq(importBatches.organizationId, req.ctx!.organizationId)).orderBy(desc(importBatches.importedAt)),
      );
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/import-batches/:id", requireOrg(), async (req, res, next) => {
    try {
      const [b] = await db
        .select()
        .from(importBatches)
        .where(and(eq(importBatches.id, Number(req.params.id)), eq(importBatches.organizationId, req.ctx!.organizationId)));
      if (!b) return res.status(404).json({ message: "Lote não encontrado." });
      res.json(b);
    } catch (err) {
      next(err);
    }
  });

  // Explicit publication of a batch to the public Consulta Pública (admin only).
  app.patch("/api/import-batches/:id/visibility", requireOrg("admin"), async (req, res, next) => {
    try {
      const { visibility, confirm } = z
        .object({ visibility: z.enum(["privado", "publico"]), confirm: z.boolean().optional() })
        .strict()
        .parse(req.body);
      if (visibility === "publico" && confirm !== true) {
        return res.status(400).json({ message: "Confirme que a organização tem direito de publicar estes dados." });
      }
      const [b] = await db
        .update(importBatches)
        .set({
          visibility,
          publishedAt: visibility === "publico" ? new Date() : null,
          publishedBy: visibility === "publico" ? req.ctx!.userId : null,
        })
        .where(and(eq(importBatches.id, Number(req.params.id)), eq(importBatches.organizationId, req.ctx!.organizationId)))
        .returning();
      if (!b) return res.status(404).json({ message: "Lote não encontrado." });
      await audit(req, visibility === "publico" ? "import.batch_published" : "import.batch_unpublished", { type: "import_batch", id: b.id });
      res.json(b);
    } catch (err) {
      if (!zodError(res, err)) next(err);
    }
  });

  app.get("/api/data-sources", async (_req, res, next) => {
    try {
      res.json(await db.select().from(dataSources));
    } catch (err) {
      next(err);
    }
  });

  return httpServer;
}
