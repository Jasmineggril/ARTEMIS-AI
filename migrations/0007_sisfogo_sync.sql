-- ARTEMIS AI — migration 0007
-- Suporte a sincronização com a API pública do Sisfogo (ROI).
-- Aditiva e idempotente. Não remove dados.

--> statement-breakpoint
-- Tabela de histórico de sincronização (não confundir com importações manuais).
CREATE TABLE IF NOT EXISTS "source_sync_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "source_key" text NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "finished_at" timestamp,
  "status" text NOT NULL DEFAULT 'running', -- running | success | partial | failed
  "records_fetched" integer NOT NULL DEFAULT 0,
  "records_inserted" integer NOT NULL DEFAULT 0,
  "records_skipped" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "metadata" json
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_sync_runs_source_started_idx"
  ON "source_sync_runs" ("source_key", "started_at" DESC);

--> statement-breakpoint
-- Corrige deduplicação global: registros com organization_id NULL (dados públicos)
-- também precisam ser deduplicados. PostgreSQL trata NULLs como distintos em
-- índices únicos, então usamos COALESCE para um sentinel 0.
DROP INDEX IF EXISTS "fire_occurrences_dedup_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fire_occurrences_dedup_uq"
  ON "fire_occurrences" (COALESCE("organization_id", 0), "dedup_key")
  WHERE "dedup_key" IS NOT NULL;

--> statement-breakpoint
-- Índice auxiliar para consultas por fonte/referência externa.
CREATE INDEX IF NOT EXISTS "fire_occurrences_source_ref_idx"
  ON "fire_occurrences" ("source", "source_reference");