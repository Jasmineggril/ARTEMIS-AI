-- ARTEMIS AI â€” migration 0004
-- Integridade referencial (FKs ausentes) + CHECK de coordenadas + Ã­ndices de consulta real.
-- Aditiva e idempotente. NÃ£o remove dados.

--> statement-breakpoint
-- â”€â”€ FKs ausentes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE "readings" DROP CONSTRAINT IF EXISTS "readings_sensor_id_fk";
--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_sensor_id_fk"
  FOREIGN KEY ("sensor_id") REFERENCES "sensors"("id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "user_stats" DROP CONSTRAINT IF EXISTS "user_stats_user_id_fk";
--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "achievements" DROP CONSTRAINT IF EXISTS "achievements_user_id_fk";
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "denuncias" DROP CONSTRAINT IF EXISTS "denuncias_user_id_fk";
--> statement-breakpoint
ALTER TABLE "denuncias" ADD CONSTRAINT "denuncias_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;

--> statement-breakpoint
ALTER TABLE "monitored_areas" DROP CONSTRAINT IF EXISTS "monitored_areas_created_by_fk";
--> statement-breakpoint
ALTER TABLE "monitored_areas" ADD CONSTRAINT "monitored_areas_created_by_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;

--> statement-breakpoint
ALTER TABLE "risk_analyses" DROP CONSTRAINT IF EXISTS "risk_analyses_area_id_fk";
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD CONSTRAINT "risk_analyses_area_id_fk"
  FOREIGN KEY ("area_id") REFERENCES "monitored_areas"("id") ON DELETE SET NULL;

--> statement-breakpoint
ALTER TABLE "risk_analyses" DROP CONSTRAINT IF EXISTS "risk_analyses_created_by_fk";
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD CONSTRAINT "risk_analyses_created_by_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;

--> statement-breakpoint
ALTER TABLE "alerts" DROP CONSTRAINT IF EXISTS "alerts_sensor_id_fk";
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_sensor_id_fk"
  FOREIGN KEY ("sensor_id") REFERENCES "sensors"("id") ON DELETE SET NULL;

--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT IF EXISTS "import_batches_imported_by_fk";
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_imported_by_fk"
  FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE SET NULL;

--> statement-breakpoint
-- â”€â”€ CHECK de coordenadas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE "sensors" DROP CONSTRAINT IF EXISTS "sensors_coords_ck";
--> statement-breakpoint
ALTER TABLE "sensors" ADD CONSTRAINT "sensors_coords_ck" CHECK (
  ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90)) AND
  ("longitude" IS NULL OR ("longitude" BETWEEN -180 AND 180))
);

--> statement-breakpoint
ALTER TABLE "weather_data" DROP CONSTRAINT IF EXISTS "weather_data_coords_ck";
--> statement-breakpoint
ALTER TABLE "weather_data" ADD CONSTRAINT "weather_data_coords_ck" CHECK (
  ("latitude" BETWEEN -90 AND 90) AND ("longitude" BETWEEN -180 AND 180)
);

--> statement-breakpoint
ALTER TABLE "denuncias" DROP CONSTRAINT IF EXISTS "denuncias_coords_ck";
--> statement-breakpoint
ALTER TABLE "denuncias" ADD CONSTRAINT "denuncias_coords_ck" CHECK (
  ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90)) AND
  ("longitude" IS NULL OR ("longitude" BETWEEN -180 AND 180))
);

--> statement-breakpoint
ALTER TABLE "fire_occurrences" DROP CONSTRAINT IF EXISTS "fire_occurrences_coords_ck";
--> statement-breakpoint
ALTER TABLE "fire_occurrences" ADD CONSTRAINT "fire_occurrences_coords_ck" CHECK (
  ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90)) AND
  ("longitude" IS NULL OR ("longitude" BETWEEN -180 AND 180)) AND
  ("affected_area" IS NULL OR "affected_area" >= 0)
);

--> statement-breakpoint
-- â”€â”€ Ãndices de consulta real â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE INDEX IF NOT EXISTS "readings_sensor_ts_idx" ON "readings" ("sensor_id","timestamp" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sensors_status_idx" ON "sensors" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weather_data_coords_ts_idx" ON "weather_data" ("latitude","longitude","timestamp" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "denuncias_user_created_idx" ON "denuncias" ("user_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "denuncias_status_idx" ON "denuncias" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitored_areas_org_status_idx" ON "monitored_areas" ("organization_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitored_areas_muni_state_idx" ON "monitored_areas" ("municipality","state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_analyses_org_created_idx" ON "risk_analyses" ("organization_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_org_severity_idx" ON "alerts" ("organization_id","severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_created_idx" ON "alerts" ("created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_occurrences_muni_state_date_idx" ON "fire_occurrences" ("municipality","state","occurrence_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_occurrences_batch_idx" ON "fire_occurrences" ("import_batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batches_imported_by_idx" ON "import_batches" ("imported_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_user_created_idx" ON "audit_logs" ("user_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_members_org_idx" ON "organization_members" ("organization_id");
--> statement-breakpoint


