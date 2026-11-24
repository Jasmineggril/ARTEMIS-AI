# 19 — Runbook de operação e entrada em produção

> **Regra:** nada deste documento que torne a aplicação pública é executado sem a
> **aprovação expressa e por escrito** da responsável pelo projeto. Até lá, o ambiente
> na VPS é homologação privada (senha de site + HTTPS) — ver `14_HOMOLOGACAO_HOSTINGER.md`.

## 1. Estado atual

| Item | Situação |
|---|---|
| Código e scripts de implantação | prontos (`scripts/ops/deploy-homolog.sh`, Compose + Caddy) |
| VPS Hostinger / DNS | **pendente** — acesso não disponível neste ambiente |
| SMTP | **pendente** — sem credenciais; recuperação por link emitido pelo admin funciona |
| Produção pública | **não autorizada** |

## 2. Sequência para entrar em produção (após aprovação)

1. Homologação na VPS rodando ≥ 2 semanas com piloto (ver `18_PLANO_PILOTO_OPERACAO.md`) sem S1 aberto.
2. Backup completo + teste de restauração em banco temporário (`scripts/ops/restore.sh`), com impressão digital (`fingerprint.sql`) conferida.
3. Revisão do `.env`: segredos gerados, `APP_URL` com o domínio público, SMTP, `TRUST_PROXY_HOPS=1` (padrão em produção).
4. `npm run db:status` → aplicar (`npm run db:migrate`) migrações pendentes só depois de testadas em cópia restaurada.
5. Remover a senha de site (passo separado, documentado no momento da aprovação) e manter HTTPS/HSTS.
6. Verificar: `/api/health`, login, análise, mapa, relatório, sincronização INPE/Sisfogo, painel `/admin/operacao`.
7. Registrar a data de entrada em produção no dossiê.

## 3. Atualizações controladas

1. Mudança em PR com testes (`npm run test:all`, `npm run test:e2e`, `tests/security/security-check.cjs`) verdes. Sem merge automático.
2. Janela comunicada aos usuários com antecedência (fora do horário de maior uso).
3. `scripts/ops/backup.sh` imediatamente antes.
4. `git pull` da tag aprovada → `docker compose ... up -d --build`.
5. Migrações: somente aditivas; nenhuma `DROP`/`TRUNCATE`/alteração destrutiva sem autorização.
6. Pós-verificação (item 6 acima) e anotação no changelog.

**Retorno (rollback):** voltar à tag anterior e subir de novo. Se uma migração causou o
problema, restaurar o backup do passo 3 num banco novo, conferir e só então trocar —
nunca apagar o banco atual antes de validar a restauração.

## 4. Monitoramento

- Painel `/admin/operacao`: disponibilidade (heartbeat por minuto), p50/p95, erros 5xx,
  sincronizações, uso, opiniões, SUS e validação de desfechos.
- Fontes desatualizadas (> 26 h Sisfogo, conforme `inpeFreshness` para INPE) aparecem no heartbeat.
- Recomendado (sem custo): monitor externo de `/api/health` a cada 5 min (ex.: plano gratuito
  de um serviço de uptime) — **a escolha do serviço depende da responsável**.
- Logs: `docker compose logs`; auditoria em `audit_logs` (logins, alterações, exportações).

## 5. Backups e retenção

- Diário (cron), retenção local de 14 dias (`BACKUP_RETENTION_DAYS`), cópia externa via `rclone` (ver `05_BACKUP_RECUPERACAO.md`).
- Teste de restauração mensal registrado em `docs/artemis/evidencias/`.
- Telemetria (`ops_heartbeats`, `ops_request_metrics`): manter 13 meses para o dossiê;
  depois, agregar por dia antes de qualquer limpeza (limpeza só com autorização).

## 6. Suporte

- Entrada: botão "Enviar opinião" → `/admin` (fila de opiniões com status novo/em análise/resolvido).
- Prazos por severidade: ver `18_PLANO_PILOTO_OPERACAO.md` §6.
- Conta bloqueada/senha: admin emite link de redefinição de uso único.
- Pedido de exclusão de dados: tratado pelo admin, com registro em auditoria.
