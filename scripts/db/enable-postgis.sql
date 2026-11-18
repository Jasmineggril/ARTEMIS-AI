-- Enable PostGIS acceleration after installing the extension (run as the schema owner):
--   psql "$DATABASE_URL" -f scripts/db/enable-postgis.sql
-- Idempotent; same statements as migrations/0008_postgis_optional.sql.
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

-- 0016: municipal boundaries (only if the table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AND to_regclass('municipality_boundaries') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE municipality_boundaries ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326)
             GENERATED ALWAYS AS (ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(boundary::text), 4326))) STORED';
    EXECUTE 'CREATE INDEX IF NOT EXISTS municipality_boundaries_geom_gix ON municipality_boundaries USING gist (geom)';
  END IF;
END $$;

-- 0018: INMET weather stations (only if the table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AND to_regclass('weather_stations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE weather_stations ADD COLUMN IF NOT EXISTS geom geography(Point, 4326)
             GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED';
    EXECUTE 'CREATE INDEX IF NOT EXISTS weather_stations_geom_gix ON weather_stations USING gist (geom)';
  END IF;
END $$;
