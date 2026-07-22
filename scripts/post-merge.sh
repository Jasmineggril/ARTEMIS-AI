#!/bin/bash
set -e

echo "[post-merge] Installing dependencies..."
npm install --legacy-peer-deps

echo "[post-merge] Database schema is applied automatically on app startup via server/migrate.ts."
echo "[post-merge] To generate a new migration after schema changes, run: npx drizzle-kit generate"
echo "[post-merge] Done."
