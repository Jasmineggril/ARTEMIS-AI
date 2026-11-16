# ARTEMIS AI — Instalação na Hostinger VPS KVM 2

## Pré-requisitos
- VPS KVM 2: Ubuntu 24.04 LTS, 2 vCPUs, 8 GB RAM, 100 GB NVMe.
- Docker + Docker Compose instalados.
- Domínio apontando para a VPS (opcional, para HTTPS).
- Backup externo configurado (ver backup.md).

## Passos

1. Clonar o repositório:
   ```bash
   git clone https://github.com/Jasmineggril/ARTEMIS-AI.git /opt/artemis
   cd /opt/artemis
   ```

2. Criar `.env` a partir de `.env.example` e preencher segredos:
   ```bash
   cp .env.example .env
   # editar DATABASE_URL, SESSION_SECRET, PGPASSWORD, etc.
   ```

3. Subir o PostgreSQL (rede interna, sem porta pública):
   ```bash
   docker compose -f docker-compose.prod.yml up -d postgres
   docker compose -f docker-compose.prod.yml ps
   ```

4. As migrações rodam automaticamente no startup da aplicação (`server/migrate.ts`).

5. Subir a aplicação:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

6. Verificar saúde:
   ```bash
   curl http://localhost:5000/api/health
   ```

## Segurança
- PostgreSQL não tem portas publicadas; apenas a rede `artemis_internal`.
- Usuário da aplicação (`artemis_app`) com privilégios mínimos (SELECT/INSERT/UPDATE/DELETE).
- Migrações aplicadas por usuário separado (`artemis_migrate`) com DDL.
- Backups diários criptografados (ver backup.md).
- `SESSION_SECRET` obrigatório em produção (o app falha ao iniciar sem ele).
- Rate limiting ativo; CORS/origin check configurado via `ALLOWED_ORIGINS`.

## Monitoramento
- `docker compose logs -f app`
- Health check: `/api/health` (retorna 503 se o DB estiver indisponível).