-- ARTEMIS AI — migration 0019: fire-risk indices (official INPE product and indices computed by ARTEMIS).
-- Additive only. Reversible: DROP TABLE fire_risk_grids, fire_risk_values; DELETE the data source row
-- (see docs/artemis/26_INPE_RISCO_FOGO.md §Reversão) — never run without authorisation.
--
--  fire_risk_values  one value per (index, product, target, valid day, lead) — target = monitored area or INMET station
--  fire_risk_grids   coarse grid (mean and max per cell) of a daily official product, for the map layer
INSERT INTO "data_sources" ("key", "name", "type", "status", "is_simulated", "description", "url", "licence", "access_method", "update_frequency", "is_official", "integration_status")
VALUES (
  'inpe-risco-fogo',
  'INPE — Risco de Fogo (modelo 2.2, observado e previsto)',
  'base geográfica', 'em integração', false,
  'Índice meteorológico de risco de fogo da vegetação (0–1), 1 km, calculado pelo Programa Queimadas do INPE com precipitação IMERG (120 dias), temperatura e umidade do GFS às 18 UTC, vegetação IGBP/MapBiomas, latitude e elevação. Indica quão propícia a vegetação está para queimar; não é detecção de fogo nem probabilidade de ocorrência.',
  'https://terrabrasilis.dpi.inpe.br/queimadas/portal/pages/secao_downloads/dados-abertos/index.html',
  'Dados abertos do INPE. Citar "Fonte: Programa Queimadas/INPE".',
  'Arquivos oficiais: NetCDF diário do observado e GeoTIFF da previsão (T0–T3) em dataserver-coids.inpe.br/queimadas/queimadas/riscofogo_meteorologia/',
  'Observado: diário (dia anterior, publicado ~03:30 UTC). Previsto: diário (~06:30 UTC)',
  true,
  'implementado — arquivos verificados em 23/11/2026'
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_risk_values" (
  "id" bigserial PRIMARY KEY,
  "index_key" text NOT NULL,
  "product" text NOT NULL,
  "model_version" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" integer NOT NULL,
  "valid_day" date NOT NULL,
  "lead_days" smallint NOT NULL DEFAULT 0,
  "issued_on" date,
  "value_mean" real,
  "value_max" real,
  "value_min" real,
  "risk_class" text,
  "pixels_total" integer NOT NULL DEFAULT 0,
  "pixels_valid" integer NOT NULL DEFAULT 0,
  "method" text NOT NULL,
  "inputs" jsonb,
  "source_file" text,
  "source_sha256" char(64),
  "sync_run_id" integer,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "frv_index_ck" CHECK ("index_key" IN ('inpe_rf_oficial', 'artemis_rf_estacao')),
  CONSTRAINT "frv_product_ck" CHECK ("product" IN ('observado', 'previsto', 'calculado')),
  CONSTRAINT "frv_target_ck" CHECK ("target_type" IN ('area', 'station')),
  CONSTRAINT "frv_lead_ck" CHECK ("lead_days" BETWEEN 0 AND 10),
  CONSTRAINT "frv_value_ck" CHECK (("value_mean" IS NULL OR "value_mean" BETWEEN 0 AND 1) AND ("value_max" IS NULL OR "value_max" BETWEEN 0 AND 1) AND ("value_min" IS NULL OR "value_min" BETWEEN 0 AND 1)),
  CONSTRAINT "frv_class_ck" CHECK ("risk_class" IS NULL OR "risk_class" IN ('minimo', 'baixo', 'medio', 'alto', 'critico'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "frv_uq" ON "fire_risk_values" ("index_key", "product", "target_type", "target_id", "valid_day", "lead_days");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "frv_target_day_idx" ON "fire_risk_values" ("target_type", "target_id", "valid_day");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fire_risk_grids" (
  "index_key" text NOT NULL,
  "product" text NOT NULL,
  "valid_day" date NOT NULL,
  "lead_days" smallint NOT NULL DEFAULT 0,
  "cell_deg" real NOT NULL,
  "lat0" double precision NOT NULL,
  "lon0" double precision NOT NULL,
  "nlat" integer NOT NULL,
  "nlon" integer NOT NULL,
  "mean_values" jsonb NOT NULL,
  "max_values" jsonb NOT NULL,
  "source_file" text,
  "source_sha256" char(64),
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("index_key", "product", "valid_day", "lead_days", "cell_deg")
);
