-- ARTEMIS AI — migration 0008: optional PostGIS acceleration.
-- If the postgis extension is installed (created by a superuser, e.g. the
-- Docker init script infrastructure/postgres/initdb/01-roles-extensions.sql),
-- adds generated geography columns and GiST indexes. If it is not available,
-- nothing changes and the application keeps using bounding box + haversine.
-- To enable later: create the extension as superuser, then run
-- scripts/db/enable-postgis.sql (same statements as below, idempotent).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    BEGIN
      CREATE EXTENSION postgis;
    EXCEPTION WHEN insufficient_privilege OR undefined_file OR feature_not_supported OR invalid_parameter_value THEN
      RAISE NOTICE '0008: PostGIS indisponível (%). Consultas espaciais seguem com haversine.', SQLERRM;
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    EXECUTE 'ALTER TABLE satellite_hotspots ADD COLUMN IF NOT EXISTS geom geography(Point, 4326)
             GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED';
    EXECUTE 'CREATE INDEX IF NOT EXISTS satellite_hotspots_geom_gix ON satellite_hotspots USING gist (geom)';
    EXECUTE 'ALTER TABLE fire_occurrences ADD COLUMN IF NOT EXISTS geom geography(Point, 4326)
             GENERATED ALWAYS AS (CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
               THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END) STORED';
    EXECUTE 'CREATE INDEX IF NOT EXISTS fire_occurrences_geom_gix ON fire_occurrences USING gist (geom)';
    RAISE NOTICE '0008: PostGIS ativo — colunas geom e índices GiST criados.';
  END IF;
END $$;
