import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { alerts, importBatches, fireOccurrences, dataSources } from "@shared/schema";
import { hashPassword, verifyPassword } from "./auth";
import { calculateRisk } from "@shared/risk-engine";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth
  app.post(api.auth.signup.path, async (req, res) => {
    try {
      const input = api.auth.signup.input.parse(req.body);
      const existing = await storage.getUserByEmail(input.email);
      if (existing) {
        return res.status(400).json({ message: "Email já cadastrado" });
      }

      const user = await storage.createUser({
        ...input,
        password: await hashPassword(input.password),
      });

      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.name = user.name;
      res.status(201).json({ id: user.id, email: user.email, name: user.name });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post(api.auth.login.path, async (req, res) => {
    try {
      const input = api.auth.login.input.parse(req.body);
      const user = await storage.getUserByEmail(input.email);
      
      const passwordValid = user && await verifyPassword(
        input.password,
        user.password,
        user.id,
        async (userId, newHash) => {
          await storage.updateUser(userId, { password: newHash } as any);
        },
      );
      if (!passwordValid) {
        return res.status(401).json({ message: "Email ou senha inválidos" });
      }

      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.name = user.name;
      res.json({ id: user.id, email: user.email, name: user.name });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post(api.auth.logout.path, (req, res) => {
    req.session.destroy(() => {});
    res.json({});
  });

  app.put("/api/auth/password", async (req, res) => {
    try {
      const session = (req as any).session;
      if (!session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const input = z.object({
        currentPassword: z.string().min(1, "Senha atual é obrigatória"),
        newPassword: z.string().min(6, "A nova senha deve ter pelo menos 6 caracteres"),
      }).parse(req.body);

      const user = await storage.getUserById(session.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const passwordValid = await verifyPassword(
        input.currentPassword,
        user.password,
        user.id,
        async (userId, newHash) => {
          await storage.updateUser(userId, { password: newHash } as any);
        },
      );

      if (!passwordValid) {
        return res.status(400).json({ message: "Senha atual incorreta" });
      }

      const newHash = await hashPassword(input.newPassword);
      await storage.updateUser(session.userId, { password: newHash } as any);

      res.json({ message: "Senha alterada com sucesso" });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.get("/api/auth/status", (req, res) => {
    if (req.session?.userId) {
      res.json({ userId: req.session.userId, email: req.session.email, name: req.session.name });
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  app.get(api.user.profile.get.path, async (req, res) => {
    const session = (req as any).session;
    if (!session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await storage.getUserById(session.userId);
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
  });

  app.put(api.user.profile.update.path, async (req, res) => {
    try {
      const input = api.user.profile.update.input.parse(req.body);
      const session = (req as any).session;
      if (!session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (input.email) {
        const existing = await storage.getUserByEmail(input.email);
        if (existing && existing.id !== session.userId) {
          return res.status(400).json({ message: "Email já está em uso" });
        }
      }

      const updated = await storage.updateUser(session.userId, input);
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }

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
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Sensors
  app.get(api.sensors.list.path, async (req, res) => {
    const sensors = await storage.getSensors();
    res.json(sensors);
  });

  app.get(api.sensors.get.path, async (req, res) => {
    const sensor = await storage.getSensor(Number(req.params.id));
    if (!sensor) return res.status(404).json({ message: "Sensor not found" });
    res.json(sensor);
  });

  app.post(api.sensors.create.path, async (req, res) => {
    try {
      const input = api.sensors.create.input.parse(req.body);
      const sensor = await storage.createSensor(input);
      res.status(201).json(sensor);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.sensors.update.path, async (req, res) => {
    try {
      const input = api.sensors.update.input.parse(req.body);
      const sensor = await storage.updateSensor(Number(req.params.id), input);
      if (!sensor) return res.status(404).json({ message: "Sensor not found" });
      res.json(sensor);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete(api.sensors.delete.path, async (req, res) => {
    await storage.deleteSensor(Number(req.params.id));
    res.status(204).send();
  });

  // Readings
  app.get(api.readings.list.path, async (req, res) => {
    const sensorId = req.query.sensorId ? Number(req.query.sensorId) : undefined;
    const readings = await storage.getReadings(sensorId);
    res.json(readings);
  });

  app.post(api.readings.create.path, async (req, res) => {
    try {
      const input = api.readings.create.input.parse(req.body);
      const reading = await storage.createReading(input);
      res.status(201).json(reading);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Alerts
  app.get(api.alerts.list.path, async (req, res) => {
    const alerts = await storage.getAlerts();
    res.json(alerts);
  });

  app.post(api.alerts.create.path, async (req, res) => {
    try {
      const input = api.alerts.create.input.parse(req.body);
      const alert = await storage.createAlert(input);
      res.status(201).json(alert);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.patch(api.alerts.resolve.path, async (req, res) => {
    const alert = await storage.resolveAlert(Number(req.params.id));
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    res.json(alert);
  });

  // Gamification — user stats
  app.get("/api/user-stats/me", async (req, res) => {
    const session = (req as any).session;
    if (!session) return res.status(401).json({ message: "Not authenticated" });
    let stats = await storage.getUserStats(session.userId);
    if (!stats) {
      stats = await storage.createUserStats({ userId: session.userId, points: 0, level: 1, denunciasCount: 0, achievement: "iniciante" });
    }
    res.json(stats);
  });

  app.get("/api/user-stats/:userId", async (req, res) => {
    const stats = await storage.getUserStats(Number(req.params.userId));
    if (!stats) return res.status(404).json({ message: "Stats not found" });
    res.json(stats);
  });

  app.post("/api/user-stats/:userId/add-points", async (req, res) => {
    const { points } = req.body;
    const updated = await storage.addPoints(Number(req.params.userId), points);
    res.json(updated || { error: "User not found" });
  });

  // Denúncias
  app.get("/api/denuncias", async (req, res) => {
    const items = await storage.getDenuncias();
    res.json(items);
  });

  app.post("/api/denuncias", async (req, res) => {
    try {
      const session = (req as any).session;
      const data = req.body;
      if (!data.titulo || !data.descricao || !data.categoria) {
        return res.status(400).json({ message: "Campos obrigatórios: titulo, descricao, categoria" });
      }
      const denuncia = await storage.createDenuncia({
        ...data,
        userId: session?.userId ?? null,
      });
      // Award points if authenticated
      if (session?.userId) {
        let stats = await storage.getUserStats(session.userId);
        if (!stats) {
          await storage.createUserStats({ userId: session.userId, points: 50, level: 1, denunciasCount: 1, achievement: "iniciante" });
        } else {
          await storage.addPoints(session.userId, 50);
          await storage.incrementDenuncias(session.userId);
        }
      }
      res.status(201).json(denuncia);
    } catch (err) {
      res.status(500).json({ message: "Erro ao criar denúncia" });
    }
  });

  // ── Chat property profile ────────────────────────────────────────────────────

  const propertyProfileSchema = z.object({
    municipality: z.string().optional(),
    state: z.string().optional(),
    biome: z.string().optional(),
    propertySize: z.string().optional(),
  });

  app.get("/api/chat/property-profile", async (req, res) => {
    const session = (req as any).session;
    if (!session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const profile = await storage.getPropertyProfile(session.userId);
    res.json(profile ?? {});
  });

  app.put("/api/chat/property-profile", async (req, res) => {
    try {
      const session = (req as any).session;
      if (!session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const profile = propertyProfileSchema.parse(req.body);
      const cleaned = Object.fromEntries(
        Object.entries(profile).filter(([, v]) => v !== undefined)
      ) as Record<string, string>;
      await storage.setPropertyProfile(session.userId, Object.keys(cleaned).length > 0 ? cleaned : null);
      res.json(cleaned);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/chat/property-profile", async (req, res) => {
    const session = (req as any).session;
    if (!session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    await storage.setPropertyProfile(session.userId, null);
    res.json({});
  });

  // ── Chat IA ─────────────────────────────────────────────────────────────────

  // Lightweight status check — no message consumed, no cost
  app.get("/api/chat/status", async (_req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.json({ online: false, reason: "no_key" });
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.json({ online: r.ok });
    } catch {
      return res.json({ online: false, reason: "unreachable" });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history, propertyProfile } = req.body as {
        message: string;
        history?: { role: "user" | "assistant"; content: string }[];
        propertyProfile?: Record<string, string>;
      };
      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({ message: "Campo 'message' é obrigatório." });
      }
      const { getChatResponse } = await import("./chat-service.js");
      const result = await getChatResponse(message.trim(), history ?? [], propertyProfile ?? {});
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
  });

  // ── Python risk analysis proxy ────────────────────────────────────────────
  // POST /api/python-risk-analysis
  // Forwards the request to the FastAPI service. Falls back to the TypeScript
  // rule engine if the Python service is unavailable (demo mode only).
  app.post("/api/python-risk-analysis", async (req, res) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      let pyRes: Response;
      try {
        pyRes = await fetch(`${PYTHON_SERVICE_URL}/analyze-risk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
          signal: controller.signal,
        });
        clearTimeout(timeout);
      } catch (fetchErr) {
        clearTimeout(timeout);
        // Python service unavailable — fall back to TypeScript engine
        console.warn("[python-proxy] Python service unavailable, using TS fallback");
        const { temperature, humidity, wind_speed, recent_rainfall,
                vegetation_condition, nearby_hotspot, hotspot_distance,
                historical_occurrences, data_quality } = req.body ?? {};

        const vegMap: Record<string, number> = { very_dry: 0, dry: 1, moderate: 2, humid: 3 };
        const qualityMap: Record<string, number> = { poor: 0, regular: 1, good: 2, excellent: 3 };

        const result = calculateRisk({
          temperature: Number(temperature ?? 30),
          humidity: Number(humidity ?? 50),
          windSpeed: Number(wind_speed ?? 10),
          recentRainfall: Number(recent_rainfall ?? 0),
          vegetationCondition: (vegMap[vegetation_condition] ?? 2) as 0|1|2|3,
          nearbyHotspot: Boolean(nearby_hotspot),
          hotspotDistance: Number(hotspot_distance ?? 0),
          historicalOccurrences: Number(historical_occurrences ?? 0),
          dataQuality: (qualityMap[data_quality] ?? 2) as 0|1|2|3,
        }, false);

        return res.json({
          score: result.score,
          level: result.level,
          confidence: result.confidence,
          factors: result.factors.map(f => ({ factor: f.name, impact: f.weight, value: f.value })),
          recommendations: result.recommendations.map(r => r.action),
          model_type: "transparent-rule-engine-ts-fallback",
          model_version: result.calculationVersion,
          is_simulated: false,
          calculated_at: result.calculatedAt,
          _fallback: true,
        });
      }

      if (!pyRes.ok) {
        const errBody = await pyRes.text().catch(() => "");
        return res.status(pyRes.status).json({ message: "Python service error", detail: errBody });
      }

      const data = await pyRes.json();
      return res.json(data);
    } catch (err) {
      console.error("[python-proxy] Unexpected error:", err);
      return res.status(500).json({ message: "Erro interno no proxy Python" });
    }
  });

  // ── Import Batches & Fire Occurrences ────────────────────────────────────
  // POST /api/import-batches — save a validated import batch
  app.post("/api/import-batches", async (req, res) => {
    const session = (req as any).session;
    if (!session?.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const { filename, sourceName, records } = req.body ?? {};
      if (!filename || !Array.isArray(records)) {
        return res.status(400).json({ message: "filename e records são obrigatórios" });
      }

      const valid   = records.filter((r: any) => r.validationStatus === "válido").length;
      const warning = records.filter((r: any) => r.validationStatus === "válido com ressalvas").length;
      const invalid = records.filter((r: any) => r.validationStatus === "inválido").length;
      const dup     = records.filter((r: any) => r.validationStatus === "duplicado").length;

      const [batch] = await db.insert(importBatches).values({
        filename: String(filename),
        sourceName: String(sourceName ?? ""),
        sourceType: "arquivo importado",
        totalRows: records.length,
        validRows: valid,
        warningRows: warning,
        invalidRows: invalid,
        duplicateRows: dup,
        status: "concluído",
        importedBy: (req as any).session?.userId ?? null,
      }).returning();

      // Insert occurrences (skip hard-invalid)
      const toInsert = records.filter((r: any) =>
        r.validationStatus !== "inválido" && r.validationStatus !== "duplicado"
      );
      if (toInsert.length > 0) {
        await db.insert(fireOccurrences).values(
          toInsert.map((r: any) => ({
            importBatchId: batch.id,
            occurrenceDate: r.occurrenceDate ?? null,
            occurrenceTime: r.occurrenceTime ?? null,
            municipality: r.municipality ?? null,
            state: r.state ?? null,
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
            validationStatus: r.validationStatus ?? "válido",
            rawData: r.rawData ?? null,
          }))
        );
      }

      return res.json({ batchId: batch.id, saved: toInsert.length });
    } catch (err) {
      console.error("[import-batches] POST error:", err);
      return res.status(500).json({ message: "Erro ao salvar lote de importação" });
    }
  });

  // GET /api/import-batches
  app.get("/api/import-batches", async (req, res) => {
    const session = (req as any).session;
    if (!session?.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const batches = await db.select().from(importBatches).orderBy(importBatches.importedAt);
      return res.json(batches);
    } catch (err) {
      console.error("[import-batches] GET error:", err);
      return res.status(500).json({ message: "Erro ao listar lotes" });
    }
  });

  // GET /api/fire-occurrences
  app.get("/api/fire-occurrences", async (req, res) => {
    const sessionAuth = (req as any).session;
    if (!sessionAuth?.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const batchId = req.query.batchId ? Number(req.query.batchId) : undefined;
      const rows = batchId
        ? await db.select().from(fireOccurrences).where(eq(fireOccurrences.importBatchId, batchId))
        : await db.select().from(fireOccurrences);
      return res.json(rows);
    } catch (err) {
      console.error("[fire-occurrences] GET error:", err);
      return res.status(500).json({ message: "Erro ao listar ocorrências" });
    }
  });

  // GET /api/data-sources
  app.get("/api/data-sources", async (_req, res) => {
    try {
      const rows = await db.select().from(dataSources);
      return res.json(rows);
    } catch (err) {
      console.error("[data-sources] GET error:", err);
      return res.status(500).json({ message: "Erro ao listar fontes de dados" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    try {
      await seedDatabase();
    } catch (error) {
      console.warn("Seed inicial ignorado por indisponibilidade do banco:", error instanceof Error ? error.message : error);
    }
  }

  return httpServer;
}

export async function seedDatabase() {
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
