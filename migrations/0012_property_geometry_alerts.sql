-- ARTEMIS AI — migration 0012: property boundaries with provenance and
-- detected-condition alerts. Additive: no row or column is removed.

-- How each value of an area was obtained, so the interface can say what was
-- informed by the user and what was calculated from the polygon.
ALTER TABLE "monitored_areas" ADD COLUMN IF NOT EXISTS "boundary_area_ha" double precision;
--> statement-breakpoint
ALTER TABLE "monitored_areas" ADD COLUMN IF NOT EXISTS "boundary_source" text;
--> statement-breakpoint
ALTER TABLE "monitored_areas" ADD COLUMN IF NOT EXISTS "area_hectares_source" text;
--> statement-breakpoint
ALTER TABLE "monitored_areas" ADD COLUMN IF NOT EXISTS "coordinates_source" text;
--> statement-breakpoint
-- Distance (km) from the boundary (or point) within which a satellite hotspot opens an alert.
ALTER TABLE "monitored_areas" ADD COLUMN IF NOT EXISTS "hotspot_alert_km" double precision NOT NULL DEFAULT 5;
--> statement-breakpoint
ALTER TABLE "monitored_areas" DROP CONSTRAINT IF EXISTS "monitored_areas_provenance_ck";
--> statement-breakpoint
ALTER TABLE "monitored_areas" ADD CONSTRAINT "monitored_areas_provenance_ck" CHECK (
  ("boundary_source" IS NULL OR "boundary_source" IN ('desenho', 'geojson', 'kml', 'kmz', 'shapefile'))
  AND ("area_hectares_source" IS NULL OR "area_hectares_source" IN ('informada', 'calculada'))
  AND ("coordinates_source" IS NULL OR "coordinates_source" IN ('informadas', 'centro_do_poligono'))
  AND ("boundary_area_ha" IS NULL OR "boundary_area_ha" > 0)
  AND "hotspot_alert_km" >= 0 AND "hotspot_alert_km" <= 50
);
--> statement-breakpoint
-- Existing values were typed by users.
UPDATE "monitored_areas" SET "area_hectares_source" = 'informada' WHERE "area_hectares" IS NOT NULL AND "area_hectares_source" IS NULL;
--> statement-breakpoint
UPDATE "monitored_areas" SET "coordinates_source" = 'informadas' WHERE "latitude" IS NOT NULL AND "coordinates_source" IS NULL;
--> statement-breakpoint

-- Alerts: what triggered them. 'risco' = result of a risk analysis (existing);
-- 'foco_proximo' = INPE satellite hotspot detected in/near the property.
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'risco';
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "evidence" json;
--> statement-breakpoint
ALTER TABLE "alerts" DROP CONSTRAINT IF EXISTS "alerts_kind_ck";
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_kind_ck" CHECK ("kind" IN ('risco', 'foco_proximo'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_area_kind_idx" ON "alerts" ("area_id", "kind", "created_at" DESC);
--> statement-breakpoint
-- Hotspot lookups by time window + bounding box (non-PostGIS path).
CREATE INDEX IF NOT EXISTS "satellite_hotspots_time_lat_lng_idx" ON "satellite_hotspots" ("detected_at", "latitude", "longitude");
