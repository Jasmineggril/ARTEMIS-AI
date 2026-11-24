import type { Request } from "express";
import { db } from "../db";
import { auditLogs } from "@shared/schema";
import { clientIp } from "../security";

/**
 * Records a critical operation. Never stores passwords, tokens or file
 * contents in metadata. Failures are logged but never block the operation
 * that already succeeded.
 */
export async function audit(
  req: Request,
  action: string,
  entity?: { type: string; id?: string | number },
  metadata?: Record<string, unknown>,
  overrides?: { userId?: number | null; organizationId?: number | null },
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      organizationId: overrides?.organizationId ?? req.ctx?.organizationId ?? req.session?.organizationId ?? null,
      userId: overrides?.userId ?? req.ctx?.userId ?? req.session?.userId ?? null,
      action,
      entityType: entity?.type ?? null,
      entityId: entity?.id !== undefined ? String(entity.id) : null,
      metadata: metadata ?? null,
      ip: clientIp(req),
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "audit_write_failed", action, err: String(err) }));
  }
}
