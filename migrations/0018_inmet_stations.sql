-- ARTEMIS AI — migration 0018: INMET automatic weather stations (observed data).
-- Additive only. Why new tables instead of weather_data: weather_data is the
-- point cache of Open-Meteo MODEL values (no station, no unique key, no QC);
-- station observations need a station registry, one row per station-hour,
-- quality flags and a link to the raw file they came from.
--
--  weather_stations              registry (code, position, altitude, status) from INMET's station list
--  weather_station_observations  hourly observations (UTC), processed values + quality flags;
--                                raw values stay in the original file (sha256 + line kept here)
--  weather_station_daily         daily aggregates in the station's LOCAL day, with availability
INSERT INTO "data_sources" ("key", "name", "type", "status", "is_simulated", "description", "url", "licence", "access_method", "update_frequency", "is_official", "integration_status")
VALUES (
  'inmet-estacoes',
  'INMET — Estações meteorológicas automáticas (observações horárias)',
  'estação climática', 'em integração', false,
  'Observações horárias das estações automáticas do INMET (temperatura, umidade, vento, precipitação, pressão, radiação). Medidas no local da estação, não na propriedade.',
  'https://portal.inmet.gov.br/dadoshistoricos',
  'Dados públicos do INMET (Lei de Acesso à Informação). Citar "Fonte: INMET". API horária (apitempo) exige token solicitado ao INMET.',
  'Arquivos anuais oficiais (ZIP/CSV) do portal de dados históricos; lista de estações pela API pública apitempo.inmet.gov.br/estacoes/T',
  'Arquivo do ano corrente atualizado pelo INMET cerca de uma vez por mês; lista de estações diária',
  true,
  'implementado — arquivos anuais verificados em 18/11/2026'
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weather_stations" (
  "id" serial PRIMARY KEY,
  "source_id" integer NOT NULL REFERENCES "data_sources"("id") ON DELETE RESTRICT,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "state" char(2),
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "altitude_m" double precision,
  "station_type" text,
  "status" text,
  "utc_offset_hours" smallint NOT NULL DEFAULT -3,
  "operation_start" timestamptz,
  "operation_end" timestamptz,
  "registry" jsonb,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "weather_stations_latlng_ck" CHECK ("latitude" BETWEEN -35 AND 7 AND "longitude" BETWEEN -75 AND -28),
  CONSTRAINT "weather_stations_offset_ck" CHECK ("utc_offset_hours" BETWEEN -5 AND -2)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "weather_stations_source_code_uq" ON "weather_stations" ("source_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weather_stations_lat_lng_idx" ON "weather_stations" ("latitude", "longitude");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weather_station_observations" (
  "id" bigserial PRIMARY KEY,
  "station_id" integer NOT NULL REFERENCES "weather_stations"("id") ON DELETE CASCADE,
  "observed_at" timestamptz NOT NULL,
  "temperature_c" real,
  "temperature_max_c" real,
  "temperature_min_c" real,
  "dew_point_c" real,
  "humidity_pct" real,
  "humidity_min_pct" real,
  "wind_speed_ms" real,
  "wind_gust_ms" real,
  "wind_direction_deg" smallint,
  "precipitation_mm" real,
  "pressure_hpa" real,
  "radiation_kj_m2" real,
  "quality_flags" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "raw_file_sha256" char(64),
  "raw_file_name" text,
  "raw_line" integer,
  "sync_run_id" integer,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "wso_humidity_ck" CHECK ("humidity_pct" IS NULL OR "humidity_pct" BETWEEN 0 AND 100),
  CONSTRAINT "wso_wind_ck" CHECK ("wind_speed_ms" IS NULL OR "wind_speed_ms" >= 0),
  CONSTRAINT "wso_rain_ck" CHECK ("precipitation_mm" IS NULL OR "precipitation_mm" >= 0),
  CONSTRAINT "wso_hour_ck" CHECK (date_trunc('hour', "observed_at") = "observed_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wso_station_time_uq" ON "weather_station_observations" ("station_id", "observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wso_observed_idx" ON "weather_station_observations" ("observed_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weather_station_daily" (
  "station_id" integer NOT NULL REFERENCES "weather_stations"("id") ON DELETE CASCADE,
  "day" date NOT NULL,
  "hours_observed" smallint NOT NULL,
  "hours_temperature" smallint NOT NULL,
  "hours_humidity" smallint NOT NULL,
  "hours_precipitation" smallint NOT NULL,
  "temperature_mean_c" real,
  "temperature_max_c" real,
  "temperature_min_c" real,
  "humidity_mean_pct" real,
  "humidity_min_pct" real,
  "humidity_13h_pct" real,
  "temperature_13h_c" real,
  "wind_mean_ms" real,
  "wind_max_ms" real,
  "wind_13h_ms" real,
  "gust_max_ms" real,
  "precipitation_mm" real,
  "flagged_hours" smallint NOT NULL DEFAULT 0,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("station_id", "day"),
  CONSTRAINT "wsd_hours_ck" CHECK ("hours_observed" BETWEEN 0 AND 24)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wsd_day_idx" ON "weather_station_daily" ("day");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    EXECUTE 'ALTER TABLE weather_stations ADD COLUMN IF NOT EXISTS geom geography(Point, 4326)
             GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED';
    EXECUTE 'CREATE INDEX IF NOT EXISTS weather_stations_geom_gix ON weather_stations USING gist (geom)';
  END IF;
END $$;
