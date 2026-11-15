#!/usr/bin/env bash
# ARTEMIS AI — restore an encrypted backup produced by backup.sh.
#
#   BACKUP_PASSPHRASE_FILE=... RESTORE_PG_URL=postgresql://.../artemis_restore \
#     scripts/ops/restore.sh backups/artemis-20261115T020000Z.dump.gpg
#
# Safety: verifies the checksum, and refuses to restore into a database that
# already has tables unless RESTORE_FORCE=yes. Prefer restoring into a NEW,
# empty database, validating, and only then switching the application.
set -euo pipefail

FILE="${1:?uso: restore.sh <arquivo .dump.gpg>}"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:?defina BACKUP_PASSPHRASE_FILE}"
TARGET="${RESTORE_PG_URL:?defina RESTORE_PG_URL (banco de destino)}"

if [[ -f "$FILE.sha256" ]]; then
  ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" )
else
  echo "[restore] AVISO: checksum ausente para $FILE" >&2
fi

TABLES="$(psql "$TARGET" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [[ "$TABLES" != "0" && "${RESTORE_FORCE:-no}" != "yes" ]]; then
  echo "[restore] banco de destino não está vazio ($TABLES tabelas). Use um banco novo ou RESTORE_FORCE=yes." >&2
  exit 2
fi

echo "[restore] restaurando $FILE"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASS_FILE" --decrypt "$FILE" \
  | pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname "$TARGET"

echo "[restore] verificação:"
psql "$TARGET" -Atc "select 'migrations=' || count(*) from _drizzle_migrations"
psql "$TARGET" -Atc "select 'users=' || count(*) from users"
psql "$TARGET" -Atc "select 'organizations=' || count(*) from organizations"
psql "$TARGET" -Atc "select 'monitored_areas=' || count(*) from monitored_areas"
psql "$TARGET" -Atc "select 'risk_analyses=' || count(*) from risk_analyses"
psql "$TARGET" -Atc "select 'alerts=' || count(*) from alerts"
echo "[restore] concluído"
