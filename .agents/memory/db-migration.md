---
name: DB Migration Command
description: How to apply DB schema to Supabase and local Replit PostgreSQL
---

## Supabase connectivity from sandbox

Outbound port 5432 is **blocked** in the Replit sandbox (dev environment). The app correctly picks up `SUPABASE_DATABASE_URL` and connects at startup, but the connection times out in development. In the deployed (production) environment, port 5432 is accessible and the connection succeeds.

**Why:** Replit's sandbox restricts outbound TCP connections to certain ports. Port 5432 is one of them.

**How to apply:** Don't worry when migration logs say "Connection terminated due to connection timeout" during dev. On deployment, the auto-migration runner in `server/migrate.ts` applies any pending SQL files from the `migrations/` directory automatically.

## Local drizzle-kit push

`npx drizzle-kit push` fails when `DATABASE_URL` points to a Supabase URL, which is unreachable from the sandbox.

To push schema changes to the local Replit DB (for local dev testing):
```
DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}" npx drizzle-kit push --config=drizzle.config.ts
```

To generate migration SQL (works from sandbox, applies automatically on deployment):
```
npx drizzle-kit generate --name=<description>
```
