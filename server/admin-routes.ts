/**
 * Platform administration (users.role = 'platform_admin'). Every number comes
 * from the database at request time; nothing is estimated or padded.
 *   GET /api/admin/overview  indicators, data-source health, recent failures and audit events
 *   GET /api/admin/users     users with organisations and last login (paginated, searchable)
 */
import type { Express } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { requirePlatformAdmin, idParam } from "./security";
import { audit } from "./services/audit";
import { issueAccountLink, sendAccountEmail, ADMIN_LINK_TTL_H } from "./services/account-links";

const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => ((await db.execute<T>(q)).rows[0] ?? {}) as T;
const iso = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

export function registerAdminRoutes(app: Express) {
  app.get("/api/admin/overview", requirePlatformAdmin, async (_req, res, next) => {
    try {
      const users = await one(sql`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS new30,
          count(*) FILTER (WHERE role = 'platform_admin')::int AS admins FROM users`);
      const orgs = await one(sql`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM monitored_areas a WHERE a.organization_id = o.id))::int AS "withAreas"
          FROM organizations o`);
      const areas = await one(sql`SELECT count(*)::int AS total, count(boundary)::int AS "withBoundary",
          count(*) FILTER (WHERE latitude IS NOT NULL)::int AS "withCoords" FROM monitored_areas`);
      const analyses = await one(sql`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last7,
          count(*) FILTER (WHERE created_at > now() - interval '30 days' AND level IN ('alto','crítico'))::int AS high30 FROM risk_analyses`);
      const alerts = await one(sql`SELECT count(*) FILTER (WHERE status IN ('novo','reconhecido','em_acompanhamento') AND NOT is_demo)::int AS open,
          count(*) FILTER (WHERE status = 'novo' AND NOT is_demo)::int AS new,
          count(*) FILTER (WHERE created_at > now() - interval '7 days' AND NOT is_demo)::int AS last7 FROM alerts WHERE organization_id IS NOT NULL`);
      const imports = await one(sql`SELECT count(*)::int AS batches, coalesce(sum(valid_rows),0)::int AS rows FROM import_batches WHERE organization_id IS NOT NULL`);
      const data = await one(sql`SELECT
          (SELECT count(*)::int FROM satellite_hotspots WHERE detected_at > now() - interval '48 hours') AS "hotspots48h",
          (SELECT count(*)::int FROM fire_occurrences WHERE organization_id IS NULL AND source_available) AS "officialRecords",
          (SELECT count(*)::int FROM fire_occurrences WHERE organization_id IS NOT NULL) AS "importedRecords",
          pg_size_pretty(pg_database_size(current_database())) AS "dbSize"`);
      const sources = (await db.execute(sql`
        SELECT s.key, s.name, s.status, s.integration_status AS "integrationStatus",
          ${iso("(SELECT max(r.finished_at) FROM source_sync_runs r WHERE r.source_id = s.id AND r.status = 'sucesso')")} AS "lastSuccessAt",
          ${iso("(SELECT max(r.started_at) FROM source_sync_runs r WHERE r.source_id = s.id AND r.status = 'falha')")} AS "lastFailureAt",
          (SELECT count(*)::int FROM source_sync_runs r WHERE r.source_id = s.id AND r.status = 'falha' AND r.started_at > now() - interval '24 hours') AS "failures24h",
          (SELECT count(*)::int FROM source_sync_runs r WHERE r.source_id = s.id AND r.status = 'em_execucao') AS "running"
        FROM data_sources s WHERE s.key IS NOT NULL ORDER BY s.key`)).rows;
      const failures = (await db.execute(sql`
        SELECT r.id, s.key AS source, ${iso("r.started_at")} AS "startedAt", left(r.error, 300) AS error
        FROM source_sync_runs r JOIN data_sources s ON s.id = r.source_id
        WHERE r.status = 'falha' ORDER BY r.id DESC LIMIT 10`)).rows;
      const audit = (await db.execute(sql`
        SELECT l.id, l.action, ${iso("l.created_at")} AS "createdAt", u.email AS "userEmail", o.name AS organization, l.entity_type AS "entityType", l.entity_id AS "entityId"
        FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN organizations o ON o.id = l.organization_id
        ORDER BY l.id DESC LIMIT 25`)).rows;
      res.setHeader("Cache-Control", "no-store");
      res.json({ generatedAt: new Date().toISOString(), users, organizations: orgs, areas, analyses, alerts, imports, data, sources, failures, audit });
    } catch (err) {
      next(err);
    }
  });

  const usersQuery = z.object({
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  }).strict();

  app.get("/api/admin/users", requirePlatformAdmin, async (req, res, next) => {
    try {
      const p = usersQuery.safeParse(req.query);
      if (!p.success) return res.status(400).json({ message: "Parâmetros inválidos." });
      const like = p.data.q ? `%${p.data.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
      const where = like ? sql`WHERE u.email ILIKE ${like} OR u.name ILIKE ${like}` : sql``;
      const total = Number((await one<{ n: number }>(sql`SELECT count(*)::int AS n FROM users u ${where}`)).n ?? 0);
      const rows = (await db.execute(sql`
        SELECT u.id, u.email, u.name, u.role AS "platformRole", ${iso("u.created_at")} AS "createdAt",
          ${iso("(SELECT max(l.created_at) FROM audit_logs l WHERE l.user_id = u.id AND l.action = 'auth.login')")} AS "lastLoginAt",
          coalesce((SELECT json_agg(json_build_object('id', o.id, 'name', o.name, 'role', m.role) ORDER BY o.name)
             FROM organization_members m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = u.id), '[]') AS organizations
        FROM users u ${where} ORDER BY u.id DESC LIMIT ${p.data.limit} OFFSET ${p.data.offset}`)).rows;
      res.setHeader("X-Total-Count", String(total));
      res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/admin/users/:id/access-link", requirePlatformAdmin, async (req, res, next) => {
    try {
      const id = idParam(req.params.id);
      if (!id) return res.status(400).json({ message: "Identificador inválido." });
      if (id === req.session!.userId) return res.status(400).json({ message: "Para a sua própria senha, use Configurações → Conta." });
      const [u] = (await db.execute<{ email: string }>(sql`SELECT email FROM users WHERE id = ${id}`)).rows;
      if (!u) return res.status(404).json({ message: "Usuário não encontrado." });
      const { link, expiresAt } = await issueAccountLink(req, id, ADMIN_LINK_TTL_H * 3_600_000);
      const emailed = await sendAccountEmail(u.email, "reset", link, { expiresAt });
      await audit(req, "admin.user_access_link", { type: "user", id }, { emailed });
      res.status(201).json({ expiresAt, emailed, ...(emailed ? {} : { link }) });
    } catch (err) {
      next(err);
    }
  });
}
