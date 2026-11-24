-- ARTEMIS AI — migration 0017: Proof of Value instrumentation. Additive only.
-- 1) Baseline: time an invited evaluator takes to do the SAME task without the
--    platform (consulting INPE, weather and records by hand), timed in the app.
-- 2) Expert verdict on the recommendations of an analysis (alerts already have one, 0013).
CREATE TABLE IF NOT EXISTS "pov_baseline_measurements" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "area_id" integer REFERENCES "monitored_areas"("id") ON DELETE SET NULL,
  "method" text NOT NULL DEFAULT 'manual',
  "duration_ms" integer NOT NULL,
  "sources_consulted" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "note" text,
  "started_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pov_baseline_method_ck" CHECK ("method" IN ('manual')),
  CONSTRAINT "pov_baseline_duration_ck" CHECK ("duration_ms" BETWEEN 10000 AND 86400000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pov_baseline_org_idx" ON "pov_baseline_measurements" ("organization_id", "created_at");
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "recommendation_evaluation" text;
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "recommendation_evaluation_note" text;
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "recommendation_evaluated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "recommendation_evaluated_at" timestamptz;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "risk_analyses" ADD CONSTRAINT "risk_analyses_rec_eval_ck"
    CHECK ("recommendation_evaluation" IS NULL OR "recommendation_evaluation" IN ('pertinente', 'parcialmente_pertinente', 'nao_pertinente'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
