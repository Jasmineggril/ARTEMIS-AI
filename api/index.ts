/**
 * Vercel serverless entry-point (legacy deployment target).
 *
 * The primary deployment target for ARTEMIS AI is the Docker Compose stack
 * (see infrastructure/). This adapter reuses the same app factory so security
 * settings are identical. The Python service is not available on Vercel; the
 * API falls back to the TypeScript rule engine.
 */
import type { Request, Response } from "express";
import type { Express } from "express";
import { runMigrations } from "../server/migrate";
import { createApp } from "../server/app";

let initPromise: Promise<Express> | null = null;

async function build(): Promise<Express> {
  try {
    await runMigrations();
  } catch (err) {
    console.warn("[migrate] skipped:", err instanceof Error ? err.message : err);
  }
  const { app } = await createApp();
  return app;
}

export default async function handler(req: Request, res: Response) {
  if (!initPromise) initPromise = build();
  const app = await initPromise;
  app(req, res);
}
