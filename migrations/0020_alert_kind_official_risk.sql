-- ARTEMIS AI — migration 0020: alert kind for persistent OFFICIAL fire-risk conditions.
-- Widens the CHECK (existing rows remain valid). Reversible by restoring the previous list once
-- no row uses 'risco_oficial'.
ALTER TABLE "alerts" DROP CONSTRAINT IF EXISTS "alerts_kind_ck";
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_kind_ck" CHECK ("kind" IN ('risco', 'foco_proximo', 'risco_oficial'));
--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT IF EXISTS "notification_preferences_kinds_ck";
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_kinds_ck" CHECK ("kinds" <@ ARRAY['risco', 'foco_proximo', 'risco_oficial']::text[]);
