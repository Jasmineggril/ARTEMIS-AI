-- ARTEMIS AI — migration 0006: data source registry, sync runs, satellite
-- hotspots (INPE) and weather cache/provenance. Additive only.
--
-- satellite_hotspots holds SATELLITE DETECTIONS of active fire (one row per
-- detection; the same fire can be detected by several satellites). It is kept
-- separate from fire_occurrences (imported historical records, e.g. Sisfogo
-- files) and is never written into it.

-- 1. data_sources: registry of real sources -----------------------------------
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "key" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "url" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "licence" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "access_method" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "update_frequency" text;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "is_official" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN IF NOT EXISTS "integration_status" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_sources_key_uq" ON "data_sources" ("key") WHERE "key" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "data_sources" ("key", "name", "type", "status", "is_simulated", "description", "url", "licence", "access_method", "update_frequency", "is_official", "integration_status")
VALUES
  ('inpe-queimadas', 'INPE — Programa Queimadas (focos de calor por satélite)', 'API ambiental', 'ativo', false,
   'Focos de calor detectados por satélite (CSV diário, Brasil). Foco de calor não é incêndio confirmado; o mesmo fogo pode ser detectado por vários satélites.',
   'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/',
   'Dados públicos do INPE. Termos de uso não localizados nas páginas consultadas: citar "INPE — Programa Queimadas" e confirmar condições com o INPE antes de uso comercial.',
   'HTTPS, arquivo CSV público, sem chave', 'Dia atual: de hora em hora por satélite; dia anterior: reprocessado a cada 3 h até 12h (documento de curadoria do INPE)',
   true, 'implementado — sincronização incremental por id do foco'),
  ('open-meteo', 'Open-Meteo (modelo meteorológico)', 'API ambiental', 'ativo', false,
   'Condições atuais e precipitação horária estimadas por modelo numérico para a coordenada; não é estação local.',
   'https://open-meteo.com/en/docs', 'CC BY 4.0 — atribuição obrigatória; uso comercial requer revisar os termos',
   'API HTTPS pública, sem chave', 'Condições atuais a cada 15 min; cache local de 30 min', false, 'implementado — sob demanda com cache'),
  ('file-import', 'Importação de arquivos autorizados (ex.: Sisfogo)', 'base histórica', 'ativo', false,
   'Registros históricos importados em CSV/XLS/XLSX pela organização. NÃO é integração oficial nem automática com o Sisfogo.',
   NULL, 'Conforme autorização do detentor do arquivo', 'Upload manual com validação', 'Sob demanda', false, 'implementado — manual'),
  ('ibge-localidades', 'IBGE — API de Localidades (municípios)', 'base geográfica', 'em integração', false,
   'Lista oficial de municípios e códigos IBGE.', 'https://servicodados.ibge.gov.br/api/docs/localidades',
   'Dados públicos do IBGE', 'API HTTPS pública, sem chave', 'Eventual (mudanças territoriais)', true, 'carga por script')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 2. source_sync_runs ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "source_sync_runs" (
  "id" serial PRIMARY KEY,
  "source_id" integer NOT NULL REFERENCES "data_sources"("id") ON DELETE CASCADE,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "status" text NOT NULL DEFAULT 'em_execucao',
  "params" json,
  "records_read" integer NOT NULL DEFAULT 0,
  "records_inserted" integer NOT NULL DEFAULT 0,
  "records_updated" integer NOT NULL DEFAULT 0,
  "records_rejected" integer NOT NULL DEFAULT 0,
  "rejection_reasons" json,
  "error" text,
  CONSTRAINT "source_sync_runs_status_ck" CHECK ("status" IN ('em_execucao', 'sucesso', 'falha'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_sync_runs_source_started_idx" ON "source_sync_runs" ("source_id", "started_at" DESC);
--> statement-breakpoint

-- 3. satellite_hotspots ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "satellite_hotspots" (
  "id" bigserial PRIMARY KEY,
  "source_id" integer NOT NULL REFERENCES "data_sources"("id") ON DELETE RESTRICT,
  "external_id" text NOT NULL,
  "satellite" text NOT NULL,
  "detected_at" timestamptz NOT NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "municipality" text,
  "municipality_ibge_code" char(7),
  "state" char(2),
  "state_name" text,
  "biome" text,
  "days_without_rain" integer,
  "precipitation_mm" double precision,
  "fire_risk" double precision,
  "frp_mw" double precision,
  "raw" json,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "sync_run_id" integer REFERENCES "source_sync_runs"("id") ON DELETE SET NULL,
  CONSTRAINT "satellite_hotspots_coords_ck" CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180),
  CONSTRAINT "satellite_hotspots_risk_ck" CHECK ("fire_risk" IS NULL OR "fire_risk" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "satellite_hotspots_source_external_uq" ON "satellite_hotspots" ("source_id", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "satellite_hotspots_detected_idx" ON "satellite_hotspots" ("detected_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "satellite_hotspots_state_detected_idx" ON "satellite_hotspots" ("state", "detected_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "satellite_hotspots_mun_idx" ON "satellite_hotspots" ("municipality_ibge_code");
--> statement-breakpoint
-- Proximity queries without PostGIS use a lat/lng bounding box first.
CREATE INDEX IF NOT EXISTS "satellite_hotspots_lat_lng_idx" ON "satellite_hotspots" ("latitude", "longitude");
--> statement-breakpoint

-- 4. weather_data: provenance, kind and cache -------------------------------------
ALTER TABLE "weather_data" ADD COLUMN IF NOT EXISTS "source_key" text NOT NULL DEFAULT 'open-meteo';
--> statement-breakpoint
ALTER TABLE "weather_data" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'atual';
--> statement-breakpoint
ALTER TABLE "weather_data" ADD COLUMN IF NOT EXISTS "observed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "weather_data" ADD COLUMN IF NOT EXISTS "fetched_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "weather_data" ADD COLUMN IF NOT EXISTS "precipitation_72h" double precision;
--> statement-breakpoint
UPDATE "weather_data" SET "observed_at" = "timestamp", "fetched_at" = coalesce("timestamp", now()) WHERE "observed_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "weather_data" ADD CONSTRAINT "weather_data_kind_ck" CHECK ("kind" IN ('atual', 'previsao', 'historico', 'estacao'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weather_data_cache_idx" ON "weather_data" ("source_key", "kind", round("latitude"::numeric, 2), round("longitude"::numeric, 2), "fetched_at" DESC);
--> statement-breakpoint

-- 5. Combined read-only view: imported records + satellite detections ------------
-- Imported rows carry organization_id (callers MUST filter by it);
-- satellite rows are public (organization_id NULL). Origin is always explicit.
CREATE OR REPLACE VIEW "v_fire_events" AS
  SELECT 'ocorrencia_importada'::text AS origem, f.id::bigint AS id, f.organization_id,
         f.occurred_on AS event_date, NULL::timestamptz AS detected_at, f.latitude, f.longitude,
         f.municipality, f.municipality_ibge_code, upper(left(f.state, 2)) AS state,
         f.occurrence_type AS detail, b.source_name AS source
  FROM fire_occurrences f JOIN import_batches b ON b.id = f.import_batch_id
  UNION ALL
  SELECT 'foco_satelite', h.id, NULL::integer, (h.detected_at AT TIME ZONE 'UTC')::date, h.detected_at, h.latitude, h.longitude,
         h.municipality, h.municipality_ibge_code, h.state, h.satellite, 'INPE — Programa Queimadas'
  FROM satellite_hotspots h;
