-- ARTEMIS AI — migration 0011: official public fire records in fire_occurrences,
-- Sisfogo contract as verified against the live API, revision history and
-- sync bookkeeping. Additive: no table, column or row is removed.
--
-- Live API facts (read-only queries on 16/11/2026, see docs/artemis/11_SISFOGO.md):
--   * dates are nested in "datasIncendio" and are UTC instants ("…Z");
--   * page is 1-based (page=0 behaves as 1), newest ROI first;
--   * size >= 100 hits a gateway timeout (HTTP 502 after 60 s).
--
-- Model:
--   fire_occurrences      canonical, queryable occurrences. Organisation imports
--                         keep organization_id + import_batch_id; official public
--                         records have organization_id NULL and are identified by
--                         (data_source_id, external_id). Org-scoped queries filter
--                         by organization_id, so official rows never leak into, nor
--                         are confused with, an organisation's private data.
--   sisfogo_roi_records   mirror of the current published ROI (all Sisfogo fields).
--   source_record_revisions  every distinct published version (rectifications).

-- Abort, changing nothing, if legacy rows would violate the provenance rule below.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM fire_occurrences WHERE organization_id IS NULL OR import_batch_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '0011: % ocorrência(s) sem organização ou sem lote de importação. Revise antes de aplicar.', n;
  END IF;
END $$;
--> statement-breakpoint

-- 1. fire_occurrences: provenance for official records ---------------------------
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "data_source_id" integer REFERENCES "data_sources"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "external_id" text;
--> statement-breakpoint
-- Exact instant when the source publishes one (occurrence_date/time stay as the
-- human-readable local values used by imports and by the generated columns).
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "occurred_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "source_updated_at" timestamptz;
--> statement-breakpoint
-- FALSE while the source temporarily stops publishing the record (e.g. a ROI under
-- rectification). Rows are never deleted because the source omitted them.
ALTER TABLE "fire_occurrences" ADD COLUMN IF NOT EXISTS "source_available" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
-- Official records do not come from an organisation's import batch.
ALTER TABLE "fire_occurrences" ALTER COLUMN "import_batch_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "fire_occurrences" DROP CONSTRAINT IF EXISTS "fire_occurrences_provenance_ck";
--> statement-breakpoint
ALTER TABLE "fire_occurrences" ADD CONSTRAINT "fire_occurrences_provenance_ck" CHECK (
  (organization_id IS NOT NULL AND import_batch_id IS NOT NULL)
  OR (organization_id IS NULL AND import_batch_id IS NULL AND data_source_id IS NOT NULL AND external_id IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fire_occurrences_source_ext_uq" ON "fire_occurrences" ("data_source_id", "external_id") WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fire_occurrences_official_date_idx" ON "fire_occurrences" ("occurred_on") WHERE "organization_id" IS NULL;
--> statement-breakpoint
-- Bounding-box prefilter for proximity queries without PostGIS.
CREATE INDEX IF NOT EXISTS "fire_occurrences_lat_lng_idx" ON "fire_occurrences" ("latitude", "longitude") WHERE "latitude" IS NOT NULL;
--> statement-breakpoint

-- 2. Sisfogo mirror: fields confirmed in the live response -------------------------
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "source_created_at" timestamptz;      -- dataHoraCriacao
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "source_updated_at" timestamptz;      -- dataHoraUltimaAtualizacao
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "started_at" timestamptz;             -- datasIncendio.dataInicioIncendio
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "detected_at" timestamptz;            -- …dataDeteccaoIncendio
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "dispatch_at" timestamptz;            -- …dataInicioDeslocamento
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "first_attack_at" timestamptz;        -- …dataPrimeiroAtaque
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "controlled_at" timestamptz;          -- …dataControleIncendio
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "extinguished_at" timestamptz;        -- …dataExtincaoIncendio
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "institution_name" text;
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "institution_acronym" text;
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "place_name" text;                   -- localIncendio.nomeLocal
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "locality_type" text;                -- tipoLocalidade.localidade
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "area_classification" text;          -- classificacaoArea.area
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "legal_amazon" boolean;              -- isAmazoniaLegal
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "had_combat" boolean;                -- houveCombate
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "response_level" text;               -- nivelAcionamentoRoi
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "structures_hit" text;               -- estruturasAtingidas[].estrutura
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "content_hash" text;                 -- sha256 of the canonical JSON
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "unavailable_since" timestamptz;
--> statement-breakpoint
ALTER TABLE "sisfogo_roi_records" ADD COLUMN IF NOT EXISTS "last_seen_run_id" integer REFERENCES "source_sync_runs"("id") ON DELETE SET NULL;
--> statement-breakpoint
COMMENT ON COLUMN "sisfogo_roi_records"."started_on" IS 'Data (horário de Brasília) derivada de started_at.';
--> statement-breakpoint
COMMENT ON COLUMN "sisfogo_roi_records"."started_local_time" IS 'Hora HH:MM (horário de Brasília) derivada de started_at.';
--> statement-breakpoint
COMMENT ON COLUMN "sisfogo_roi_records"."burned_area_ha" IS 'informacoesPosIncendio.estimativaAreaQueimada (ha), estimativa informada no ROI; ausente na maioria dos registros.';
--> statement-breakpoint

-- 3. Revision history (every distinct published version) --------------------------
CREATE TABLE IF NOT EXISTS "source_record_revisions" (
  "id" bigserial PRIMARY KEY,
  "data_source_id" integer NOT NULL REFERENCES "data_sources"("id") ON DELETE RESTRICT,
  "external_id" text NOT NULL,
  "revision" integer NOT NULL,
  "change_kind" text NOT NULL,
  "content_hash" text NOT NULL,
  "source_updated_at" timestamptz,
  "rectified" boolean,
  "raw" json NOT NULL,
  "captured_at" timestamptz NOT NULL DEFAULT now(),
  "sync_run_id" integer REFERENCES "source_sync_runs"("id") ON DELETE SET NULL,
  CONSTRAINT "source_record_revisions_kind_ck" CHECK ("change_kind" IN ('novo', 'retificado', 'atualizado')),
  CONSTRAINT "source_record_revisions_rev_ck" CHECK ("revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_record_revisions_uq" ON "source_record_revisions" ("data_source_id", "external_id", "revision");
--> statement-breakpoint

-- 4. Sync bookkeeping ---------------------------------------------------------------
ALTER TABLE "source_sync_runs" ADD COLUMN IF NOT EXISTS "trigger" text;          -- cli | agendado | manual
--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN IF NOT EXISTS "triggered_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN IF NOT EXISTS "pages_read" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN IF NOT EXISTS "records_unchanged" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN IF NOT EXISTS "records_rectified" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN IF NOT EXISTS "records_unavailable" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "source_sync_runs" ADD COLUMN IF NOT EXISTS "progress" json;          -- last page stored, for safe resumption
--> statement-breakpoint

-- 5. Source registry: verified contract, but not operational until a real sync -------
UPDATE "data_sources" SET
  "access_method" = 'API HTTPS pública, sem chave; páginas de até 50 registros (≥100 excede o tempo do gateway)',
  "integration_status" = 'implementado — contrato verificado com consultas reais; aguardando primeira sincronização completa'
WHERE "key" = 'sisfogo-roi' AND "status" = 'em integração';
--> statement-breakpoint

-- 6. Combined event view: keeps every source identified, never merges events -------
CREATE OR REPLACE VIEW "v_fire_events" AS
 SELECT 'ocorrencia_importada'::text AS origem,
    f.id::bigint AS id,
    f.organization_id,
    f.occurred_on AS event_date,
    NULL::timestamp with time zone AS detected_at,
    f.latitude,
    f.longitude,
    f.municipality,
    f.municipality_ibge_code,
    upper("left"(f.state, 2)) AS state,
    f.occurrence_type AS detail,
    b.source_name AS source
   FROM fire_occurrences f
     JOIN import_batches b ON b.id = f.import_batch_id
UNION ALL
 SELECT 'foco_satelite'::text AS origem,
    h.id,
    NULL::integer AS organization_id,
    (h.detected_at AT TIME ZONE 'UTC'::text)::date AS event_date,
    h.detected_at,
    h.latitude,
    h.longitude,
    h.municipality,
    h.municipality_ibge_code,
    h.state,
    h.satellite AS detail,
    'INPE — Programa Queimadas'::text AS source
   FROM satellite_hotspots h
UNION ALL
 SELECT 'registro_oficial'::text AS origem,
    f.id::bigint AS id,
    NULL::integer AS organization_id,
    f.occurred_on AS event_date,
    f.occurred_at AS detected_at,
    f.latitude,
    f.longitude,
    f.municipality,
    f.municipality_ibge_code,
    upper("left"(f.state, 2)) AS state,
    f.occurrence_type AS detail,
    s.name AS source
   FROM fire_occurrences f
     JOIN data_sources s ON s.id = f.data_source_id
  WHERE f.organization_id IS NULL AND f.source_available;
