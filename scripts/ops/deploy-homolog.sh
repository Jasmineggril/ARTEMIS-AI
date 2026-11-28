#!/usr/bin/env bash
# ARTEMIS AI — PRIVATE homologation on the Hostinger VPS (Ubuntu 24.04, Docker Compose).
#
#   cd ~/artemis && bash scripts/ops/deploy-homolog.sh
#
# What it does (idempotent, never deletes data, never overwrites an existing secret):
#   1. checks Docker, the domain and the repository;
#   2. creates/completes .env: generates database/session secrets only where empty;
#   3. creates the site password (user "avaliacao") — shown ONCE, stored only as a hash;
#   4. builds and starts the stack with HTTPS (Caddy/Let's Encrypt) + password;
#   5. loads real data: IBGE municipalities + official boundaries, INPE (2 days), Sisfogo (complete),
#      INMET stations + current-year archive;
#   6. creates your platform-administrator account and prints a single-use link to set the password.
# Production (public, no site password) is a separate step that needs your approval.
set -euo pipefail
cd "$(dirname "$0")/../.."

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }
DC=(docker compose -f docker-compose.yml -f docker-compose.homolog.yml)

say "1/6 Pré-requisitos"
command -v docker >/dev/null || die "Docker não encontrado. Veja docs/artemis/04_IMPLANTACAO_HOSTINGER.md §3."
docker compose version >/dev/null || die "Docker Compose v2 não encontrado."
[ -f docker-compose.homolog.yml ] || die "Execute a partir do repositório da ARTEMIS AI."
free -m | awk '/Mem:/ { if ($2 < 3500) print "Aviso: menos de 4 GB de RAM (" $2 " MB)." }'
df -h / | awk 'NR==2 { print "Disco livre em /: " $4 }'

say "2/6 Configuração (.env)"
if [ ! -f .env ]; then cp .env.example .env; chmod 600 .env; echo ".env criado a partir de .env.example"; fi
getv() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed "s/^'//; s/'$//"; }
setv() { # set KEY=VALUE (single-quoted, so Compose does not interpolate $ in hashes)
  local k="$1" v="$2"
  if grep -qE "^$k=" .env; then
    python3 - "$k" "$v" <<'PY'
import sys, re
k, v = sys.argv[1], sys.argv[2]
p = ".env"; s = open(p).read().split("\n")
s = [f"{k}='{v}'" if re.match(rf"^{re.escape(k)}=", l) else l for l in s]
open(p, "w").write("\n".join(s))
PY
  else printf "%s='%s'\n" "$k" "$v" >> .env; fi
}
dom="$(getv APP_DOMAIN)"
if [ -z "$dom" ] || [[ "$dom" == *example* ]]; then
  read -rp "Domínio da homologação (ex.: homolog.seudominio.com.br): " dom
  [[ "$dom" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "domínio inválido"
  setv APP_DOMAIN "$dom"
fi
mail="$(getv ACME_EMAIL)"
if [ -z "$mail" ] || [[ "$mail" == *example* ]]; then
  read -rp "E-mail para o certificado HTTPS (Let's Encrypt): " mail
  [[ "$mail" == *@*.* ]] || die "e-mail inválido"
  setv ACME_EMAIL "$mail"
fi
for k in POSTGRES_ADMIN_PASSWORD ARTEMIS_OWNER_PASSWORD ARTEMIS_APP_PASSWORD; do
  [ -n "$(getv $k)" ] || { setv "$k" "$(openssl rand -hex 24)"; echo "$k gerada"; }
done
[ -n "$(getv SESSION_SECRET)" ] || { setv SESSION_SECRET "$(openssl rand -base64 48 | tr -d '\n')"; echo "SESSION_SECRET gerado"; }
setv SCHEDULER_ENABLED true
chmod 600 .env

ip="$(curl -fsS -m 10 https://api.ipify.org 2>/dev/null || true)"
res="$(getent hosts "$dom" | awk '{print $1}' | head -1 || true)"
echo "Domínio $dom → ${res:-não resolve}; IP desta VPS: ${ip:-desconhecido}"
[ -n "$res" ] && [ -n "$ip" ] && [ "$res" != "$ip" ] && echo "Aviso: o DNS ainda não aponta para esta VPS; o HTTPS só funciona depois disso."

say "3/6 Senha de acesso ao site (homologação privada)"
if [ -z "$(getv HOMOLOG_PASSWORD_HASH)" ]; then
  site_pass="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  hash="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$site_pass")"
  setv HOMOLOG_USER avaliacao
  setv HOMOLOG_PASSWORD_HASH "$hash"
  echo "Usuário do site: avaliacao"
  echo "Senha do site:   $site_pass   <- anote agora; só o hash fica guardado"
else
  echo "Senha do site já configurada (para trocar, apague HOMOLOG_PASSWORD_HASH do .env e rode de novo)."
fi

say "4/6 Build e subida (pode levar alguns minutos na primeira vez)"
"${DC[@]}" up -d --build
for i in $(seq 1 60); do
  st="$("${DC[@]}" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$1=="api"{print $2}')"
  [ "$st" = "healthy" ] && break; sleep 5
done
"${DC[@]}" ps
[ "${st:-}" = "healthy" ] || die "API não ficou saudável. Veja: ${DC[*]} logs api migrate"

say "5/6 Dados reais (IBGE, INPE, risco de fogo INPE, Sisfogo, INMET)"
"${DC[@]}" --profile jobs run --rm --no-deps inpe-sync node dist/load-municipalities.cjs || echo "Aviso: carga do IBGE falhou (a plataforma funciona sem ela; tente de novo depois)."
"${DC[@]}" --profile jobs run --rm --no-deps inpe-sync node dist/load-boundaries.cjs || echo "Aviso: limites municipais do IBGE falharam (tente de novo depois)."
"${DC[@]}" --profile jobs run --rm --no-deps inpe-sync node dist/sync-inpe.cjs --days 2 || echo "Aviso: INPE falhou nesta tentativa; a rotina horária tentará de novo."
"${DC[@]}" --profile jobs run --rm --no-deps inpe-risk-sync || echo "Aviso: risco de fogo INPE falhou nesta tentativa; a rotina da API tentará de novo."
"${DC[@]}" --profile jobs run --rm --no-deps sisfogo-sync node dist/sync-sisfogo.cjs --mode completa --trigger agendado || echo "Aviso: Sisfogo falhou nesta tentativa; a rotina diária tentará de novo."
echo "INMET: cadastro de estações e arquivo do ano corrente (~80 MB; leva alguns minutos)…"
"${DC[@]}" --profile jobs run --rm --no-deps inmet-sync || echo "Aviso: INMET falhou nesta tentativa; a rotina diária tentará de novo."

say "6/6 Sua conta de administradora/administrador da plataforma"
read -rp "Seu e-mail: " admin_email
read -rp "Seu nome: " admin_name
read -rp "Nome da organização: " admin_org
"${DC[@]}" run --rm --no-deps api node dist/create-admin.cjs --email "$admin_email" --name "$admin_name" --org "$admin_org" --base "https://$dom"

say "Pronto"
cat <<EOF
Acesse: https://$dom  (primeiro o navegador pede usuário/senha do site; depois, o login da plataforma)
Use o link acima para definir a sua senha da plataforma (vale 72 h, uso único).
Sincronizações automáticas: INPE de hora em hora (com alertas de focos), risco de fogo oficial a cada 6 h
(com alertas de risco persistente), Sisfogo diário e completo semanal,
INMET diário (só baixa quando o INMET atualiza o arquivo do ano).
Acompanhe em: Painel Admin e Fontes de Dados.
Monitoramento:  ${DC[*]} ps | docker stats --no-stream | df -h /
Logs:           ${DC[*]} logs --since 1h api
Backup:         scripts/ops/backup.sh   (agende — docs/artemis/05_BACKUP_RECUPERACAO.md)
EOF
