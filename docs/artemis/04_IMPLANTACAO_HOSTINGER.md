# 04 — Implantação na VPS Hostinger (KVM 2)

> **Homologação privada (recomendado primeiro):** depois das seções 1–4, rode `bash scripts/ops/deploy-homolog.sh` — HTTPS + senha do site, dados reais e sua conta de administradora. Situação do produto: `15_PRODUTO_SITUACAO.md`.

> **Nada aqui foi executado.** Este procedimento exige a VPS, um domínio e autorização expressa. Nenhuma compra, publicação ou alteração de infraestrutura foi feita.

Alvo: 2 vCPU · 8 GB RAM · 100 GB NVMe · Ubuntu 24.04 LTS · região Brasil (São Paulo), se disponível.

## Orçamento de recursos (limites definidos no `docker-compose.yml`)

| Serviço | Memória máx. | CPU |
|---|---|---|
| PostgreSQL 16 | 2 GB (`shared_buffers=512MB`) | — |
| API Node | 1 GB | 1.0 |
| Motor de risco | 768 MB | 0.75 |
| Caddy | 256 MB | — |
| **Total** | **~4 GB**, sobra para o SO, cache e picos | |

**Banco local ou gerenciado?** Para a fase piloto, PostgreSQL no próprio Compose: custo zero adicional e latência mínima; exige backups externos (abaixo). Migrar para um serviço gerenciado quando houver exigência de alta disponibilidade ou equipe sem rotina de operação.

## 1. Acesso e usuário

```bash
ssh root@IP_DA_VPS
```

```bash
adduser artemis && usermod -aG sudo artemis
```

```bash
mkdir -p /home/artemis/.ssh && cp ~/.ssh/authorized_keys /home/artemis/.ssh/ && chown -R artemis:artemis /home/artemis/.ssh && chmod 700 /home/artemis/.ssh && chmod 600 /home/artemis/.ssh/authorized_keys
```

Em `/etc/ssh/sshd_config`: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`. Teste um novo login como `artemis` **antes** de fechar a sessão root:

```bash
sudo systemctl restart ssh
```

## 2. Firewall e atualizações

```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing && sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw enable
```

```bash
sudo apt update && sudo apt -y upgrade && sudo apt -y install unattended-upgrades fail2ban && sudo dpkg-reconfigure -plow unattended-upgrades
```

Atenção: o Docker publica portas contornando o UFW. Só o Caddy publica portas (80/443) no Compose; PostgreSQL e o motor ficam na rede interna, sem portas publicadas.

## 3. Docker

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker artemis
```

## 4. Domínio e DNS

Crie um registro `A` (e `AAAA`, se houver IPv6) de `APP_DOMAIN` apontando para o IP da VPS. Subdomínios sugeridos: `app.` (plataforma); `status.` (monitoramento externo, opcional). Não publique ambientes de desenvolvimento.

## 5. Aplicação

```bash
git clone <URL_DO_REPOSITORIO> ~/artemis && cd ~/artemis
```

```bash
cp .env.example .env && chmod 600 .env
```

Gere os segredos e preencha `.env` (`APP_DOMAIN`, `ACME_EMAIL`, `POSTGRES_ADMIN_PASSWORD`, `ARTEMIS_OWNER_PASSWORD`, `ARTEMIS_APP_PASSWORD`, `SESSION_SECRET`), um valor diferente para cada:

```bash
openssl rand -base64 48
```

```bash
docker compose up -d --build
```

```bash
docker compose ps && curl -fsS https://$APP_DOMAIN/api/health
```

Ordem de subida (automática): `db` saudável → `migrate` aplica as migrações com o papel **dono** e termina → `api` sobe com o papel **restrito** e apenas confere que nada ficou pendente. Uma falha de migração impede a API de subir (intencional).

Banco: `artemis_ai` (PostgreSQL 16 + PostGIS 3.4). Na primeira subida, `infrastructure/postgres/initdb/01-roles-extensions.sh` cria os papéis `artemis_owner` e `artemis_app` e a extensão PostGIS. Detalhes: `10_BANCO_MANUTENCAO_SEGURANCA.md`.

Dados iniciais (opcional): lista oficial de municípios do IBGE, usada para preencher o código IBGE nas importações:

```bash
docker compose --profile jobs run --rm inpe-sync node dist/load-municipalities.cjs
```

Sem essa carga, a plataforma funciona normalmente; as ocorrências importadas apenas ficam sem código IBGE.

## 6. Monitoramento básico

- Saúde: `GET /api/health` (banco + motor). Configure um monitor externo gratuito (ex.: UptimeRobot) para esse endpoint.
- Recursos: `docker stats --no-stream`; disco: `df -h /`.
- Logs (JSON, rotação 5 × 10 MB por serviço):

```bash
docker compose logs --since 1h api
```

## 7. Rotinas agendadas (cron)

Focos de calor do INPE (de hora em hora) e backup diário. As linhas exatas estão em `10_BANCO_MANUTENCAO_SEGURANCA.md`, seção 5. Primeira carga do INPE (últimos 7 dias):

```bash
docker compose --profile jobs run --rm inpe-sync node dist/sync-inpe.cjs --days 7
```

Sisfogo (ROIs oficiais, leitura da API pública). Primeira carga = sincronização completa (≈ 5–30 min; 1.698 ROIs em 4 min no teste de 16/11/2026):

```bash
docker compose --profile jobs run --rm sisfogo-sync node dist/sync-sisfogo.cjs --mode completa --trigger agendado
```

Cron sugerido (horário do servidor; fora de pico):

```
23 4 * * *  cd ~/artemis && docker compose --profile jobs run --rm sisfogo-sync >> logs/sisfogo.log 2>&1
47 3 * * 0  cd ~/artemis && docker compose --profile jobs run --rm sisfogo-sync node dist/sync-sisfogo.cjs --mode completa --trigger agendado >> logs/sisfogo.log 2>&1
```

Código de saída: 0 sucesso, 1 falha (registrada em `source_sync_runs`), 75 já havia outra sincronização em andamento. Se falhar no meio, `--resume` continua da página seguinte à última gravada.

## 7b. Backups

Ver `05_BACKUP_RECUPERACAO.md`. Agende antes de liberar acesso a usuários.

## 8. Atualização da aplicação

```bash
cd ~/artemis && scripts/ops/backup.sh && git pull && docker compose up -d --build   # migrate roda antes da api
```

## 9. Liberação

Somente após: backups agendados e uma restauração de teste concluída; revisão jurídica da política de privacidade; SMTP configurado para redefinição de senha; checklist de `07_LIMITACOES_PENDENCIAS.md` revisado; **autorização expressa**.
