-- ARTEMIS AI — migration 0002
-- Organizations and multi-tenant isolation, alert lifecycle with history,
-- audit log, password reset tokens and analysis provenance.
-- Additive only: no existing column is dropped or rewritten.

CREATE TABLE IF NOT EXISTS "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"type" text DEFAULT 'produtor' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
	"user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "organization_members_role_ck" CHECK ("role" IN ('owner','admin','manager','analyst','viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_org_user_uq" ON "organization_members" ("organization_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_members_user_idx" ON "organization_members" ("user_id");
--> statement-breakpoint

-- monitored_areas
ALTER TABLE "monitored_areas" ADD COLUMN IF NOT EXISTS "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "monitored_areas" ADD COLUMN IF NOT EXISTS "vegetation_category" text;
--> statement-breakpoint
ALTER TABLE "monitored_areas" ADD COLUMN IF NOT EXISTS "boundary" json;
--> statement-breakpoint
ALTER TABLE "monitored_areas" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitored_areas_org_idx" ON "monitored_areas" ("organization_id");
--> statement-breakpoint
ALTER TABLE "monitored_areas" DROP CONSTRAINT IF EXISTS "monitored_areas_coords_ck";
--> statement-breakpoint
ALTER TABLE "monitored_areas" ADD CONSTRAINT "monitored_areas_coords_ck" CHECK (
	("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90)) AND
	("longitude" IS NULL OR ("longitude" BETWEEN -180 AND 180)) AND
	("area_hectares" IS NULL OR "area_hectares" >= 0)
);
--> statement-breakpoint

-- risk_analyses
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "engine_type" text;
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "is_experimental" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "data_sources" json;
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "data_quality" json;
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "limitations" json;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_analyses_org_area_idx" ON "risk_analyses" ("organization_id","area_id","created_at");
--> statement-breakpoint
ALTER TABLE "risk_analyses" DROP CONSTRAINT IF EXISTS "risk_analyses_score_ck";
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD CONSTRAINT "risk_analyses_score_ck" CHECK ("score" BETWEEN 0 AND 100);
--> statement-breakpoint

-- alerts
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "area_id" integer REFERENCES "monitored_areas"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "risk_analysis_id" integer REFERENCES "risk_analyses"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'novo' NOT NULL;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "reason" text;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "data_source" text;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "data_reference_at" timestamp;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "assigned_to" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "recommendations" json;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "dedup_key" text;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "occurrence_count" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "is_demo" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();
--> statement-breakpoint
-- Legacy rows: keep is_resolved consistent with the new status column.
UPDATE "alerts" SET "status" = 'resolvido' WHERE "is_resolved" = true AND "status" = 'novo';
--> statement-breakpoint
-- Legacy rows were created by the old demo seed without an organization:
-- flag them so they are never shown as real monitoring data.
UPDATE "alerts" SET "is_demo" = true WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "alerts" DROP CONSTRAINT IF EXISTS "alerts_status_ck";
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_status_ck" CHECK ("status" IN ('novo','reconhecido','em_acompanhamento','resolvido','descartado'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_org_status_idx" ON "alerts" ("organization_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_dedup_idx" ON "alerts" ("organization_id","dedup_key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "alert_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" integer NOT NULL REFERENCES "alerts"("id") ON DELETE CASCADE,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_events_alert_idx" ON "alert_events" ("alert_id");
--> statement-breakpoint

-- import batches / occurrences
-- These tables were declared in shared/schema.ts but missing from 0000/0001,
-- so a freshly migrated database could not persist imports. Create if absent.
CREATE TABLE IF NOT EXISTS "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"source_name" text DEFAULT '' NOT NULL,
	"source_type" text DEFAULT 'arquivo importado' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"warning_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp DEFAULT now(),
	"imported_by" integer,
	"status" text DEFAULT 'concluído' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_occurrences" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_batch_id" integer NOT NULL REFERENCES "import_batches"("id") ON DELETE CASCADE,
	"occurrence_date" text,
	"occurrence_time" text,
	"municipality" text,
	"state" text,
	"latitude" real,
	"longitude" real,
	"occurrence_type" text,
	"occurrence_status" text,
	"affected_area" real,
	"cause" text,
	"vegetation_condition" text,
	"notes" text,
	"source" text,
	"source_reference" text,
	"validation_status" text DEFAULT 'válido' NOT NULL,
	"raw_data" json,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "rejection_reasons" json;
--> statement-breakpoint
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_occurrences_org_idx" ON "fire_occurrences" ("organization_id","occurrence_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batches_org_idx" ON "import_batches" ("organization_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer REFERENCES "organizations"("id") ON DELETE SET NULL,
	"user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" json,
	"ip" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_org_created_idx" ON "audit_logs" ("organization_id","created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
