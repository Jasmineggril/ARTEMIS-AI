-- ARTEMIS AI — migration 0005: typed occurrence date/hour, cross-batch
-- de-duplication, municipality codes and query indexes.
-- Original text columns (occurrence_date, occurrence_time) are untouched;
-- typed values are GENERATED from them, so they can never drift.

-- Typed date from the ISO text written by the importer (invalid/NULL -> NULL).
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "occurred_on" date GENERATED ALWAYS AS (
  CASE WHEN occurrence_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    THEN make_date(substr(occurrence_date, 1, 4)::int, substr(occurrence_date, 6, 2)::int, substr(occurrence_date, 9, 2)::int)
  END
) STORED;
--> statement-breakpoint
-- Local hour (0–23) from free-form time text such as "14:30", "9h", "07".
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "occurred_hour" smallint GENERATED ALWAYS AS (
  CASE WHEN occurrence_time ~ '^([01]?[0-9]|2[0-3])([:hH]|$)'
    THEN substring(occurrence_time from '^([0-9]{1,2})')::smallint
  END
) STORED;
--> statement-breakpoint
-- De-duplication key: date + municipality + UF + coordinates (~100 m) + type.
-- NULL when the date is unknown (such rows are never treated as duplicates).
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "dedup_key" text GENERATED ALWAYS AS (
  CASE WHEN occurrence_date IS NOT NULL THEN md5(
    occurrence_date || '|' || lower(btrim(coalesce(municipality, ''))) || '|' || upper(coalesce(state, '')) || '|' ||
    coalesce(round(latitude::numeric, 3)::text, '') || '|' || coalesce(round(longitude::numeric, 3)::text, '') || '|' ||
    lower(btrim(coalesce(occurrence_type, '')))
  ) END
) STORED;
--> statement-breakpoint
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "municipality_ibge_code" char(7);
--> statement-breakpoint

-- Abort (nothing changed) if existing data already contains duplicates.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT organization_id, dedup_key FROM fire_occurrences WHERE dedup_key IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION '0005: % grupo(s) de ocorrências duplicadas na mesma organização. Revise com a consulta de duplicidades em docs/artemis/10_BANCO_MANUTENCAO_SEGURANCA.md antes de aplicar.', n;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fire_occurrences_org_dedup_uq" ON "fire_occurrences" ("organization_id", "dedup_key") WHERE "dedup_key" IS NOT NULL;
--> statement-breakpoint

-- Query indexes (match real filters: period per organization, UF + municipality, hour).
DROP INDEX IF EXISTS "fire_occurrences_org_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_occurrences_org_date_idx" ON "fire_occurrences" ("organization_id", "occurred_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_occurrences_state_mun_idx" ON "fire_occurrences" ("state", lower("municipality"));
--> statement-breakpoint

-- Official municipality list (IBGE). Loaded by scripts/load-ibge-municipalities.ts.
CREATE TABLE IF NOT EXISTS "municipalities" (
  "ibge_code" char(7) PRIMARY KEY,
  "name" text NOT NULL,
  "state" char(2) NOT NULL,
  "name_normalized" text NOT NULL,
  "source" text NOT NULL DEFAULT 'IBGE — API de Localidades',
  "loaded_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "municipalities_state_name_uq" ON "municipalities" ("state", "name_normalized");
--> statement-breakpoint
ALTER TABLE "fire_occurrences" ADD CONSTRAINT "fire_occurrences_ibge_fk" FOREIGN KEY ("municipality_ibge_code") REFERENCES "municipalities"("ibge_code") ON DELETE SET NULL;
