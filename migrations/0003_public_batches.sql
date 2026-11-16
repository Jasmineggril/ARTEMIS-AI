-- ARTEMIS AI â€” migration 0003
-- Explicit opt-in publication of import batches for the public lookup (Consulta PÃºblica).
-- Default is private: nothing becomes public without an admin action.

ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'privado' NOT NULL;
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "published_at" timestamp;
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "published_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT IF EXISTS "import_batches_visibility_ck";
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_visibility_ck" CHECK ("visibility" IN ('privado','publico'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batches_public_idx" ON "import_batches" ("visibility") WHERE "visibility" = 'publico';

