-- ARTEMIS AI — migration 0015: alert notifications (e-mail) with delivery log.
-- Additive only. A delivery row is created in the same transaction as the alert;
-- a background job sends it. Without SMTP the row stays 'bloqueado_configuracao'
-- (never reported as sent) and is retried automatically once SMTP is configured.
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "email_enabled" boolean NOT NULL DEFAULT true,
  "min_severity" text NOT NULL DEFAULT 'alto',
  "kinds" text[] NOT NULL DEFAULT ARRAY['risco', 'foco_proximo']::text[],
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notification_preferences_severity_ck" CHECK ("min_severity" IN ('baixo', 'moderado', 'alto', 'crítico')),
  CONSTRAINT "notification_preferences_kinds_ck" CHECK ("kinds" <@ ARRAY['risco', 'foco_proximo']::text[])
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" serial PRIMARY KEY,
  "alert_id" integer NOT NULL REFERENCES "alerts"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" integer NOT NULL,
  "channel" text NOT NULL DEFAULT 'email',
  "status" text NOT NULL DEFAULT 'pendente',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notification_deliveries_status_ck" CHECK ("status" IN ('pendente', 'enviado', 'falha', 'bloqueado_configuracao')),
  CONSTRAINT "notification_deliveries_channel_ck" CHECK ("channel" IN ('email')),
  CONSTRAINT "notification_deliveries_attempts_ck" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_alert_user_channel_uq" ON "notification_deliveries" ("alert_id", "user_id", "channel");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_due_idx" ON "notification_deliveries" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_org_idx" ON "notification_deliveries" ("organization_id", "created_at");
