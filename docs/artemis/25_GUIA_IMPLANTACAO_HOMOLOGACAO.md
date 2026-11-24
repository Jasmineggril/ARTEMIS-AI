# 25 — Guia de implantação da homologação privada (para quem vai executar na VPS)

**Objetivo:** colocar a ARTEMIS AI no ar numa VPS da Hostinger, em **homologação privada**: HTTPS, senha
para o site inteiro e fora dos buscadores. **Não é publicação para o público.** Produção só com aprovação
expressa da responsável pelo projeto (Jasmine).

**Ensaio feito em 19/11/2026** num ambiente de teste, com as mesmas imagens Docker e o mesmo `docker-compose`:
as imagens foram construídas, as 19 migrações aplicadas (PostGIS ativo), banco, motor e API ficaram
saudáveis, o HTTPS respondeu com os cabeçalhos de segurança, o site pediu a senha (401 sem ela) e a conta
de administradora foi criada. O que **não** foi testado no ensaio: o certificado real do Let's Encrypt e a
carga dos dados externos (o ambiente de ensaio não tinha internet dentro dos contêineres). Na VPS os
dois devem funcionar; se falharem, os passos de verificação abaixo mostram onde.

Tempo estimado: **1 a 2 horas** (a maior parte é espera de build e carga de dados).

---

## 0. O que você precisa ter antes

| Item | Detalhe |
|---|---|
| VPS Hostinger | Ubuntu 24.04 LTS; recomendado **2 vCPU, 8 GB de RAM, 100 GB de disco**; mínimo 4 GB de RAM e 40 GB livres |
| Acesso SSH | como `root` ou usuário com `sudo` |
| Domínio | acesso ao painel de DNS (Hostinger ou outro) para criar um subdomínio, ex.: `homolog.seudominio.com.br` |
| E-mail | para o certificado HTTPS (Let's Encrypt) |
| Dados da administradora | e-mail, nome e nome da organização da Jasmine (para criar a conta dela no fim) |

Faça um **snapshot da VPS** no painel da Hostinger antes de começar (ponto de retorno).

## 1. DNS (faça primeiro — leva alguns minutos para propagar)

No painel de DNS do domínio, crie um registro:

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| A | `homolog` (ou o subdomínio escolhido) | IP público da VPS | 300 |

Confira (no seu computador) até aparecer o IP da VPS:

```bash
nslookup homolog.seudominio.com.br
```

## 2. Preparar a VPS (uma vez só)

Entrar:

```bash
ssh root@IP_DA_VPS
```

Criar o usuário de operação:

```bash
adduser artemis && usermod -aG sudo artemis
```

```bash
mkdir -p /home/artemis/.ssh && cp ~/.ssh/authorized_keys /home/artemis/.ssh/ && chown -R artemis:artemis /home/artemis/.ssh && chmod 700 /home/artemis/.ssh && chmod 600 /home/artemis/.ssh/authorized_keys
```

Firewall (só SSH, 80 e 443):

```bash
ufw default deny incoming && ufw default allow outgoing && ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443 && ufw enable
```

Atualizações e proteção contra força bruta no SSH:

```bash
apt update && apt -y upgrade && apt -y install git gnupg unattended-upgrades fail2ban
```

Docker:

```bash
curl -fsSL https://get.docker.com | sh && usermod -aG docker artemis
```

Saia e entre de novo **como `artemis`** (teste antes de fechar a sessão root):

```bash
ssh artemis@IP_DA_VPS
```

(Opcional, recomendado depois de confirmar o login como `artemis`: em `/etc/ssh/sshd_config`, `PermitRootLogin no` e
`PasswordAuthentication no`, e `sudo systemctl restart ssh`.)

## 3. Baixar a aplicação

```bash
git clone -b feature/inmet-estacoes https://github.com/Jasmineggril/ARTEMIS-AI.git ~/artemis
```

```bash
cd ~/artemis
```

(Se o repositório for privado, o `git clone` pede usuário e um *token* do GitHub da Jasmine ou um acesso dado a você.)

## 4. Implantar (um único script)

```bash
bash scripts/ops/deploy-homolog.sh
```

O script pergunta, nesta ordem:

1. **Domínio da homologação** — ex.: `homolog.seudominio.com.br`
2. **E-mail para o certificado HTTPS**
3. (no fim) **e-mail, nome e organização da administradora** — os da Jasmine

E faz sozinho:

- cria o `.env` com senhas fortes geradas na hora (nunca versionado; permissão 600);
- gera a **senha do site** (usuário `avaliacao`) — **aparece uma única vez na tela: anote**;
- constrói e sobe banco (PostgreSQL + PostGIS), motor de risco, API e Caddy (HTTPS);
- carrega dados reais: municípios e limites do IBGE, focos do INPE (2 dias), Sisfogo (completo),
  estações e o ano corrente do INMET (~80 MB, alguns minutos);
- cria a conta de administradora e mostra um **link de uso único** (vale 72 h) para ela definir a senha.

Avisos do tipo "Aviso: … falhou nesta tentativa" numa fonte de dados **não impedem** o uso: as rotinas
automáticas tentam de novo (INPE a cada hora, Sisfogo e INMET diariamente).

## 5. Verificar (copie a saída de cada comando para a Jasmine)

```bash
cd ~/artemis
```

Serviços (esperado: `db`, `api`, `risk-engine` *healthy*; `caddy` *Up*; `migrate` *Exited (0)*):

```bash
docker compose -f docker-compose.yml -f docker-compose.homolog.yml ps -a
```

Migrações (esperado: `Applied 19 migration(s)` na primeira vez ou `nenhuma migração pendente`):

```bash
docker compose -f docker-compose.yml -f docker-compose.homolog.yml logs migrate | tail -5
```

Saúde pelo HTTPS (troque o domínio e use a senha do site; esperado: `"database":"ok","riskEngine":"ok"`):

```bash
curl -s -u avaliacao:SENHA_DO_SITE https://homolog.seudominio.com.br/api/health
```

Sem senha precisa dar **401** (site protegido):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://homolog.seudominio.com.br/api/health
```

Banco não exposto na internet (esperado: nenhuma linha):

```bash
ss -tlnp | grep 5432
```

Dados carregados (esperado: números maiores que zero):

```bash
docker compose -f docker-compose.yml -f docker-compose.homolog.yml exec -T api node -e "fetch('http://127.0.0.1:5000/api/connectors/inmet/status').then(r=>r.json()).then(j=>console.log('INMET estações',j.stations,'observações',j.observations))"
```

No navegador: abrir `https://homolog.seudominio.com.br`, digitar usuário `avaliacao` e a senha do site,
depois usar o link de uso único para a Jasmine criar a senha dela.

## 6. Backup diário (não pule)

Senha do backup (guarde uma cópia fora da VPS, num cofre de senhas):

```bash
openssl rand -base64 32 > ~/.artemis-backup-pass && chmod 600 ~/.artemis-backup-pass
```

Teste manual:

```bash
cd ~/artemis && BACKUP_PASSPHRASE_FILE=~/.artemis-backup-pass scripts/ops/backup.sh
```

Agendar todo dia às 02:30:

```bash
(crontab -l 2>/dev/null; echo "30 2 * * * cd /home/artemis/artemis && BACKUP_PASSPHRASE_FILE=/home/artemis/.artemis-backup-pass scripts/ops/backup.sh >> /home/artemis/backup.log 2>&1") | crontab -
```

Cópia externa (recomendado, opcional no início): configurar `rclone` e `BACKUP_REMOTE` — ver
`docs/artemis/05_BACKUP_RECUPERACAO.md`.

## 7. O que enviar para a Jasmine

| Enviar | Como |
|---|---|
| Endereço da homologação | mensagem normal |
| **Senha do site** e **link de uso único** | **só para ela, em canal privado** (nunca em grupo, e-mail compartilhado ou repositório) |
| Saída dos comandos da seção 5 | mensagem normal (não contém senhas) |
| Qualquer erro | a saída completa do comando que falhou |

## 8. O que NÃO fazer

- **Não** remover a senha do site nem trocar para o `docker-compose` sem `homolog` — isso é publicar (produção), e depende de aprovação.
- **Não** colocar o arquivo `.env` no Git, em e-mail ou em mensagens.
- **Não** abrir a porta 5432 (banco) nem outras portas no firewall.
- **Não** apagar volumes (`docker compose down -v`) — isso apaga o banco.
- **Não** rodar `RESTORE_FORCE=yes` nem restaurar backup no banco principal sem combinar.

## 9. Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Script para em "API não ficou saudável" | `docker compose -f docker-compose.yml -f docker-compose.homolog.yml logs api migrate \| tail -50` e enviar a saída |
| Navegador dá erro de certificado | o DNS ainda não apontava para a VPS quando o Caddy iniciou: confira o `nslookup` e rode `docker compose -f docker-compose.yml -f docker-compose.homolog.yml restart caddy` |
| 502/503 logo depois de subir | aguardar 30–60 s (o proxy só libera a API depois da checagem de saúde) |
| Falta de memória (contêiner reiniciando, `OOMKilled`) | `docker stats --no-stream` e enviar; com 4 GB de RAM, rodar a carga do INMET fora do horário de uso |
| Esqueceu a senha do site | apague a linha `HOMOLOG_PASSWORD_HASH` do `.env` e rode o script de novo (gera outra) |
| Link de uso único expirou | `docker compose -f docker-compose.yml -f docker-compose.homolog.yml run --rm --no-deps api node dist/create-admin.cjs --email EMAIL --name "NOME" --org "ORG" --base https://homolog.seudominio.com.br` |

## 10. Atualizar depois (quando a Jasmine pedir)

```bash
cd ~/artemis && BACKUP_PASSPHRASE_FILE=~/.artemis-backup-pass scripts/ops/backup.sh && git pull && bash scripts/ops/deploy-homolog.sh
```

O script reaproveita o `.env` existente (não troca senhas) e aplica só migrações aditivas.
