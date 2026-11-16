-- ARTEMIS AI — migration 0009: session table managed by migrations.
-- Same structure connect-pg-simple creates, so the runtime role no longer
-- needs CREATE privileges. No-op where the table already exists.
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey') THEN
    ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
