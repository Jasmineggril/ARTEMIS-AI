# 05 — Política de backup e recuperação

## Política

| Item | Valor |
|---|---|
| O que | Banco PostgreSQL completo (`pg_dump` formato custom) |
| Frequência | Diária (02:30, horário de Brasília) + antes de cada atualização |
| Criptografia | GPG simétrico AES-256; senha em arquivo `chmod 600`, com cópia guardada **fora** da VPS |
| Integridade | Checksum SHA-256 por arquivo |
| Destino externo | Remote `rclone` (ex.: Backblaze B2, S3 compatível) com versionamento e retenção no bucket |
| Retenção local | 14 dias (`BACKUP_RETENTION_DAYS`) |
| Retenção externa | Proposta: 30 diários + 12 mensais (configurar no bucket) |
| Teste de restauração | Mensal, em banco novo, com registro do resultado |
| RPO / RTO alvo | 24 h / 2 h (fase piloto) |

Volumes do Caddy (certificados) são recriáveis e não entram no backup.

## Agendamento (cron do usuário `artemis`)

```bash
crontab -e
```

```
30 2 * * * cd /home/artemis/artemis && BACKUP_PASSPHRASE_FILE=/home/artemis/.artemis-backup-pass BACKUP_REMOTE=b2:artemis-backups scripts/ops/backup.sh >> /home/artemis/backup.log 2>&1
```

## Restauração

1. Restaure num banco **novo** dentro do contêiner `db` (criado automaticamente; nenhuma porta precisa ser publicada). O script recusa `RESTORE_DB=artemis_ai`:

```bash
BACKUP_PASSPHRASE_FILE=~/.artemis-backup-pass RESTORE_DB=artemis_restore scripts/ops/restore.sh backups/artemis-AAAAMMDDTHHMMSSZ.dump.gpg
```

2. Confira as contagens impressas (migrações, usuários, organizações, áreas, análises, alertas, ocorrências, focos). Fora do Docker, use `RESTORE_PG_URL=postgresql://…` no lugar de `RESTORE_DB`.

3. Valide no aplicativo apontando `DATABASE_URL` para `artemis_restore`; só então troque o banco de produção.

O script recusa restaurar em banco com tabelas (`exit 2`), salvo `RESTORE_FORCE=yes`, e executa em transação única (`--single-transaction --exit-on-error`).

## Teste executado (15/11/2026, ambiente de desenvolvimento)

| Verificação | Resultado |
|---|---|
| Backup gerado e cifrado | ✅ `PGP symmetric key encrypted data - AES with 256-bit key` |
| Checksum conferido na restauração | ✅ |
| Restauração em banco novo | ✅ 3 migrações; contagens de users, organizations, areas, analyses e alerts idênticas à origem |
| Recusa banco não vazio | ✅ `exit 2` |
| Senha incorreta | ✅ falha (`decryption failed`), nada restaurado |
| Envio externo via rclone | ⏳ não testado (sem remote configurado) |
| Backup e restauração via `docker compose exec` (pilha `artemis_ai` com PostGIS) | ✅ 16/11/2026: contagens idênticas; recusa de restaurar sobre `artemis_ai` |
