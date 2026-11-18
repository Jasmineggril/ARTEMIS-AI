# 14 — Checklist de homologação na Hostinger KVM 2

Alvo: VPS KVM 2 — Ubuntu 24.04 LTS, 2 vCPU, 8 GB RAM, 100 GB NVMe, Docker Compose, Caddy (HTTPS).
**Homologação restrita** (domínio de teste ou acesso só seu); **sem publicação em produção** até sua aprovação.
Instalação passo a passo: `04_IMPLANTACAO_HOSTINGER.md`. Backups: `05_BACKUP_RECUPERACAO.md`.

> Nada disto foi executado na VPS: este ambiente não tem acesso a ela. Cada item traz o comando e o
> resultado esperado; marque e anote o que observar.

## 0. Antes de começar

- [ ] Snapshot da VPS no painel da Hostinger (ponto de retorno).
- [ ] `.env` preenchido a partir de `.env.example` (senhas fortes e distintas para `POSTGRES_ADMIN_PASSWORD`, `ARTEMIS_OWNER_PASSWORD`, `ARTEMIS_APP_PASSWORD`; `SESSION_SECRET` com 32+ caracteres; `APP_DOMAIN` de homologação). Nunca versionar o `.env`.
- [ ] `docker compose --profile jobs config -q` sem erro.

## 1. Build e inicialização

| # | Verificação | Comando | Esperado |
|---|---|---|---|
| 1.1 | Build completo | `docker compose build` | todas as imagens sem erro (este ambiente não conseguiu baixar dependências do npm/PyPI dentro do build) |
| 1.2 | Subida | `docker compose up -d && docker compose ps` | `db`, `risk-engine`, `api`, `caddy` *healthy*; `migrate` *exited (0)* |
| 1.3 | Migrações | `docker compose logs migrate` | `0000`…`0011` aplicadas; nenhuma "Numeração duplicada"/"alterada depois" |
| 1.4 | Saúde | `curl -s https://$APP_DOMAIN/api/health` | `database: ok`, `riskEngine: ok` |
| 1.5 | Banco não exposto | `ss -tlnp \| grep 5432` no host | nada escutando em interface pública |
| 1.6 | Reinício automático | `docker compose restart api` e `sudo reboot` | serviços voltam sozinhos (`restart: unless-stopped`) |

## 2. Conectividade com as fontes

| # | Verificação | Comando | Esperado |
|---|---|---|---|
| 2.1 | Sisfogo alcançável | `docker compose --profile jobs run --rm sisfogo-sync node -e "fetch('https://sisfogo.sistema.gov.br/api/v1/roi/actuator/health/readiness').then(r=>r.text()).then(console.log)"` | `{"status":"UP"}` |
| 2.2 | INPE alcançável | `docker compose --profile jobs run --rm inpe-sync node dist/sync-inpe.cjs --days 1` | `"status":"sucesso"` |
| 2.3 | Open-Meteo | análise de risco com "usar clima ao vivo" | variáveis meteorológicas preenchidas com fonte Open-Meteo |

## 3. Sincronização controlada do Sisfogo

| # | Passo | Comando | Esperado |
|---|---|---|---|
| 3.1 | Uma página | `docker compose --profile jobs run --rm sisfogo-sync node dist/sync-sisfogo.cjs --max-pages 1` | `"status":"sucesso"`, `read` = 20, `rejected` = 0 |
| 3.2 | Carga completa | `… node dist/sync-sisfogo.cjs --mode completa` | `"stoppedBecause":"fim_da_lista"`, `read` ≈ `totalItems` (≈ 1.700 em nov/2026), poucos ou nenhum rejeitado |
| 3.3 | Idempotência | `docker compose --profile jobs run --rm sisfogo-sync` | `inserted` 0 (ou só ROIs novos), `stoppedBecause` = `sem_novidades` |
| 3.4 | Concorrência | rodar 3.3 duas vezes ao mesmo tempo | a segunda sai com código 75 |
| 3.5 | Painel | Fontes de Dados (login de administrador da plataforma) | "Operacional", histórico com as execuções acima |
| 3.6 | Mapa / Consulta Pública | Mapa Ambiental e `/consulta-publica` | camada Sisfogo com pontos; painel com totais |
| 3.7 | Cron | linhas de `04_IMPLANTACAO_HOSTINGER.md` §7 | `logs/sisfogo.log` com uma execução por dia |

Resultado da referência em desenvolvimento (16/11/2026): 1.698 ROIs, 85 páginas, 0 rejeitados, 4 min 17 s.

## 4. Recursos (CPU, RAM, disco)

```bash
docker stats --no-stream            # durante a carga completa e em repouso
df -h / && docker system df
docker compose exec db psql -U artemis_admin -d artemis_ai -c "SELECT pg_size_pretty(pg_database_size('artemis_ai'))"
```

Referências medidas em dev: tabelas do Sisfogo ≈ 8 MB para 1.698 ROIs (espelho + revisões). Limites do compose:
`api` 1 GB/1 vCPU, jobs 512 MB/0,5 vCPU. Anotar o pico de memória do `sisfogo-sync` (só uma página por vez em memória).

Monitoramento mínimo sugerido (cron diário, envia alerta se houver linha):

```sql
SELECT s.key, r.id, r.started_at, r.error
FROM source_sync_runs r JOIN data_sources s ON s.id = r.source_id
WHERE r.status = 'falha' AND r.started_at > now() - interval '1 day';
```

## 5. Backup e restauração

- [ ] `scripts/ops/backup.sh` gera arquivo cifrado (gpg) e o copia para o destino externo.
- [ ] `RESTORE_DB=artemis_restore scripts/ops/restore.sh <arquivo>` restaura numa base separada (recusa `artemis_ai`).
- [ ] `scripts/ops/fingerprint.sql` igual na origem e na cópia restaurada.

## 6. Segurança

- [ ] HTTPS válido (Caddy/Let's Encrypt); HTTP redireciona.
- [ ] `POST /api/admin/connectors/sisfogo/sync` responde 403 para usuário comum e 202 para administrador da plataforma; entrada em `audit_logs`.
- [ ] Logs (`docker compose logs api sisfogo-sync`) sem senhas nem tokens.
- [ ] Firewall da VPS: só 22, 80, 443.

## 7. Resultado

| Item | Situação | Observação |
|---|---|---|
| Build | ☐ | |
| Contêineres e reinício | ☐ | |
| Migrações 0000–0011 | ☐ | |
| Sisfogo (carga completa) | ☐ | |
| INPE | ☐ | |
| Recursos | ☐ | |
| Backup/restauração | ☐ | |
| Segurança | ☐ | |

Publicação em produção: **somente após sua aprovação** com esta tabela preenchida.
