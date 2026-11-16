#!/usr/bin/env bash
# ARTEMIS AI — encrypted PostgreSQL backup.
#
# Produces  <dir>/artemis-<UTC timestamp>.dump.gpg  (pg_dump custom format,
# AES256 symmetric GPG) plus a .sha256 checksum, optionally copies it to an
# off-site rclone remote and prunes local copies older than the retention.
#
# Source database (choose one):
#   - default: the `db` service of docker compose (run from the repo root)
#   - BACKUP_PG_URL=postgresql://user:pass@host:5432/db   (direct connection)
#
# Required: BACKUP_PASSPHRASE_FILE (file with the passphrase, chmod 600).
# Optional: BACKUP_DIR (default ./backups), BACKUP_REMOTE (rclone remote:path),
#           BACKUP_RETENTION_DAYS (default 14).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:?defina BACKUP_PASSPHRASE_FILE}"
[[ -r "$PASS_FILE" ]] || { echo "Arquivo de senha ilegível: $PASS_FILE" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/artemis-$STAMP.dump.gpg"
TMP="$OUT.partial"

dump() {
  if [[ -n "${BACKUP_PG_URL:-}" ]]; then
    pg_dump --format=custom --no-owner --no-privileges "$BACKUP_PG_URL"
  else
    docker compose exec -T db sh -c 'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"'
  fi
}

echo "[backup] gerando $OUT"
dump | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASS_FILE" \
  --symmetric --cipher-algo AES256 --output "$TMP"
mv "$TMP" "$OUT"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
echo "[backup] ok: $(du -h "$OUT" | cut -f1)"

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  echo "[backup] enviando para $BACKUP_REMOTE"
  rclone copy "$OUT" "$BACKUP_REMOTE/" && rclone copy "$OUT.sha256" "$BACKUP_REMOTE/"
fi

# Prune local copies (off-site retention is configured on the remote bucket).
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'artemis-*.dump.gpg*' -mtime +"$RETENTION" -print -delete
