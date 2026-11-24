-- ARTEMIS AI — migration 0010: Sisfogo (Ibama/Prevfogo) public fire occurrence
-- records (ROI). Additive and idempotent: creates one table and registers the
-- source; nothing existing is changed or removed.
--
-- These are official records published by Ibama, not organisation data, so
-- they live in their own table (like satellite_hotspots) instead of
-- fire_occurrences, which is scoped to an organisation and de-duplicated by
-- content. Sync runs reuse source_sync_runs (migration 0006).
--
-- The endpoint and field mapping follow Ibama's published documentation and
-- had NOT been verified against a live response when this was written; the
-- source is therefore registered as 'em integração' and every record keeps
-- the original JSON in "raw".

INSERT INTO "data_sources" ("key", "name", "type", "status", "is_simulated", "description", "url", "licence", "access_method", "update_frequency", "is_official", "integration_status")
VALUES (
  'sisfogo-roi',
  'Sisfogo — Registros de Ocorrência de Incêndio (Ibama/Prevfogo)',
  'base histórica', 'em integração', false,
  'Registros de Ocorrência de Incêndio (ROI) FINALIZADOS e anonimizados, publicados pelo Ibama/Prevfogo para os órgãos que aderiram ao Sisfogo. Não cobre todos os incêndios do país; ROIs em andamento não aparecem.',
  'https://sisfogo.sistema.gov.br/api/v1/roi/publico',
  'Dados públicos (Lei nº 14.944/2024; LAI). Citar "Ibama/Prevfogo — Sisfogo". Confirmar termos de uso com o Ibama antes de uso comercial.',
  'API HTTPS pública, sem chave (conforme documentação do Ibama)',
  'Contínua, conforme finalização dos ROIs pelos órgãos aderentes',
  true,
  'implementado — endpoint ainda não verificado contra resposta real'
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sisfogo_roi_records" (
  "id" bigserial PRIMARY KEY,
  "source_id" integer NOT NULL REFERENCES "data_sources"("id") ON DELETE RESTRICT,
  "external_id" text NOT NULL,                 -- ROI UUID ("id")
  "roi_number" text,                           -- "numeroRoi"
  "roi_status" text,                           -- "statusRoi" (only FINALIZADO is published)
  "rectified" boolean,
  -- Dates as published. The API returns local date-times without a UTC
  -- offset, so the local date and time are kept as given instead of
  -- inventing a time zone.
  "started_on" date,
  "started_local_time" text,
  "detected_on" date,
  "extinguished_on" date,
  "municipality" text,
  "municipality_ibge_code" char(7) REFERENCES "municipalities"("ibge_code") ON DELETE SET NULL,
  "state" char(2),
  "biome" text,
  "latitude" double precision,
  "longitude" double precision,
  "burned_area_ha" double precision,
  "vegetation" text,
  "raw" json NOT NULL,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "sync_run_id" integer REFERENCES "source_sync_runs"("id") ON DELETE SET NULL,
  CONSTRAINT "sisfogo_roi_lat_ck" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  CONSTRAINT "sisfogo_roi_lng_ck" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180),
  CONSTRAINT "sisfogo_roi_area_ck" CHECK ("burned_area_ha" IS NULL OR "burned_area_ha" >= 0),
  CONSTRAINT "sisfogo_roi_state_ck" CHECK ("state" IS NULL OR "state" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sisfogo_roi_source_ext_uq" ON "sisfogo_roi_records" ("source_id", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sisfogo_roi_state_started_idx" ON "sisfogo_roi_records" ("state", "started_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sisfogo_roi_started_idx" ON "sisfogo_roi_records" ("started_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sisfogo_roi_state_mun_idx" ON "sisfogo_roi_records" ("state", lower("municipality"));
