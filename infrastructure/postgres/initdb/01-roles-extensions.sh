#!/usr/bin/env bash
# ARTEMIS AI — PostgreSQL first-start initialisation (runs once, as superuser,
# when the data volume is created by the postgis/postgis image).
#
# Roles (least privilege):
#   artemis_owner — owns database objects; used ONLY by the one-shot `migrate` service.
#   artemis_app   — runtime role of the API: SELECT/INSERT/UPDATE/DELETE, no DDL.
# The superuser (POSTGRES_USER) is for administration only.
set -euo pipefail
: "${ARTEMIS_OWNER_PASSWORD:?defina ARTEMIS_OWNER_PASSWORD}"
: "${ARTEMIS_APP_PASSWORD:?defina ARTEMIS_APP_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$ARTEMIS_OWNER_PASSWORD" -v app_pw="$ARTEMIS_APP_PASSWORD" -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE artemis_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE artemis_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Extension needs superuser; created here so migration 0008 can use it.
CREATE EXTENSION IF NOT EXISTS postgis;

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO artemis_owner, artemis_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO artemis_owner;
GRANT USAGE ON SCHEMA public TO artemis_app;

-- Every table/sequence the owner creates (via migrations) is usable by the app, without DDL.
ALTER DEFAULT PRIVILEGES FOR ROLE artemis_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO artemis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE artemis_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO artemis_app;

-- Safety limits for the runtime role.
ALTER ROLE artemis_app SET statement_timeout = '30s';
ALTER ROLE artemis_app SET idle_in_transaction_session_timeout = '60s';
SQL
echo "[initdb] papéis artemis_owner/artemis_app e PostGIS configurados em $POSTGRES_DB"
