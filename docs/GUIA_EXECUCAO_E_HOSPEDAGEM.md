# Guia — rodar localmente e hospedar na Hostinger

Este guia cobre: (1) rodar o CERES AI no seu computador (Windows, macOS ou Linux), (2) testar no celular e (3) publicar na Hostinger.

---

## Parte 1 — Rodar no seu computador

### 1. Instale os programas necessários

| Programa | Versão | Onde baixar | Para quê |
|---|---|---|---|
| Git | qualquer recente | https://git-scm.com/downloads | baixar o código |
| Node.js | **22 LTS** | https://nodejs.org | rodar o app |
| PostgreSQL | 14 ou mais novo | https://www.postgresql.org/download/ | banco de dados |
| Python | 3.12+ (opcional) | https://www.python.org/downloads/ | serviço de ML opcional |

Confira no terminal (no Windows, use o **PowerShell**):

```bash
node -v
```

```bash
npm -v
```

O `node -v` deve mostrar `v22.x` (mínimo `v20.19`).

> **Não quer instalar o PostgreSQL agora?** Dá para pular a etapa 3: o app abre em "modo demonstração", com os dados só na memória (somem quando você fecha o servidor). Para algo definitivo, use o PostgreSQL local ou um banco gratuito na nuvem (Supabase ou Neon) — que você vai precisar de qualquer forma para a Hostinger (veja a Parte 3).

### 2. Baixe o código com as correções

**Opção A — clonar direto a branch com as correções (mais simples):**

```bash
git clone -b claude/busy-archimedes-edam8z https://github.com/Jasmineggril/ARTEMIS-AI.git
```

```bash
cd ARTEMIS-AI
```

**Opção B — aplicar o patch num clone que você já tem** (com a branch `main` atualizada e sem alterações pendentes):

```bash
git checkout main
```

```bash
git am ceres-ai-correcoes-mobile.patch
```

Se o `git am` reclamar, use `git am --abort` e depois aplique só as alterações (sem criar commit):

```bash
git apply --binary ceres-ai-correcoes-mobile.patch
```

### 3. Crie o banco de dados

Com o PostgreSQL instalado, crie um banco chamado `ceres_ai`. Pelo terminal:

```bash
psql -U postgres -c "CREATE DATABASE ceres_ai;"
```

(No Windows, se `psql` não for reconhecido, use o **pgAdmin**, instalado junto com o PostgreSQL: botão direito em *Databases* → *Create* → *Database…* → nome `ceres_ai`.)

Você **não** precisa criar tabelas: o app cria tudo sozinho na primeira execução.

### 4. Configure o arquivo `.env`

Copie o arquivo de exemplo:

- macOS/Linux:

  ```bash
  cp .env.example .env
  ```

- Windows (PowerShell):

  ```powershell
  Copy-Item .env.example .env
  ```

Abra o `.env` num editor e ajuste pelo menos:

```dotenv
DATABASE_URL=postgresql://postgres:SUA_SENHA@localhost:5432/ceres_ai
SESSION_SECRET=qualquer-texto-longo-e-aleatorio
PORT=5000
```

`SUA_SENHA` é a senha do usuário `postgres` que você definiu ao instalar o PostgreSQL.

> **macOS:** a porta 5000 costuma estar ocupada pelo "Receptor AirPlay". Use `PORT=3000`.

### 5. Instale as dependências e rode

```bash
npm install
```

```bash
npm run dev
```

Quando aparecer `serving on port 5000`, abra **http://localhost:5000** (ou a porta que você escolheu).

Entre com a conta de demonstração: **demo@ceres.ai** / **Demo123!** — ou crie a sua em "Criar conta".

Na primeira execução o terminal mostra as migrações sendo aplicadas e os dados de demonstração sendo criados. Se aparecer *"PostgreSQL inacessível — o app vai rodar em modo demonstração"*, confira o `DATABASE_URL` (senha, porta, nome do banco) e se o PostgreSQL está rodando.

Para parar o servidor: `Ctrl + C` no terminal.

### 6. Testar no celular

**No próprio computador:** no Chrome, aperte `F12` → ícone de celular (*Toggle device toolbar*, `Ctrl+Shift+M`) e escolha um modelo (iPhone, Galaxy…).

**No seu celular de verdade (mesmo Wi-Fi do computador):**

1. Descubra o IP do computador:
   - Windows: rode `ipconfig` e procure *Endereço IPv4* (ex.: `192.168.0.15`)
   - macOS: Ajustes do Sistema → Wi-Fi → Detalhes → Endereço IP
   - Linux: `hostname -I`
2. No celular, abra `http://192.168.0.15:5000` (com o seu IP e a sua porta).
3. No Windows, se aparecer o aviso do Firewall para o Node.js, permita em **redes privadas**.

### 7. (Opcional) Serviço Python de Machine Learning

Sem ele, a análise de risco usa automaticamente o motor de regras em TypeScript (a tela mostra *"Motor demonstrativo baseado em regras"*). Para usar o modelo Scikit-learn, abra **outro** terminal:

```bash
cd python_service
```

```bash
python -m venv .venv
```

Ative o ambiente virtual — Windows (PowerShell): `.venv\Scripts\Activate.ps1` · macOS/Linux: `source .venv/bin/activate`. Depois:

```bash
pip install -r requirements.txt
```

```bash
uvicorn app:app --host 127.0.0.1 --port 8000
```

### 8. Simular a produção (o que vai rodar na hospedagem)

```bash
npm run build
```

```bash
npm start
```

### 9. Conferir que está tudo certo

```bash
npm run check
```

```bash
npm test
```

`npm run check` deve terminar sem erros e `npm test` deve mostrar 34 + 10 + 11 testes aprovados.

### Problemas comuns

| Mensagem | Solução |
|---|---|
| `A porta 5000 já está em uso` | Mude `PORT` no `.env` (ex.: `3000`) |
| `PostgreSQL inacessível — modo demonstração` | PostgreSQL desligado ou `DATABASE_URL` errado (senha/porta/nome do banco) |
| `password authentication failed` | Senha errada no `DATABASE_URL` |
| `database "ceres_ai" does not exist` | Crie o banco (etapa 3) |
| Página em branco após atualizar o código | Pare o servidor (`Ctrl+C`), rode `npm install` de novo e `npm run dev` |

---

## Parte 2 — O que preparar antes de hospedar

1. **Banco PostgreSQL acessível pela internet.** Nos planos de hospedagem compartilhada/Cloud da Hostinger só há MySQL — PostgreSQL só existe em VPS. Opções:
   - **Supabase** (gratuito para começar): crie um projeto em https://supabase.com → *Connect* → copie a *Connection string* do tipo **Session pooler** (porta 5432) e troque `[YOUR-PASSWORD]` pela senha do banco.
   - **Neon** (https://neon.tech): copie a connection string (já vem com `sslmode=require`).
   - **VPS da Hostinger**: instale o PostgreSQL no próprio servidor (Parte 3B).
2. **Um `SESSION_SECRET` forte.** Para gerar:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **O código no GitHub** (a branch com as correções mesclada na `main`, ou a própria branch).

---

## Parte 3A — Hostinger: plano de hospedagem com Node.js (Business / Cloud / Web Apps)

Nesses planos a Hostinger instala as dependências, roda o build e inicia o app a partir das configurações que você informa no hPanel. Os nomes exatos dos campos podem variar um pouco conforme a versão do painel.

1. **hPanel → Sites → Adicionar site → aplicativo Node.js** (Node.js Web App).
2. **Origem do código:** conecte o GitHub e escolha o repositório/branch — ou envie um `.zip` do projeto **sem** as pastas `node_modules` e `dist` e **sem** o arquivo `.env` (a pasta `migrations/` precisa ir junto).
3. **Configurações de build:**

   | Campo | Valor |
   |---|---|
   | Framework | Express (ou "Outro") |
   | Versão do Node.js | **22** |
   | Gerenciador de pacotes | npm |
   | Comando de build | `npm run build` |
   | Comando de início / arquivo de entrada | `npm start` (ou o arquivo `dist/index.cjs`) |

   Se houver um campo de *diretório de saída* (usado por sites estáticos), deixe o padrão: este projeto é um app com servidor Express, e o que importa é o comando de início.

4. **Variáveis de ambiente** (dá para importar um arquivo `.env` ou adicionar uma a uma):

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | a connection string do Supabase/Neon |
   | `SESSION_SECRET` | o segredo gerado na Parte 2 |
   | `SEED_DEMO_DATA` | `true` (ou `false` para não criar dados de demonstração) |
   | `OPENAI_API_KEY` | opcional |

   - Normalmente não é preciso definir `PORT`: a hospedagem informa a porta pela variável `PORT`, que o app já usa. Só defina se o painel pedir uma porta específica.
   - **Não** defina `NODE_ENV=production`: com ela o `npm install` pula as ferramentas de build (`vite`, `tsx`, `esbuild`) e o build falha. O app já sai do build em modo produção.
   - Variáveis `VITE_*` (se usar) precisam existir **antes** do build — depois de alterá-las, faça um novo deploy.

5. **Deploy.** Acompanhe o log: deve aparecer `[migrate] Applied 3 migration(s)` e `serving on port …`.
6. **Domínio e HTTPS:** aponte o domínio no hPanel e ative o SSL. O app já está preparado para rodar atrás do proxy HTTPS (cookie de login com `Secure`).
7. **Atualizações:** depois de enviar código novo ao GitHub, use *Deployments → Redeploy* (também necessário após mudar variáveis de ambiente).

> O serviço Python (FastAPI) não roda nesses planos. Não tem problema: a análise de risco usa automaticamente o motor TypeScript.

---

## Parte 3B — Hostinger VPS (Ubuntu)

No VPS você controla tudo: Node.js, PostgreSQL, Nginx e, se quiser, o serviço Python.

```bash
sudo apt update && sudo apt install -y git nginx postgresql
```

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

Banco de dados (troque a senha):

```bash
sudo -u postgres psql -c "CREATE USER ceres WITH PASSWORD 'troque-esta-senha';" -c "CREATE DATABASE ceres_ai OWNER ceres;"
```

Código e configuração:

```bash
git clone https://github.com/Jasmineggril/ARTEMIS-AI.git && cd ARTEMIS-AI
```

```bash
cp .env.example .env && nano .env
```

No `.env`: `DATABASE_URL=postgresql://ceres:troque-esta-senha@localhost:5432/ceres_ai`, um `SESSION_SECRET` forte e `PORT=5000`.

Build e execução contínua com PM2 (reinicia sozinho se cair ou se o servidor reiniciar):

```bash
npm ci && npm run build
```

```bash
sudo npm install -g pm2 && pm2 start npm --name ceres-ai -- start
```

```bash
pm2 save && pm2 startup
```

(o `pm2 startup` imprime um comando com `sudo` — copie e rode-o.)

Nginx como proxy — crie `/etc/nginx/sites-available/ceres-ai` com:

```nginx
server {
    listen 80;
    server_name seu-dominio.com.br;

    # importação de planilhas de até 10 MB
    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ceres-ai /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

HTTPS gratuito com Let's Encrypt:

```bash
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d seu-dominio.com.br
```

Para atualizar depois:

```bash
git pull && npm ci && npm run build && pm2 restart ceres-ai
```

(Opcional) serviço Python no VPS:

```bash
sudo apt install -y python3-venv && cd python_service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
pm2 start ".venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000" --name ceres-python && pm2 save
```

---

## Checklist depois de publicar

- [ ] O site abre no celular (4G e Wi-Fi) e o menu ☰ abre a navegação
- [ ] Login com demo@ceres.ai / Demo123! leva à Visão Geral
- [ ] Análise de Risco → "Cenário Crítico" → "Analisar risco" mostra a pontuação e os fatores
- [ ] Importação → enviar `demo-ocorrencias.csv` (link na própria tela) → "Confirmar e importar" → "20 registros salvos"
- [ ] Fontes de Dados lista o arquivo importado
- [ ] Sair e entrar de novo mantém os dados (ou seja, o banco está conectado)
