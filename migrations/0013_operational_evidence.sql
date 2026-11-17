-- ARTEMIS AI — migration 0013: operational evidence (TRL 7–9).
-- Additive. Every table here holds facts measured by the running system
-- (never estimates): availability, latency, errors, expert verdicts on alerts,
-- user feedback and the standard SUS usability questionnaire.

-- 1. Availability: one row per minute written by the API itself.
CREATE TABLE IF NOT EXISTS "ops_heartbeats" (
  "id" bigserial PRIMARY KEY,
  "at" timestamptz NOT NULL DEFAULT now(),
  "instance" text NOT NULL,
  "db_ok" boolean NOT NULL,
  "db_ms" integer,
  "risk_engine_ok" boolean NOT NULL,
  "inpe_fresh" boolean,
  "sisfogo_fresh" boolean
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_heartbeats_at_idx" ON "ops_heartbeats" ("at");
--> statement-breakpoint

-- 2. API traffic aggregated per minute and route group (no personal data, no query strings).
CREATE TABLE IF NOT EXISTS "ops_request_metrics" (
  "id" bigserial PRIMARY KEY,
  "minute" timestamptz NOT NULL,
  "route" text NOT NULL,
  "requests" integer NOT NULL,
  "errors_5xx" integer NOT NULL,
  "errors_4xx" integer NOT NULL,
  "p50_ms" integer NOT NULL,
  "p95_ms" integer NOT NULL,
  "max_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ops_request_metrics_minute_route_uq" ON "ops_request_metrics" ("minute", "route");
--> statement-breakpoint

-- 3. Expert verdict on each alert (Proof of Value: "≥ 80 % de alertas pertinentes").
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "evaluation" text;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "evaluation_note" text;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "evaluated_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "evaluated_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "alerts" DROP CONSTRAINT IF EXISTS "alerts_evaluation_ck";
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_evaluation_ck" CHECK ("evaluation" IS NULL OR "evaluation" IN ('pertinente', 'parcialmente_pertinente', 'nao_pertinente'));
--> statement-breakpoint

-- 4. Time the person spent from opening the analysis form to the result (Proof of Value: analysis time).
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "client_duration_ms" integer;
--> statement-breakpoint
ALTER TABLE "risk_analyses" DROP CONSTRAINT IF EXISTS "risk_analyses_client_duration_ck";
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD CONSTRAINT "risk_analyses_client_duration_ck" CHECK ("client_duration_ms" IS NULL OR ("client_duration_ms" >= 0 AND "client_duration_ms" <= 86400000));
--> statement-breakpoint

-- 5. In-app feedback.
CREATE TABLE IF NOT EXISTS "user_feedback" (
  "id" serial PRIMARY KEY,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE SET NULL,
  "page" text NOT NULL,
  "category" text NOT NULL,
  "rating" smallint,
  "message" text NOT NULL,
  "status" text NOT NULL DEFAULT 'novo',
  "response" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_feedback_category_ck" CHECK ("category" IN ('problema', 'sugestao', 'elogio', 'duvida')),
  CONSTRAINT "user_feedback_rating_ck" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5),
  CONSTRAINT "user_feedback_status_ck" CHECK ("status" IN ('novo', 'em_analise', 'resolvido', 'arquivado'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_feedback_created_idx" ON "user_feedback" ("created_at" DESC);
--> statement-breakpoint

-- 6. System Usability Scale (Brooke, 1996): 10 items, 1–5; score 0–100 computed on insert.
CREATE TABLE IF NOT EXISTS "sus_responses" (
  "id" serial PRIMARY KEY,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE SET NULL,
  "answers" smallint[] NOT NULL,
  "score" double precision NOT NULL,
  "comment" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sus_answers_ck" CHECK (array_length("answers", 1) = 10 AND 1 <= ALL ("answers") AND 5 >= ALL ("answers")),
  CONSTRAINT "sus_score_ck" CHECK ("score" BETWEEN 0 AND 100)
);
