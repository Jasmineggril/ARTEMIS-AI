# 04 — Implantação na VPS Hostinger (KVM 2)

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

Gere os segredos e preencha `.env` (`APP_DOMAIN`, `ACME_EMAIL`, `POSTGRES_PASSWORD`, `SESSION_SECRET`):

```bash
openssl rand -base64 48
```

```bash
docker compose up -d --build
```

```bash
docker compose ps && curl -fsS https://$APP_DOMAIN/api/health
```

As migrações rodam automaticamente na inicialização da API; uma falha de migração impede a API de subir (intencional).

## 6. Monitoramento básico

- Saúde: `GET /api/health` (banco + motor). Configure um monitor externo gratuito (ex.: UptimeRobot) para esse endpoint.
- Recursos: `docker stats --no-stream`; disco: `df -h /`.
- Logs (JSON, rotação 5 × 10 MB por serviço):

```bash
docker compose logs --since 1h api
```

## 7. Backups

Ver `05_BACKUP_RECUPERACAO.md`. Agende antes de liberar acesso a usuários.

## 8. Atualização da aplicação

```bash
cd ~/artemis && scripts/ops/backup.sh && git pull && docker compose up -d --build
```

## 9. Liberação

Somente após: backups agendados e uma restauração de teste concluída; revisão jurídica da política de privacidade; SMTP configurado para redefinição de senha; checklist de `07_LIMITACOES_PENDENCIAS.md` revisado; **autorização expressa**.
