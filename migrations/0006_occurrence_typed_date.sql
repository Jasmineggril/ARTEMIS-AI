-- ARTEMIS AI â€” migration 0006
-- Data/hora de ocorrÃªncia tipada (timestamptz), sem perder os valores text originais.
-- Backfill conservador: sÃ³ preenche quando a data for ISO vÃ¡lida e a hora parseÃ¡vel.

--> statement-breakpoint
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "occurrence_at" timestamptz;
--> statement-breakpoint

-- Backfill: tenta combinar occurrence_date (YYYY-MM-DD) com occurrence_time (HH:MM).
-- Valores invÃ¡lidos permanecem NULL â€” nunca inventa data.
UPDATE "fire_occurrences"
SET "occurrence_at" = (
  CASE
    WHEN "occurrence_date" ~ '^\d{4}-\d{2}-\d{2}$'
         AND ("occurrence_time" IS NULL OR "occurrence_time" ~ '^\d{1,2}:\d{2}(:\d{2})?$')
    THEN (
      "occurrence_date" || ' ' ||
      coalesce(
        CASE
          WHEN "occurrence_time" ~ '^\d{1,2}:\d{2}$' THEN "occurrence_time" || ':00'
          WHEN "occurrence_time" ~ '^\d{1,2}:\d{2}:\d{2}$' THEN "occurrence_time"
          ELSE '00:00:00'
        END,
        '00:00:00'
      )
    )::timestamp AT TIME ZONE 'America/Sao_Paulo'
    ELSE NULL
  END
)
WHERE "occurrence_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "fire_occurrences_occurred_at_idx"
  ON "fire_occurrences" ("organization_id", "occurrence_at");
--> statement-breakpoint


