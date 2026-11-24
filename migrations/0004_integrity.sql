-- ARTEMIS AI — migration 0004: referential integrity, time zones, precision.
-- Additive / type-widening only. No table or column is dropped and no row is
-- deleted. The migration ABORTS (rolling back everything) if it finds orphan
-- references or a database time zone other than UTC, instead of guessing.

-- 1. Pre-flight checks --------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  IF current_setting('TimeZone') NOT IN ('UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Z') THEN
    RAISE EXCEPTION '0004: o fuso do banco é % — os timestamps existentes foram gravados nesse fuso. Ajuste a migração antes de converter para timestamptz.', current_setting('TimeZone');
  END IF;
  SELECT count(*) INTO n FROM readings r WHERE NOT EXISTS (SELECT 1 FROM sensors s WHERE s.id = r.sensor_id);
  IF n > 0 THEN RAISE EXCEPTION '0004: % leitura(s) sem sensor. Corrija manualmente antes de aplicar.', n; END IF;
  SELECT count(*) INTO n FROM user_stats u WHERE NOT EXISTS (SELECT 1 FROM users x WHERE x.id = u.user_id);
  IF n > 0 THEN RAISE EXCEPTION '0004: % user_stats sem usuário.', n; END IF;
  SELECT count(*) INTO n FROM achievements a WHERE NOT EXISTS (SELECT 1 FROM users x WHERE x.id = a.user_id);
  IF n > 0 THEN RAISE EXCEPTION '0004: % conquista(s) sem usuário.', n; END IF;
  SELECT count(*) INTO n FROM (SELECT user_id FROM user_stats GROUP BY user_id HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION '0004: % usuário(s) com user_stats duplicado.', n; END IF;
  SELECT count(*) INTO n FROM (SELECT user_id, badge_id FROM achievements GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION '0004: % conquista(s) duplicada(s).', n; END IF;
END $$;
--> statement-breakpoint

-- Nullable references that point nowhere are cleared (never deleted) and
-- reported in the server log by the NOTICE below.
DO $$
DECLARE n bigint;
BEGIN
  UPDATE alerts a SET sensor_id = NULL WHERE sensor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sensors s WHERE s.id = a.sensor_id);
  GET DIAGNOSTICS n = ROW_COUNT; IF n > 0 THEN RAISE NOTICE '0004: % alerts.sensor_id órfão(s) definidos como NULL', n; END IF;
  UPDATE denuncias d SET user_id = NULL WHERE user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = d.user_id);
  GET DIAGNOSTICS n = ROW_COUNT; IF n > 0 THEN RAISE NOTICE '0004: % denuncias.user_id órfão(s) definidos como NULL', n; END IF;
  UPDATE monitored_areas a SET created_by = NULL WHERE created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.created_by);
  GET DIAGNOSTICS n = ROW_COUNT; IF n > 0 THEN RAISE NOTICE '0004: % monitored_areas.created_by órfão(s) definidos como NULL', n; END IF;
  UPDATE risk_analyses r SET created_by = NULL WHERE created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.created_by);
  GET DIAGNOSTICS n = ROW_COUNT; IF n > 0 THEN RAISE NOTICE '0004: % risk_analyses.created_by órfão(s) definidos como NULL', n; END IF;
  UPDATE import_batches b SET imported_by = NULL WHERE imported_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = b.imported_by);
  GET DIAGNOSTICS n = ROW_COUNT; IF n > 0 THEN RAISE NOTICE '0004: % import_batches.imported_by órfão(s) definidos como NULL', n; END IF;
END $$;
--> statement-breakpoint

-- 2. Area snapshot in each analysis (traceability survives area deletion) ----
ALTER TABLE "risk_analyses" ADD COLUMN IF NOT EXISTS "area_snapshot" json;
--> statement-breakpoint
UPDATE "risk_analyses" r SET "area_snapshot" = json_build_object(
  'name', a.name, 'municipality', a.municipality, 'state', a.state,
  'latitude', a.latitude, 'longitude', a.longitude, 'areaHectares', a.area_hectares
) FROM "monitored_areas" a WHERE a.id = r.area_id AND r.area_snapshot IS NULL;
--> statement-breakpoint
-- Analyses whose area was already deleted keep their id in the snapshot.
UPDATE "risk_analyses" SET "area_snapshot" = json_build_object('deletedAreaId', area_id)
WHERE area_id IS NOT NULL AND area_snapshot IS NULL;
--> statement-breakpoint
UPDATE "risk_analyses" r SET area_id = NULL
WHERE area_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM monitored_areas a WHERE a.id = r.area_id);
--> statement-breakpoint

-- 3. Foreign keys --------------------------------------------------------------
ALTER TABLE "readings" ADD CONSTRAINT "readings_sensor_fk" FOREIGN KEY ("sensor_id") REFERENCES "sensors"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_sensor_fk" FOREIGN KEY ("sensor_id") REFERENCES "sensors"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_uq" UNIQUE ("user_id");
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_badge_uq" UNIQUE ("user_id", "badge_id");
--> statement-breakpoint
ALTER TABLE "denuncias" ADD CONSTRAINT "denuncias_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "monitored_areas" ADD CONSTRAINT "monitored_areas_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD CONSTRAINT "risk_analyses_area_fk" FOREIGN KEY ("area_id") REFERENCES "monitored_areas"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "risk_analyses" ADD CONSTRAINT "risk_analyses_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_imported_by_fk" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Indexes on FK columns used for joins / cascades
CREATE INDEX IF NOT EXISTS "readings_sensor_ts_idx" ON "readings" ("sensor_id", "timestamp");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_occurrences_batch_idx" ON "fire_occurrences" ("import_batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_area_idx" ON "alerts" ("area_id");
--> statement-breakpoint

-- 4. timestamp -> timestamptz (existing values are UTC, checked above) --------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'
      AND table_name NOT IN ('session', '_drizzle_migrations')
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''', r.table_name, r.column_name, r.column_name);
  END LOOP;
END $$;
--> statement-breakpoint

-- 5. real (float4) -> double precision (lossless widening) --------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'real'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE double precision', r.table_name, r.column_name);
  END LOOP;
END $$;
--> statement-breakpoint

-- 6. Coordinate range checks (NOT VALID + VALIDATE: existing rows are checked) -
ALTER TABLE "sensors" ADD CONSTRAINT "sensors_coords_ck" CHECK ((latitude IS NULL OR latitude BETWEEN -90 AND 90) AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "sensors" VALIDATE CONSTRAINT "sensors_coords_ck";
--> statement-breakpoint
ALTER TABLE "denuncias" ADD CONSTRAINT "denuncias_coords_ck" CHECK ((latitude IS NULL OR latitude BETWEEN -90 AND 90) AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "denuncias" VALIDATE CONSTRAINT "denuncias_coords_ck";
--> statement-breakpoint
ALTER TABLE "weather_data" ADD CONSTRAINT "weather_data_coords_ck" CHECK ((latitude BETWEEN -90 AND 90) AND (longitude BETWEEN -180 AND 180) AND (humidity IS NULL OR humidity BETWEEN 0 AND 100)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "weather_data" VALIDATE CONSTRAINT "weather_data_coords_ck";
--> statement-breakpoint
ALTER TABLE "fire_occurrences" ADD CONSTRAINT "fire_occurrences_coords_ck" CHECK ((latitude IS NULL OR latitude BETWEEN -90 AND 90) AND (longitude IS NULL OR longitude BETWEEN -180 AND 180) AND (affected_area IS NULL OR affected_area >= 0)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "fire_occurrences" VALIDATE CONSTRAINT "fire_occurrences_coords_ck";
