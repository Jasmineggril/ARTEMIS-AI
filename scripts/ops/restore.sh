#!/usr/bin/env bash
# ARTEMIS AI — restore an encrypted backup produced by backup.sh.
#
# Target (choose one):
#   RESTORE_DB=artemis_restore      restore into a NEW database inside the docker compose `db`
#                                   service (created if absent; no port needs to be published)
#   RESTORE_PG_URL=postgresql://…   restore into a database reachable from this host
#
#   BACKUP_PASSPHRASE_FILE=~/.artemis-backup-pass RESTORE_DB=artemis_restore \
#     scripts/ops/restore.sh backups/artemis-20261115T020000Z.dump.gpg
#
# Safety: verifies the checksum; refuses a target that already has tables unless
# RESTORE_FORCE=yes; runs in a single transaction. Never restore straight over
# production: restore into a new database, validate, then switch.
set -euo pipefail

FILE="${1:?uso: restore.sh <arquivo .dump.gpg>}"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:?defina BACKUP_PASSPHRASE_FILE}"
[[ -n "${RESTORE_PG_URL:-}" || -n "${RESTORE_DB:-}" ]] || { echo "defina RESTORE_DB (docker) ou RESTORE_PG_URL" >&2; exit 1; }
if [[ -n "${RESTORE_DB:-}" && ! "$RESTORE_DB" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then echo "RESTORE_DB inválido" >&2; exit 1; fi
if [[ "${RESTORE_DB:-}" == "artemis_ai" ]]; then echo "Recusado: não restaure sobre o banco de produção (artemis_ai)." >&2; exit 1; fi

if [[ -f "$FILE.sha256" ]]; then
  ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" )
else
  echo "[restore] AVISO: checksum ausente para $FILE" >&2
fi

# psql / pg_restore against the chosen target
if [[ -n "${RESTORE_PG_URL:-}" ]]; then
  q() { psql "$RESTORE_PG_URL" -Atc "$1"; }
  restore() { pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname "$RESTORE_PG_URL"; }
else
  dc() { docker compose exec -T db "$@"; }
  dc sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -Atc \"SELECT 1 FROM pg_database WHERE datname='$RESTORE_DB'\" | grep -q 1 || createdb -U \"\$POSTGRES_USER\" '$RESTORE_DB'"
  q() { dc sh -c "psql -U \"\$POSTGRES_USER\" -d '$RESTORE_DB' -Atc \"$1\""; }
  restore() { dc sh -c "pg_restore -U \"\$POSTGRES_USER\" --no-owner --no-privileges --exit-on-error --single-transaction --dbname '$RESTORE_DB'"; }
fi

TABLES="$(q "select count(*) from information_schema.tables where table_schema='public' and table_name <> 'spatial_ref_sys'")"
if [[ "$TABLES" != "0" && "${RESTORE_FORCE:-no}" != "yes" ]]; then
  echo "[restore] banco de destino não está vazio ($TABLES tabelas). Use um banco novo ou RESTORE_FORCE=yes." >&2
  exit 2
fi

echo "[restore] restaurando $FILE"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASS_FILE" --decrypt "$FILE" | restore

echo "[restore] verificação:"
for t in _drizzle_migrations users organizations monitored_areas risk_analyses alerts fire_occurrences satellite_hotspots; do
  echo "$t=$(q "select count(*) from $t" 2>/dev/null || echo 'ausente')"
done
echo "[restore] concluído"
