-- ARTEMIS AI â€” migration 0005
-- DeduplicaÃ§Ã£o materializada de ocorrÃªncias de incÃªndio.
-- Aditiva: mantÃ©m occurrence_date/occurrence_time text originais.

--> statement-breakpoint
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "dedup_key" text;
--> statement-breakpoint

-- Backfill idempotente (apenas onde ainda nÃ£o calculado)
UPDATE "fire_occurrences"
SET "dedup_key" = md5(
  coalesce("organization_id"::text, '') || '|' ||
  coalesce("occurrence_date", '') || '|' ||
  lower(coalesce("municipality", '')) || '|' ||
  coalesce("latitude"::text, '') || '|' ||
  coalesce("longitude"::text, '') || '|' ||
  lower(coalesce("occurrence_type", ''))
)
WHERE "dedup_key" IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "fire_occurrences_dedup_uq"
  ON "fire_occurrences" ("organization_id", "dedup_key")
  WHERE "dedup_key" IS NOT NULL;
--> statement-breakpoint


