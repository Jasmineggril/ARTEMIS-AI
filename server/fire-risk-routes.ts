/**
 * Fire-risk indices (official INPE product) for the map, point queries and monitored areas.
 *   GET /api/fire-risk/available                       public: days available per index/product
 *   GET /api/fire-risk/grid?index&product&day&lead     public: 0.2° grid (mean and max per cell)
 *   GET /api/fire-risk/point?lat&lng[&day]             public: values of the 0.2° cell containing the point
 *   GET /api/areas/:id/fire-risk?from&to               member: daily series for the property + latest forecast
 *   GET /api/areas/:id/haines                          member: Haines index (pressure levels) or "indisponivel" with the reason
 */
import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { fireRiskGrids, monitoredAreas } from "@shared/schema";
import { requireOrg, rateLimit, idParam } from "./security";
import { RF_CLASS_LABEL, RF_CLASS_LIMITS, INPE_RF_VERSION } from "@shared/inpe-fire-risk";
import { hainesForPoint } from "./services/haines";
import { centroid, type BoundaryGeom } from "@shared/geometry";

export const RF_METHOD = {
  name: `Risco de Fogo do INPE, modelo ${INPE_RF_VERSION}`,
  nature: "indice_oficial",
  what: "Índice meteorológico (0–1) de quão propícia a vegetação está para queimar, a partir de 120 dias de chuva, temperatura máxima e umidade mínima (18 UTC), tipo de vegetação, latitude e elevação.",
  notThis: "Não é detecção de fogo, não é incêndio confirmado e não é probabilidade calibrada de ocorrência.",
  classes: [
    { key: "minimo", label: RF_CLASS_LABEL.minimo, range: `≤ ${RF_CLASS_LIMITS.minimo}` }, { key: "baixo", label: RF_CLASS_LABEL.baixo, range: `${RF_CLASS_LIMITS.minimo}–${RF_CLASS_LIMITS.baixo}` },
    { key: "medio", label: RF_CLASS_LABEL.medio, range: `${RF_CLASS_LIMITS.baixo}–${RF_CLASS_LIMITS.medio}` }, { key: "alto", label: RF_CLASS_LABEL.alto, range: `${RF_CLASS_LIMITS.medio}–${RF_CLASS_LIMITS.alto}` },
    { key: "critico", label: RF_CLASS_LABEL.critico, range: `> ${RF_CLASS_LIMITS.alto}` },
  ],
  reference: "INPE, Anuário Risco de Fogo 2025 (Tabela 3.1); script operacional publicado pelo INPE; documento QMD003-2000-PRO-001-A.",
  source: "Fonte: Programa Queimadas/INPE (dados abertos)",
  limits: [
    "Resolução de 1 km; entradas meteorológicas de 25–50 km (GFS) e 10 km (IMERG) interpoladas.",
    "Não é calculado sobre áreas urbanas e corpos d'água; nesses casos a ARTEMIS usa o pixel válido mais próximo (até 5 km) e informa.",
    "O observado de um dia é publicado na madrugada seguinte; a previsão (até 3 dias) usa o modelo GFS.",
  ],
};

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function registerFireRiskRoutes(app: Express) {
  const limiter = rateLimit({ windowMs: 60_000, max: 120, key: "fire-risk-public" });

  app.get("/api/fire-risk/available", limiter, async (_req, res, next) => {
    try {
      const rows = (await db.execute(sql`
        SELECT index_key AS "index", product, lead_days AS lead, array_agg(valid_day::text ORDER BY valid_day DESC) AS days
        FROM (SELECT index_key, product, lead_days, valid_day FROM fire_risk_grids ORDER BY valid_day DESC) g GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)).rows;
      res.json({ layers: rows, method: RF_METHOD });
    } catch (e) { next(e); }
  });

  app.get("/api/fire-risk/grid", limiter, async (req, res, next) => {
    try {
      const q = z.object({ index: z.enum(["inpe_rf_oficial", "inpe_dias_sem_chuva"]).default("inpe_rf_oficial"), product: z.enum(["observado", "previsto"]).default("observado"),
        day: DAY.optional(), lead: z.coerce.number().int().min(0).max(10).default(0) }).safeParse(req.query);
      if (!q.success) return res.status(400).json({ message: "Parâmetros inválidos (index, product, day AAAA-MM-DD, lead)." });
      const { index, product, day, lead } = q.data;
      const [g] = await db.select().from(fireRiskGrids)
        .where(and(eq(fireRiskGrids.indexKey, index), eq(fireRiskGrids.product, product), eq(fireRiskGrids.leadDays, lead), day ? eq(fireRiskGrids.validDay, day) : sql`true`))
        .orderBy(desc(fireRiskGrids.validDay)).limit(1);
      if (!g) return res.status(404).json({ message: "Grade indisponível para os parâmetros pedidos." });
      res.set("Cache-Control", "public, max-age=900");
      res.json({ index, product, validDay: g.validDay, lead: g.leadDays, cellDeg: g.cellDeg, lat0: g.lat0, lon0: g.lon0, nlat: g.nlat, nlon: g.nlon,
        mean: g.meanValues, max: g.maxValues, sourceFile: g.sourceFile, computedAt: g.computedAt,
        unit: index === "inpe_dias_sem_chuva" ? "dias consecutivos com ≤ 1 mm (janela de 120 dias)" : "índice 0–1", method: index === "inpe_rf_oficial" ? RF_METHOD : undefined });
    } catch (e) { next(e); }
  });

  app.get("/api/fire-risk/point", limiter, async (req, res, next) => {
    try {
      const q = z.object({ lat: z.coerce.number().min(-34).max(6), lng: z.coerce.number().min(-74).max(-34), day: DAY.optional() }).safeParse(req.query);
      if (!q.success) return res.status(400).json({ message: "Coordenadas fora da área coberta (Brasil)." });
      const { lat, lng, day } = q.data;
      const rows = (await db.execute<{ index: string; product: string; lead: number; validDay: string; mean: number | null; max: number | null; cellDeg: number }>(sql`
        WITH latest AS (
          SELECT DISTINCT ON (index_key, product, lead_days) * FROM fire_risk_grids
          WHERE ${day ? sql`valid_day = ${day}::date OR product = 'previsto'` : sql`true`}
          ORDER BY index_key, product, lead_days, valid_day DESC),
        cell AS (SELECT *, floor((${lat}::float8 - lat0) / cell_deg)::int AS iy, floor((${lng}::float8 - lon0) / cell_deg)::int AS ix FROM latest)
        -- ->> turns a JSON null (cell without valid pixels) into SQL NULL; out-of-grid points get NULL
        -- (a negative jsonb index would count from the end, an x beyond nlon would spill into the next row)
        SELECT index_key AS "index", product, lead_days AS lead, valid_day::text AS "validDay", cell_deg AS "cellDeg",
          CASE WHEN iy BETWEEN 0 AND nlat - 1 AND ix BETWEEN 0 AND nlon - 1 THEN (mean_values ->> (iy * nlon + ix))::float8 END AS mean,
          CASE WHEN iy BETWEEN 0 AND nlat - 1 AND ix BETWEEN 0 AND nlon - 1 THEN (max_values  ->> (iy * nlon + ix))::float8 END AS max
        FROM cell ORDER BY 1, 2, 3`)).rows;
      res.json({ lat, lng, note: "Valores da célula de 0,2° (≈ 22 km) que contém o ponto: média e máximo dos pixels de 1 km. Para uma propriedade cadastrada, use o valor calculado sobre o polígono.",
        values: rows, method: RF_METHOD });
    } catch (e) { next(e); }
  });

  app.get("/api/areas/:id/fire-risk", requireOrg(), async (req, res, next) => {
    try {
      const id = idParam(req.params.id);
      const q = z.object({ from: DAY.optional(), to: DAY.optional() }).safeParse(req.query);
      if (!id || !q.success) return res.status(400).json({ message: "Parâmetros inválidos." });
      const [area] = await db.select({ id: monitoredAreas.id }).from(monitoredAreas).where(and(eq(monitoredAreas.id, id), eq(monitoredAreas.organizationId, req.ctx!.organizationId)));
      if (!area) return res.status(404).json({ message: "Área não encontrada." });
      const to = q.data.to ?? new Date().toISOString().slice(0, 10), from = q.data.from ?? new Date(Date.parse(to) - 60 * 86_400_000).toISOString().slice(0, 10);
      const series = (await db.execute(sql`
        SELECT valid_day::text AS day, value_mean AS mean, value_max AS max, value_min AS min, risk_class AS class, pixels_valid AS "pixelsValid", pixels_total AS "pixelsTotal", method, source_file AS "sourceFile"
        FROM fire_risk_values WHERE index_key = 'inpe_rf_oficial' AND product = 'observado' AND target_type = 'area' AND target_id = ${id}
          AND valid_day BETWEEN ${from}::date AND ${to}::date ORDER BY valid_day`)).rows;
      const forecast = (await db.execute(sql`
        SELECT DISTINCT ON (valid_day) valid_day::text AS day, lead_days AS lead, issued_on::text AS "issuedOn", value_mean AS mean, value_max AS max, risk_class AS class, method
        FROM fire_risk_values WHERE index_key = 'inpe_rf_oficial' AND product = 'previsto' AND target_type = 'area' AND target_id = ${id} AND valid_day >= current_date - 1
        ORDER BY valid_day, issued_on DESC NULLS LAST`)).rows;
      res.json({ from, to, series, forecast, method: RF_METHOD });
    } catch (e) { next(e); }
  });

  app.get("/api/areas/:id/haines", requireOrg(), async (req, res, next) => {
    try {
      const id = idParam(req.params.id);
      const [a] = id ? await db.select().from(monitoredAreas).where(and(eq(monitoredAreas.id, id), eq(monitoredAreas.organizationId, req.ctx!.organizationId))) : [];
      if (!a) return res.status(404).json({ message: "Área não encontrada." });
      const [lng, lat] = a.boundary ? centroid(a.boundary as BoundaryGeom) : [a.longitude, a.latitude];
      if (lat == null || lng == null) return res.json({ status: "indisponivel", reason: "Área sem localização." });
      res.json(await hainesForPoint(lat, lng, null));
    } catch (e) { next(e); }
  });
}
