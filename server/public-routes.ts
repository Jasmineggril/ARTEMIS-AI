/**
 * ARTEMIS AI — public read-only API (Consulta Pública).
 *
 * Only occurrences from import batches explicitly published by an
 * organization administrator (import_batches.visibility = 'publico') are
 * exposed. Coordinates are rounded to 2 decimals (~1 km) and free-text /
 * raw fields (notes, raw_data, source_reference, cause) are never returned.
 * These are historical imported records — not satellite hotspots and not
 * real-time monitoring.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, gte, lte, sql, desc, type SQL } from "drizzle-orm";
import { db } from "./db";
import { fireOccurrences, importBatches, organizations } from "@shared/schema";
import { rateLimit } from "./security";
import { BR_STATES } from "@shared/br-states";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const publicFilterSchema = z.object({
  state: z.string().trim().toUpperCase().refine((s) => (BR_STATES as readonly string[]).includes(s), "UF inválida.").optional(),
  municipality: z.string().trim().min(2).max(120).optional(),
  from: date.optional(),
  to: date.optional(),
  hourFrom: z.coerce.number().int().min(0).max(23).optional(),
  hourTo: z.coerce.number().int().min(0).max(23).optional(),
  compareFrom: date.optional(),
  compareTo: date.optional(),
});
type Filter = z.infer<typeof publicFilterSchema>;

/** Hour extracted from free-form time strings like "14:30", "9h", "07". */
const hourExpr = sql<number | null>`(case when ${fireOccurrences.occurrenceTime} ~ '^[0-9]{1,2}([:hH]|$)' then substring(${fireOccurrences.occurrenceTime} from '^([0-9]{1,2})')::int end)`;

function conditions(f: Filter, range?: { from?: string; to?: string }): SQL[] {
  const c: SQL[] = [eq(importBatches.visibility, "publico")];
  if (f.state) c.push(eq(fireOccurrences.state, f.state));
  if (f.municipality) c.push(sql`lower(${fireOccurrences.municipality}) = lower(${f.municipality})`);
  const from = range ? range.from : f.from;
  const to = range ? range.to : f.to;
  if (from) c.push(gte(fireOccurrences.occurrenceDate, from));
  if (to) c.push(lte(fireOccurrences.occurrenceDate, to));
  if (f.hourFrom !== undefined) c.push(sql`${hourExpr} >= ${f.hourFrom}`);
  if (f.hourTo !== undefined) c.push(sql`${hourExpr} <= ${f.hourTo}`);
  return c;
}

function handle(fn: (req: any, res: Response) => Promise<unknown>) {
  return async (req: any, res: Response, next: (e?: unknown) => void) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      next(err);
    }
  };
}

const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

async function countWhere(c: SQL[]) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(fireOccurrences)
    .innerJoin(importBatches, eq(importBatches.id, fireOccurrences.importBatchId))
    .where(and(...c));
  return n;
}

export function registerPublicRoutes(app: Express) {
  const limiter = rateLimit({ windowMs: 60_000, max: 60, key: "public" });

  app.get("/api/public/occurrences", limiter, handle(async (req, res) => {
    const f = publicFilterSchema.parse(req.query);
    const LIMIT = 3000;
    const rows = await db
      .select({
        date: fireOccurrences.occurrenceDate,
        time: fireOccurrences.occurrenceTime,
        municipality: fireOccurrences.municipality,
        state: fireOccurrences.state,
        latitude: fireOccurrences.latitude,
        longitude: fireOccurrences.longitude,
        type: fireOccurrences.occurrenceType,
        source: importBatches.sourceName,
      })
      .from(fireOccurrences)
      .innerJoin(importBatches, eq(importBatches.id, fireOccurrences.importBatchId))
      .where(and(...conditions(f)))
      .orderBy(desc(fireOccurrences.occurrenceDate))
      .limit(LIMIT + 1);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      truncated: rows.length > LIMIT,
      points: rows.slice(0, LIMIT).map((r) => ({ ...r, latitude: round2(r.latitude), longitude: round2(r.longitude) })),
      notice: "Registros históricos importados e publicados por organizações. Coordenadas aproximadas (~1 km). Não são focos de calor por satélite nem monitoramento em tempo real.",
    });
  }));

  app.get("/api/public/summary", limiter, handle(async (req, res) => {
    const f = publicFilterSchema.parse(req.query);
    const c = conditions(f);
    const total = await countWhere(c);
    const byMonth = await db
      .select({ month: sql<string>`substr(${fireOccurrences.occurrenceDate}, 1, 7)`, n: sql<number>`count(*)::int` })
      .from(fireOccurrences).innerJoin(importBatches, eq(importBatches.id, fireOccurrences.importBatchId))
      .where(and(...c, sql`${fireOccurrences.occurrenceDate} is not null`)).groupBy(sql`1`).orderBy(sql`1`);
    const byHourRows = await db
      .select({ hour: hourExpr, n: sql<number>`count(*)::int` })
      .from(fireOccurrences).innerJoin(importBatches, eq(importBatches.id, fireOccurrences.importBatchId))
      .where(and(...c, sql`${hourExpr} is not null`)).groupBy(sql`1`).orderBy(sql`1`);
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, n: byHourRows.find((r) => r.hour === h)?.n ?? 0 }));
    const topMunicipalities = await db
      .select({ municipality: fireOccurrences.municipality, state: fireOccurrences.state, n: sql<number>`count(*)::int` })
      .from(fireOccurrences).innerJoin(importBatches, eq(importBatches.id, fireOccurrences.importBatchId))
      .where(and(...c, sql`${fireOccurrences.municipality} is not null`))
      .groupBy(fireOccurrences.municipality, fireOccurrences.state).orderBy(desc(sql`3`)).limit(10);
    const sources = await db
      .select({
        source: importBatches.sourceName, organization: organizations.name,
        batches: sql<number>`count(distinct ${importBatches.id})::int`, publishedAt: sql<string>`max(${importBatches.publishedAt})`,
      })
      .from(importBatches).innerJoin(organizations, eq(organizations.id, importBatches.organizationId))
      .where(eq(importBatches.visibility, "publico"))
      .groupBy(importBatches.sourceName, organizations.name);

    let comparison = null;
    if (f.compareFrom && f.compareTo) {
      const a = await countWhere(conditions(f, { from: f.from, to: f.to }));
      const b = await countWhere(conditions(f, { from: f.compareFrom, to: f.compareTo }));
      comparison = {
        current: { from: f.from ?? null, to: f.to ?? null, total: a },
        previous: { from: f.compareFrom, to: f.compareTo, total: b },
        changePct: b > 0 ? Math.round(((a - b) / b) * 100) : null,
      };
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ generatedAt: new Date().toISOString(), total, byMonth, byHour, topMunicipalities, sources, comparison });
  }));

  app.get("/api/public/municipalities", limiter, handle(async (req, res) => {
    const { state } = z.object({ state: publicFilterSchema.shape.state }).parse(req.query);
    const rows = await db
      .selectDistinct({ municipality: fireOccurrences.municipality })
      .from(fireOccurrences).innerJoin(importBatches, eq(importBatches.id, fireOccurrences.importBatchId))
      .where(and(eq(importBatches.visibility, "publico"), sql`${fireOccurrences.municipality} is not null`,
        ...(state ? [eq(fireOccurrences.state, state)] : [])))
      .orderBy(fireOccurrences.municipality).limit(1000);
    res.json(rows.map((r) => r.municipality));
  }));
}

