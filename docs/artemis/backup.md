# ARTEMIS AI — Backup e Restauração do PostgreSQL

## Princípios
- PostgreSQL nunca exposto publicamente.
- Backups criptografados e armazenados fora da VPS.
- Teste de restauração mensal em staging.

## Backup diário (cron na VPS)

Arquivo: `/opt/artemis/scripts/backup.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%Y%m%d_%H%M%S)
DB=${PGDATABASE:-artemis_ai}
USER=${PGUSER:-artemis_app}
OUT=/backups/artemis_${TS}.dump
pg_dump -h postgres -U "$USER" -d "$DB" -Fc -f "$OUT"
gpg --symmetric --cipher-algo AES256 --batch --passphrase-file /etc/artemis/backup.pass "$OUT"
rm -f "$OUT"
# retenção: 7 diários, 4 semanais, 3 mensais (implementar com find ou rclone)
find /backups -name '*.gpg' -mtime +7 -delete
```

Cron (root): `0 3 * * * /opt/artemis/scripts/backup.sh >> /var/log/artemis-backup.log 2>&1`

## Upload externo
Use `rclone` para enviar `/backups/*.gpg` para um bucket (Backblaze B2, S3, etc.) após o dump.

## Teste de restauração (mensal)
1. Criar banco de staging: `createdb artemis_restore_test`
2. Descriptografar: `gpg --decrypt artemis_YYYYMMDD_HHMMSS.dump.gpg > /tmp/restore.dump`
3. Restaurar: `pg_restore -h localhost -U postgres -d artemis_restore_test /tmp/restore.dump`
4. Validar: `SELECT count(*) FROM fire_occurrences; SELECT count(*) FROM risk_analyses;`
5. Conferir integridade: FKs (`\d+` no psql) e health check da aplicação apontando para o banco restaurado.
6. Registrar resultado no log de manutenção.

## Restauração de emergência
1. Parar a aplicação: `docker compose -f docker-compose.prod.yml stop app`
2. Restaurar no banco de produção (após backup do estado atual).
3. Subir a aplicação e validar `/api/health`.
```

Let's write.<|end|><|start|> assistants to=write<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
C:\Users\jasmine.araujo\Documents\Default Project\artemis-ai\docs\artemis\hostinger-install.md