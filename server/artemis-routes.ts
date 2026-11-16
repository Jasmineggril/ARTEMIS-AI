/**
 * ARTEMIS AI — organization-scoped API.
 *
 * Every query filters by req.ctx.organizationId, which comes from the session
 * and is re-verified against organization_members on each request
 * (requireOrg). Client-supplied organization ids are never trusted.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql, inArray, isNotNull } from "drizzle-orm";
import { db, pool } from "./db";
import {
  monitoredAreas, riskAnalyses, alerts, alertEvents, auditLogs, fireOccurrences, importBatches,
  organizations, organizationMembers, users, ALERT_STATUSES, ORG_ROLES,
  type MonitoredArea, type Alert,
} from "@shared/schema";
import { requireOrg, idParam, roleAtLeast, rateLimit, requireAuth } from "./security";
import { audit } from "./services/audit";
import {
  analysisRequestSchema, resolveInputs, runEngine, buildLimitations, buildDataSources,
  MissingInputError, distanceKm,
} from "./services/risk-service";
import { upsertAlertFromAnalysis, transitionAlert, TransitionError, shouldAlert, allowedTransitions, OPEN_STATUSES } from "./services/alert-service";
import { fetchRiskWeather, ConnectorError, OPEN_METEO_SOURCE } from "./connectors/open-meteo";
import { BR_STATES } from "@shared/br-states";
import { syncSisfogo } from "./services/sisfogo-sync";
import { sourceSyncRuns } from "@shared/schema";
import { SISFOGO_SOURCE } from "./connectors/sisfogo";

const ENGINE_VERSION_LABEL = "artemis-api-1.0.0";

// ─── Validation ──────────────────────────────────────────────────────────────

const lon = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);
const position = z.tuple([lon, lat]).or(z.tuple([lon, lat, z.number()]));
const ring = z
  .array(position)
  .min(4, "Anel do polígono precisa de ao menos 4 posições.")
  .max(5000, "Polígono muito detalhado (máx. 5000 vértices por anel).")
  .refine((r) => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1], "O anel do polígono deve ser fechado.");
export const boundarySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1).max(50) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(ring).min(1).max(50)).min(1).max(50) }),
]);

export const OPERATION_TYPES = [
  "propriedade_rural", "agroindustria", "florestal", "energia", "mineracao", "logistica", "industria",
  "unidade_conservacao", "outro",
] as const;

const areaBaseSchema = z.object({
  name: z.string().trim().min(2).max(160),
  operationType: z.enum(OPERATION_TYPES),
  municipality: z.string().trim().min(2).max(120),
  state: z.string().trim().toUpperCase().refine((s) => (BR_STATES as readonly string[]).includes(s), "UF inválida."),
  latitude: lat.nullable().optional(),
  longitude: lon.nullable().optional(),
  areaHectares: z.number().min(0).max(10_000_000).nullable().optional(),
  status: z.enum(["ativo", "inativo", "em análise"]).default("ativo"),
  vegetationCategory: z.string().trim().max(80).nullable().optional(),
  boundary: boundarySchema.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
const areaCreateSchema = areaBaseSchema.strict().refine(
  (a) => (a.latitude == null) === (a.longitude == null),
  "Informe latitude e longitude juntas.",
);
const areaUpdateSchema = areaBaseSchema.partial().strict();

function zodMessage(err: z.ZodError) {
  const i = err.errors[0];
  return i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message;
}

function handle(fn: (req: any, res: Response) => Promise<unknown>) {
  return async (req: any, res: Response, next: (e?: unknown) => void) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: zodMessage(err) });
      next(err);
    }
  };
}

async function loadArea(orgId: number, id: number | null): Promise<MonitoredArea | null> {
  if (!id) return null;
  const [a] = await db
    .select()
    .from(monitoredAreas)
    .where(and(eq(monitoredAreas.id, id), eq(monitoredAreas.organizationId, orgId)));
  return a ?? null;
}

async function loadAlert(orgId: number, id: number | null): Promise<Alert | null> {
  if (!id) return null;
  const [a] = await db.select().from(alerts).where(and(eq(alerts.id, id), eq(alerts.organizationId, orgId)));
  return a ?? null;
}

/** Count organization occurrences within radiusKm of a point. */
async function countNearbyOccurrences(orgId: number, latitude: number, longitude: number, radiusKm = 10) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));
  const rows = await db
    .select({ latitude: fireOccurrences.latitude, longitude: fireOccurrences.longitude })
    .from(fireOccurrences)
    .where(
      and(
        eq(fireOccurrences.organizationId, orgId),
        isNotNull(fireOccurrences.latitude),
        gte(fireOccurrences.latitude, latitude - dLat),
        lte(fireOccurrences.latitude, latitude + dLat),
        gte(fireOccurrences.longitude, longitude - dLng),
        lte(fireOccurrences.longitude, longitude + dLng),
      ),
    );
  return rows.filter((r) => distanceKm(latitude, longitude, r.latitude!, r.longitude!) <= radiusKm).length;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // CSV/formula injection protection for spreadsheet software
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerArtemisRoutes(app: Express) {
  const analysisLimiter = rateLimit({ windowMs: 60_000, max: 30, key: "analysis" });

  // Health (no auth; reveals no data)
  app.get("/api/health", async (_req, res) => {
    let database = "down";
    try {
      if (pool) {
        await pool.query("SELECT 1");
        database = "ok";
      }
    } catch { /* down */ }
    let riskEngine = "unavailable";
    if ((process.env.RISK_ENGINE ?? "python") === "ts") riskEngine = "ts-only";
    else {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 1500);
        const r = await fetch(`${process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8000"}/health`, { signal: c.signal });
        clearTimeout(t);
        riskEngine = r.ok ? "ok" : "degraded";
      } catch { riskEngine = "unavailable (fallback TypeScript ativo)"; }
    }
    res.status(database === "ok" ? 200 : 503).json({ status: database === "ok" ? "ok" : "degraded", database, riskEngine, time: new Date().toISOString() });
  });

  // ── Organization ───────────────────────────────────────────────────────────
  app.get("/api/organization", requireOrg(), handle(async (req, res) => {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, req.ctx.organizationId));
    res.json({ ...org, role: req.ctx.role });
  }));

  app.get("/api/organization/members", requireOrg("admin"), handle(async (req, res) => {
    const rows = await db
      .select({ userId: users.id, name: users.name, email: users.email, role: organizationMembers.role, since: organizationMembers.createdAt })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, req.ctx.organizationId))
      .orderBy(organizationMembers.id);
    res.json(rows);
  }));

  app.post("/api/organization/members", requireOrg("admin"), handle(async (req, res) => {
    const input = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ORG_ROLES) }).strict().parse(req.body);
    if (input.role === "owner" && req.ctx.role !== "owner") {
      return res.status(403).json({ message: "Somente o proprietário pode conceder o papel de proprietário." });
    }
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (!user) return res.status(404).json({ message: "Usuário não encontrado. Ele precisa criar uma conta antes." });
    const inserted = await db
      .insert(organizationMembers)
      .values({ organizationId: req.ctx.organizationId, userId: user.id, role: input.role })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return res.status(409).json({ message: "Usuário já é membro desta organização." });
    await audit(req, "org.member_added", { type: "user", id: user.id }, { role: input.role });
    res.status(201).json(inserted[0]);
  }));

  app.patch("/api/organization/members/:userId", requireOrg("admin"), handle(async (req, res) => {
    const userId = idParam(req.params.userId);
    const { role } = z.object({ role: z.enum(ORG_ROLES) }).strict().parse(req.body);
    if (!userId) return res.status(400).json({ message: "Identificador inválido." });
    if ((role === "owner" || userId === req.ctx.userId) && req.ctx.role !== "owner") {
      return res.status(403).json({ message: "Operação reservada ao proprietário." });
    }
    const [updated] = await db
      .update(organizationMembers)
      .set({ role })
      .where(and(eq(organizationMembers.organizationId, req.ctx.organizationId), eq(organizationMembers.userId, userId)))
      .returning();
    if (!updated) return res.status(404).json({ message: "Membro não encontrado." });
    await audit(req, "org.member_role_changed", { type: "user", id: userId }, { role });
    res.json(updated);
  }));

  app.delete("/api/organization/members/:userId", requireOrg("admin"), handle(async (req, res) => {
    const userId = idParam(req.params.userId);
    if (!userId) return res.status(400).json({ message: "Identificador inválido." });
    if (userId === req.ctx.userId) return res.status(400).json({ message: "Você não pode remover a si mesmo." });
    const [target] = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, req.ctx.organizationId), eq(organizationMembers.userId, userId)));
    if (!target) return res.status(404).json({ message: "Membro não encontrado." });
    if (target.role === "owner" && req.ctx.role !== "owner") {
      return res.status(403).json({ message: "Somente o proprietário pode remover outro proprietário." });
    }
    await db.delete(organizationMembers).where(eq(organizationMembers.id, target.id));
    await audit(req, "org.member_removed", { type: "user", id: userId });
    res.status(204).send();
  }));

  // ── Monitored areas ────────────────────────────────────────────────────────
  app.get("/api/areas", requireOrg(), handle(async (req, res) => {
    const areas = await db
      .select()
      .from(monitoredAreas)
      .where(eq(monitoredAreas.organizationId, req.ctx.organizationId))
      .orderBy(monitoredAreas.name);
    // latest analysis per area (single query)
    const ids = areas.map((a) => a.id);
    const latest = ids.length
      ? await db
          .selectDistinctOn([riskAnalyses.areaId], {
            areaId: riskAnalyses.areaId, id: riskAnalyses.id, score: riskAnalyses.score, level: riskAnalyses.level,
            createdAt: riskAnalyses.createdAt, engineType: riskAnalyses.engineType, isExperimental: riskAnalyses.isExperimental,
          })
          .from(riskAnalyses)
          .where(and(eq(riskAnalyses.organizationId, req.ctx.organizationId), inArray(riskAnalyses.areaId, ids)))
          .orderBy(riskAnalyses.areaId, desc(riskAnalyses.createdAt))
      : [];
    const byArea = new Map(latest.map((l) => [l.areaId, l]));
    res.json(areas.map((a) => ({ ...a, latestAnalysis: byArea.get(a.id) ?? null })));
  }));

  app.post("/api/areas", requireOrg("manager"), handle(async (req, res) => {
    const input = areaCreateSchema.parse(req.body);
    const [area] = await db
      .insert(monitoredAreas)
      .values({ ...input, organizationId: req.ctx.organizationId, createdBy: req.ctx.userId })
      .returning();
    await audit(req, "area.created", { type: "area", id: area.id }, { name: area.name });
    res.status(201).json(area);
  }));

  app.get("/api/areas/:id", requireOrg(), handle(async (req, res) => {
    const area = await loadArea(req.ctx.organizationId, idParam(req.params.id));
    if (!area) return res.status(404).json({ message: "Área não encontrada." });
    res.json(area);
  }));

  app.patch("/api/areas/:id", requireOrg("manager"), handle(async (req, res) => {
    const area = await loadArea(req.ctx.organizationId, idParam(req.params.id));
    if (!area) return res.status(404).json({ message: "Área não encontrada." });
    const input = areaUpdateSchema.parse(req.body);
    const nextLat = input.latitude !== undefined ? input.latitude : area.latitude;
    const nextLng = input.longitude !== undefined ? input.longitude : area.longitude;
    if ((nextLat == null) !== (nextLng == null)) return res.status(400).json({ message: "Informe latitude e longitude juntas." });
    const [updated] = await db
      .update(monitoredAreas)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(monitoredAreas.id, area.id), eq(monitoredAreas.organizationId, req.ctx.organizationId)))
      .returning();
    await audit(req, "area.updated", { type: "area", id: area.id }, { fields: Object.keys(input) });
    res.json(updated);
  }));

  app.delete("/api/areas/:id", requireOrg("admin"), handle(async (req, res) => {
    const area = await loadArea(req.ctx.organizationId, idParam(req.params.id));
    if (!area) return res.status(404).json({ message: "Área não encontrada." });
    // Analyses are kept for traceability (area_id becomes dangling but org-scoped).
    await db.delete(monitoredAreas).where(and(eq(monitoredAreas.id, area.id), eq(monitoredAreas.organizationId, req.ctx.organizationId)));
    await audit(req, "area.deleted", { type: "area", id: area.id }, { name: area.name });
    res.status(204).send();
  }));

  app.get("/api/areas/:id/weather", requireOrg(), handle(async (req, res) => {
    const area = await loadArea(req.ctx.organizationId, idParam(req.params.id));
    if (!area) return res.status(404).json({ message: "Área não encontrada." });
    if (area.latitude == null || area.longitude == null) return res.status(422).json({ message: "Área sem coordenadas." });
    try {
      const w = await fetchRiskWeather(area.latitude, area.longitude);
      res.json({ ...w, sourceInfo: OPEN_METEO_SOURCE });
    } catch (err) {
      const msg = err instanceof ConnectorError ? err.message : "Falha no conector meteorológico.";
      res.status(503).json({ message: msg, source: OPEN_METEO_SOURCE.key });
    }
  }));

  // ── Risk analyses ───────────────────────────────────────────────
  app.post("/api/areas/:id/analyses", requireOrg("analyst"), analysisLimiter, handle(async (req, res) => {
    const area = await loadArea(req.ctx.organizationId, idParam(req.params.id));
    if (!area) return res.status(404).json({ message: "Área não encontrada." });
    const request = analysisRequestSchema.parse(req.body);

    const historical =
      area.latitude != null && area.longitude != null
        ? await countNearbyOccurrences(req.ctx.organizationId, area.latitude, area.longitude)
        : null;

    let resolved;
    try {
      resolved = await resolveInputs(request, area, historical);
    } catch (err) {
      if (err instanceof MissingInputError) {
        return res.status(422).json({
          message: `${err.message}. Informe os valores manualmente${err.connectorError ? ` (${err.connectorError})` : ""}.`,
          missing: err.missing,
          connectorError: err.connectorError ?? null,
        });
      }
      throw err;
    }

    const engine = await runEngine(resolved);
    const limitations = buildLimitations(resolved, engine);
    const dataSources = buildDataSources(resolved);
    const dataQuality = {
      level: resolved.qualityLabel,
      provenance: resolved.provenance,
      missingFields: [] as string[],
      connectorError: resolved.connectorError ?? null,
    };

    const [analysis] = await db
      .insert(riskAnalyses)
      .values({
        organizationId: req.ctx.organizationId,
        areaId: area.id,
        score: engine.score,
        level: engine.level,
        confidence: null, // no uncalibrated confidence percentages
        inputData: { ...resolved.engineInput, notes: request.notes ?? null },
        factors: engine.factors,
        recommendations: engine.recommendations,
        isSimulated: false,
        calculationVersion: `${ENGINE_VERSION_LABEL}/${engine.modelVersion}`,
        engineType: engine.engineType,
        isExperimental: engine.isExperimental,
        dataSources,
        dataQuality,
        limitations,
        createdBy: req.ctx.userId,
      })
      .returning();

    let alertResult: { id: number; created: boolean } | null = null;
    if (shouldAlert(engine.level)) {
      const top = [...engine.factors]
        .filter((f) => f.contribution > 0)
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 3)
        .map((f) => `${f.name} (${f.value})`);
      const { alert, created } = await upsertAlertFromAnalysis({
        organizationId: req.ctx.organizationId,
        areaId: area.id,
        areaName: area.name,
        analysisId: analysis.id,
        score: engine.score,
        level: engine.level,
        topFactors: top,
        recommendations: engine.recommendations,
        dataSource: dataSources.map((s) => s.name).join(" + "),
        dataReferenceAt: resolved.weather ? new Date(resolved.weather.referenceAt) : null,
        userId: req.ctx.userId,
      });
      alertResult = { id: alert.id, created };
    }

    await audit(req, "analysis.created", { type: "risk_analysis", id: analysis.id }, {
      areaId: area.id, score: engine.score, level: engine.level, engine: engine.engineType,
    });
    res.status(201).json({ ...analysis, alert: alertResult });
  }));

  app.get("/api/areas/:id/analyses", requireOrg(), handle(async (req, res) => {
    const area = await loadArea(req.ctx.organizationId, idParam(req.params.id));
    if (!area) return res.status(404).json({ message: "Área não encontrada." });
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await db
      .select()
      .from(riskAnalyses)
      .where(and(eq(riskAnalyses.organizationId, req.ctx.organizationId), eq(riskAnalyses.areaId, area.id)))
      .orderBy(desc(riskAnalyses.createdAt))
      .limit(limit);
    res.json(rows);
  }));

  app.get("/api/analyses/:id", requireOrg(), handle(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: "Identificador inválido." });
    const [row] = await db
      .select()
      .from(riskAnalyses)
      .where(and(eq(riskAnalyses.id, id), eq(riskAnalyses.organizationId, req.ctx.organizationId)));
    if (!row) return res.status(404).json({ message: "Análise não encontrada." });
    res.json(row);
  }));

  // ── Alerts ─────────────────────────────────────────────────────────────────
  app.get("/api/alerts", requireOrg(), handle(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const conds = [eq(alerts.organizationId, req.ctx.organizationId)];
    if (status === "abertos") conds.push(inArray(alerts.status, OPEN_STATUSES));
    else if (status && (ALERT_STATUSES as readonly string[]).includes(status)) conds.push(eq(alerts.status, status));
    const areaId = idParam(req.query.areaId);
    if (areaId) conds.push(eq(alerts.areaId, areaId));
    const rows = await db.select().from(alerts).where(and(...conds)).orderBy(desc(alerts.updatedAt)).limit(500);
    res.json(rows.map((a) => ({ ...a, allowedTransitions: allowedTransitions(a.status as any) })));
  }));

  app.get("/api/alerts/:id", requireOrg(), handle(async (req, res) => {
    const alert = await loadAlert(req.ctx.organizationId, idParam(req.params.id));
    if (!alert) return res.status(404).json({ message: "Alerta não encontrado." });
    const events = await db
      .select({
        id: alertEvents.id, fromStatus: alertEvents.fromStatus, toStatus: alertEvents.toStatus,
        note: alertEvents.note, createdAt: alertEvents.createdAt, userName: users.name,
      })
      .from(alertEvents)
      .leftJoin(users, eq(users.id, alertEvents.userId))
      .where(eq(alertEvents.alertId, alert.id))
      .orderBy(alertEvents.createdAt, alertEvents.id);
    res.json({ ...alert, events, allowedTransitions: allowedTransitions(alert.status as any) });
  }));

  app.post("/api/alerts/:id/status", requireOrg("analyst"), handle(async (req, res) => {
    const alert = await loadAlert(req.ctx.organizationId, idParam(req.params.id));
    if (!alert) return res.status(404).json({ message: "Alerta não encontrado." });
    const input = z
      .object({ status: z.enum(ALERT_STATUSES), note: z.string().trim().max(2000).optional(), assignToMe: z.boolean().optional() })
      .strict()
      .parse(req.body);
    if (input.status === "descartado" && !input.note) {
      return res.status(400).json({ message: "Informe o motivo do descarte." });
    }
    try {
      const updated = await transitionAlert({
        alert, to: input.status, note: input.note, userId: req.ctx.userId,
        assignedTo: input.assignToMe ? req.ctx.userId : undefined,
      });
      await audit(req, "alert.status_changed", { type: "alert", id: alert.id }, { from: alert.status, to: input.status });
      res.json(updated);
    } catch (err) {
      if (err instanceof TransitionError) return res.status(409).json({ message: err.message });
      throw err;
    }
  }));

  // ── Occurrences (historical, imported) ─────────────────────────────────────
  app.get("/api/fire-occurrences", requireOrg(), handle(async (req, res) => {
    const q = z
      .object({
        batchId: z.coerce.number().int().positive().optional(),
        state: z.string().trim().toUpperCase().length(2).optional(),
        municipality: z.string().trim().max(120).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(req.query);
    const conds = [eq(fireOccurrences.organizationId, req.ctx.organizationId)];
    if (q.batchId) conds.push(eq(fireOccurrences.importBatchId, q.batchId));
    if (q.state) conds.push(eq(fireOccurrences.state, q.state));
    if (q.municipality) conds.push(sql`lower(${fireOccurrences.municipality}) = lower(${q.municipality})`);
    if (q.from) conds.push(gte(fireOccurrences.occurrenceDate, q.from));
    if (q.to) conds.push(lte(fireOccurrences.occurrenceDate, q.to));
    const rows = await db.select().from(fireOccurrences).where(and(...conds)).orderBy(desc(fireOccurrences.occurrenceDate)).limit(5000);
    res.json(rows);
  }));

  // ── Dashboard ──────────────────────────────────────────────────────────────
  app.get("/api/dashboard/summary", requireOrg(), handle(async (req, res) => {
    const orgId = req.ctx.organizationId;
    const [{ areas: areaCount }] = await db.select({ areas: sql<number>`count(*)::int` }).from(monitoredAreas).where(eq(monitoredAreas.organizationId, orgId));
    const latest = await db
      .selectDistinctOn([riskAnalyses.areaId], { areaId: riskAnalyses.areaId, level: riskAnalyses.level, score: riskAnalyses.score, createdAt: riskAnalyses.createdAt })
      .from(riskAnalyses)
      .innerJoin(monitoredAreas, eq(monitoredAreas.id, riskAnalyses.areaId))
      .where(and(eq(riskAnalyses.organizationId, orgId), eq(monitoredAreas.organizationId, orgId)))
      .orderBy(riskAnalyses.areaId, desc(riskAnalyses.createdAt));
    const byLevel: Record<string, number> = { baixo: 0, moderado: 0, alto: 0, "crítico": 0 };
    latest.forEach((l) => { byLevel[l.level] = (byLevel[l.level] ?? 0) + 1; });

    const alertCounts = await db
      .select({ status: alerts.status, n: sql<number>`count(*)::int` })
      .from(alerts)
      .where(eq(alerts.organizationId, orgId))
      .groupBy(alerts.status);
    const statusMap = Object.fromEntries(alertCounts.map((a) => [a.status, a.n]));
    const [{ occ }] = await db.select({ occ: sql<number>`count(*)::int` }).from(fireOccurrences).where(eq(fireOccurrences.organizationId, orgId));
    const trend = await db
      .select({ date: sql<string>`to_char(date_trunc('day', ${riskAnalyses.createdAt}), 'YYYY-MM-DD')`, avg: sql<number>`round(avg(${riskAnalyses.score}))::int`, max: sql<number>`max(${riskAnalyses.score})::int`, n: sql<number>`count(*)::int` })
      .from(riskAnalyses)
      .where(and(eq(riskAnalyses.organizationId, orgId), gte(riskAnalyses.createdAt, sql`now() - interval '90 days'`)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const [lastAnalysis] = await db.select({ at: riskAnalyses.createdAt }).from(riskAnalyses).where(eq(riskAnalyses.organizationId, orgId)).orderBy(desc(riskAnalyses.createdAt)).limit(1);
    const [lastImport] = await db.select({ at: importBatches.importedAt }).from(importBatches).where(eq(importBatches.organizationId, orgId)).orderBy(desc(importBatches.importedAt)).limit(1);

    res.json({
      generatedAt: new Date().toISOString(),
      areas: { total: areaCount, analyzed: latest.length, notAnalyzed: areaCount - latest.length, byLatestLevel: byLevel,
        source: "Análises armazenadas da organização (última por área)", lastUpdate: lastAnalysis?.at ?? null },
      alerts: {
        active: OPEN_STATUSES.reduce((s, st) => s + (statusMap[st] ?? 0), 0),
        resolved: statusMap["resolvido"] ?? 0,
        discarded: statusMap["descartado"] ?? 0,
        byStatus: statusMap,
        source: "Alertas emitidos pelas análises da organização",
      },
      occurrences: { total: occ, source: "Arquivos importados pela organização (não é integração oficial com o Sisfogo)", lastUpdate: lastImport?.at ?? null },
      riskTrend: { period: "últimos 90 dias", points: trend, source: "Média diária dos índices das análises" },
    });
  }));

  // ── Reports (CSV export) ───────────────────────────────────────────────────
  app.get("/api/reports/areas/:id/analyses.csv", requireOrg("analyst"), handle(async (req, res) => {
    const area = await loadArea(req.ctx.organizationId, idParam(req.params.id));
    if (!area) return res.status(404).json({ message: "Área não encontrada." });
    const rows = await db
      .select()
      .from(riskAnalyses)
      .where(and(eq(riskAnalyses.organizationId, req.ctx.organizationId), eq(riskAnalyses.areaId, area.id)))
      .orderBy(desc(riskAnalyses.createdAt));
    const csv = toCsv(
      ["analise_id", "data_hora_utc", "area", "municipio", "uf", "indice", "nivel", "motor", "versao", "experimental", "qualidade_dados", "fontes", "fatores", "limitacoes"],
      rows.map((r) => [
        r.id, r.createdAt?.toISOString(), area.name, area.municipality, area.state, r.score, r.level, r.engineType,
        r.calculationVersion, r.isExperimental ? "sim" : "não", (r.dataQuality as any)?.level ?? "",
        ((r.dataSources as any[]) ?? []).map((s) => s.name).join(" | "),
        ((r.factors as any[]) ?? []).map((f) => `${f.name}=${f.contribution}`).join(" | "),
        ((r.limitations as string[]) ?? []).join(" | "),
      ]),
    );
    await audit(req, "report.exported", { type: "area", id: area.id }, { format: "csv", rows: rows.length });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="artemis-area-${area.id}-analises.csv"`);
    res.send("﻿" + csv);
  }));

  // ── Report per area and period (JSON, printable in the UI) ─────────────────
  const periodSchema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });
  function periodBounds(q: z.infer<typeof periodSchema>) {
    const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00.000Z`) : new Date(to.getTime() - 90 * 86_400_000);
    if (from > to) throw new z.ZodError([{ code: "custom", path: ["from"], message: "Data inicial posterior à final." }]);
    return { from, to };
  }

  app.get("/api/reports/areas/:id", requireOrg(), handle(async (req, res) => {
    const area = await loadArea(req.ctx.organizationId, idParam(req.params.id));
    if (!area) return res.status(404).json({ message: "Área não encontrada." });
    const { from, to } = periodBounds(periodSchema.parse(req.query));
    const orgId = req.ctx.organizationId;

    const analyses = await db
      .select()
      .from(riskAnalyses)
      .where(and(eq(riskAnalyses.organizationId, orgId), eq(riskAnalyses.areaId, area.id),
        gte(riskAnalyses.createdAt, from), lte(riskAnalyses.createdAt, to)))
      .orderBy(desc(riskAnalyses.createdAt));
    const areaAlerts = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.organizationId, orgId), eq(alerts.areaId, area.id),
        gte(alerts.createdAt, from), lte(alerts.createdAt, to)))
      .orderBy(desc(alerts.createdAt));

    const distribution: Record<string, number> = { baixo: 0, moderado: 0, alto: 0, "crítico": 0 };
    const sources = new Map<string, { name: string; count: number }>();
    const engines = new Map<string, number>();
    const limitations = new Set<string>();
    const quality: Record<string, number> = {};
    for (const a of analyses) {
      distribution[a.level] = (distribution[a.level] ?? 0) + 1;
      for (const s of (a.dataSources as any[]) ?? []) {
        const cur = sources.get(s.key) ?? { name: s.name, count: 0 };
        cur.count++;
        sources.set(s.key, cur);
      }
      const eng = `${a.engineType ?? "?"} · ${a.calculationVersion ?? "?"}`;
      engines.set(eng, (engines.get(eng) ?? 0) + 1);
      ((a.limitations as string[]) ?? []).forEach((l) => limitations.add(l));
      const ql = (a.dataQuality as any)?.level ?? "não informada";
      quality[ql] = (quality[ql] ?? 0) + 1;
    }
    const scores = analyses.map((a) => a.score);
    await audit(req, "report.viewed", { type: "area", id: area.id }, { from: from.toISOString(), to: to.toISOString() });
    res.json({
      generatedAt: new Date().toISOString(),
      systemVersion: ENGINE_VERSION_LABEL,
      period: { from: from.toISOString(), to: to.toISOString() },
      area,
      summary: {
        analyses: analyses.length,
        experimental: analyses.filter((a) => a.isExperimental).length,
        scoreMin: scores.length ? Math.min(...scores) : null,
        scoreMax: scores.length ? Math.max(...scores) : null,
        scoreAvg: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
        distribution,
        qualityLevels: quality,
      },
      sources: Array.from(sources, ([key, v]) => ({ key, ...v })),
      engines: Array.from(engines, ([engine, count]) => ({ engine, count })),
      analyses: analyses.map((a) => ({
        id: a.id, createdAt: a.createdAt, score: a.score, level: a.level, engineType: a.engineType,
        isExperimental: a.isExperimental,
        topFactors: ((a.factors as any[]) ?? []).filter((f) => f.contribution > 0)
          .sort((x, y) => y.contribution - x.contribution).slice(0, 3).map((f) => `${f.name} (${f.value})`),
      })),
      alerts: areaAlerts.map((a) => ({
        id: a.id, createdAt: a.createdAt, severity: a.severity, status: a.status, occurrenceCount: a.occurrenceCount,
        recommendations: a.recommendations,
      })),
      limitations: Array.from(limitations),
    });
  }));

  // ── Organization-wide indicators (Inteligência Operacional) ────────────────
  app.get("/api/insights", requireOrg(), handle(async (req, res) => {
    const { from, to } = periodBounds(periodSchema.parse(req.query));
    const orgId = req.ctx.organizationId;
    const inPeriod = and(eq(riskAnalyses.organizationId, orgId), gte(riskAnalyses.createdAt, from), lte(riskAnalyses.createdAt, to));

    const weekly = await db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${riskAnalyses.createdAt}), 'YYYY-MM-DD')`,
        level: riskAnalyses.level,
        n: sql<number>`count(*)::int`,
      })
      .from(riskAnalyses).where(inPeriod).groupBy(sql`1`, riskAnalyses.level).orderBy(sql`1`);
    const factorRows = await db.select({ factors: riskAnalyses.factors }).from(riskAnalyses).where(inPeriod);
    const factorCount = new Map<string, number>();
    for (const r of factorRows) {
      for (const f of (r.factors as any[]) ?? []) {
        if (f?.contribution > 0) factorCount.set(f.name, (factorCount.get(f.name) ?? 0) + 1);
      }
    }
    const alertStatus = await db
      .select({ status: alerts.status, n: sql<number>`count(*)::int` })
      .from(alerts)
      .where(and(eq(alerts.organizationId, orgId), gte(alerts.createdAt, from), lte(alerts.createdAt, to)))
      .groupBy(alerts.status);
    const occMonthly = await db
      .select({ month: sql<string>`coalesce(to_char(${fireOccurrences.occurrenceAt}, 'YYYY-MM'), substr(${fireOccurrences.occurrenceDate}, 1, 7))`, n: sql<number>`count(*)::int` })
      .from(fireOccurrences)
      .where(and(eq(fireOccurrences.organizationId, orgId), isNotNull(fireOccurrences.occurrenceDate)))
      .groupBy(sql`1`).orderBy(sql`1`);

    const weeks = new Map<string, Record<string, number>>();
    for (const w of weekly) {
      const row = weeks.get(w.week) ?? { baixo: 0, moderado: 0, alto: 0, "crítico": 0 };
      row[w.level] = w.n;
      weeks.set(w.week, row);
    }
    res.json({
      generatedAt: new Date().toISOString(),
      period: { from: from.toISOString(), to: to.toISOString() },
      analysesByWeek: { source: "Análises armazenadas da organização", points: Array.from(weeks, ([week, v]) => ({ week, ...v })) },
      frequentFactors: {
        source: "Fatores que elevaram o índice nas análises do período",
        items: Array.from(factorCount, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
        totalAnalyses: factorRows.length,
      },
      alertsByStatus: { source: "Alertas emitidos no período", items: alertStatus },
      occurrencesByMonth: { source: "Ocorrências importadas (todas as datas; não é integração oficial com o Sisfogo)", points: occMonthly },
    });
  }));

  // ── Audit log ──────────────────────────────────────────────────────────────
  app.get("/api/audit-logs", requireOrg("admin"), handle(async (req, res) => {
    const rows = await db
      .select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId,
        metadata: auditLogs.metadata, createdAt: auditLogs.createdAt, userName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(eq(auditLogs.organizationId, req.ctx.organizationId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(Math.min(Number(req.query.limit) || 200, 1000));
    res.json(rows);
  }));

  // ── Data source registry (honest status) ───────────────────────────────────
  app.get("/api/connectors", (_req, res) => {
    res.json([
      { ...OPEN_METEO_SOURCE, status: "implementado", note: "Usado sob demanda na análise de risco. Sem armazenamento contínuo." },
      { key: "inpe-queimadas", name: "INPE — Programa Queimadas (focos de calor)", url: "https://terrabrasilis.dpi.inpe.br/queimadas/portal/", status: "não integrado", note: "Pendente: avaliar formato, licença e condições de acesso. Focos de calor não equivalem a incêndios confirmados." },
      { ...SISFOGO_SOURCE, status: "implementado", note: "API pública oficial (ROIs finalizados). Sincronização via POST /api/sync/sisfogo." },
      { key: "ibge", name: "IBGE — malhas territoriais e municípios", url: "https://servicodados.ibge.gov.br/api/docs", status: "não integrado", note: "Pendente." },
      { key: "file-import", name: "Importação de arquivos da organização", status: "implementado", note: "CSV, XLS e XLSX com validação e relatório por lote." },
    ]);
  });

  // ── Sisfogo sync (official public API) ─────────────────────────────────────
  app.post("/api/sync/sisfogo", requireAuth, async (req, res, next) => {
    try {
      const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.session!.userId!));
      if (u?.role !== "platform_admin") return res.status(403).json({ message: "Acesso restrito à administração da plataforma." });
    } catch (e) { return next(e); }
    try {
      const summary = await syncSisfogo();
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/source-sync-runs", requireAuth, async (_req, res, next) => {
    try {
      const rows = await db.select().from(sourceSyncRuns).orderBy(desc(sourceSyncRuns.startedAt)).limit(100);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });
}

export { roleAtLeast };
