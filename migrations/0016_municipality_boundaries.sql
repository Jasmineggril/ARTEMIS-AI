-- ARTEMIS AI — migration 0016: official municipal boundaries (IBGE, API de malhas v3).
-- Additive. Loaded by scripts/load-ibge-boundaries.ts (never invented: a municipality
-- without an official polygon simply has no row). With PostGIS, a geometry column
-- and a GiST index are added for point-in-municipality queries; without it the
-- bbox columns + exact point-in-polygon in TypeScript are used.
CREATE TABLE IF NOT EXISTS "municipality_boundaries" (
  "ibge_code" char(7) PRIMARY KEY,
  "boundary" jsonb NOT NULL,
  "min_lat" double precision NOT NULL,
  "max_lat" double precision NOT NULL,
  "min_lng" double precision NOT NULL,
  "max_lng" double precision NOT NULL,
  "centroid_lat" double precision NOT NULL,
  "centroid_lng" double precision NOT NULL,
  "area_km2" double precision NOT NULL,
  "quality" text NOT NULL,
  "source" text NOT NULL DEFAULT 'IBGE — API de malhas v3',
  "source_url" text,
  "loaded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "municipality_boundaries_quality_ck" CHECK ("quality" IN ('minima', 'intermediaria', 'maxima')),
  CONSTRAINT "municipality_boundaries_bbox_ck" CHECK ("min_lat" <= "max_lat" AND "min_lng" <= "max_lng" AND "min_lat" >= -90 AND "max_lat" <= 90 AND "min_lng" >= -180 AND "max_lng" <= 180),
  CONSTRAINT "municipality_boundaries_type_ck" CHECK ("boundary"->>'type' IN ('Polygon', 'MultiPolygon'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "municipality_boundaries_bbox_idx" ON "municipality_boundaries" ("min_lat", "max_lat", "min_lng", "max_lng");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    EXECUTE 'ALTER TABLE municipality_boundaries ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326)
             GENERATED ALWAYS AS (ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(boundary::text), 4326))) STORED';
    EXECUTE 'CREATE INDEX IF NOT EXISTS municipality_boundaries_geom_gix ON municipality_boundaries USING gist (geom)';
  END IF;
END $$;
