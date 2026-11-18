# 15 — ARTEMIS AI como produto: o que funciona, evidências e pendências

Situação em 17/11/2026. Branch `integration/artemis-sisfogo-inpe`.
Critério usado: **só consta como "funciona" o que foi executado de ponta a ponta com dados reais** (não basta o código existir ou um teste unitário passar).

## 1. Teste de uso real (pessoa usando a plataforma)

`tests/e2e/real-user.cjs` — navegador automatizado, sem dados simulados: focos reais do INPE já sincronizados,
ROIs reais do Sisfogo, clima ao vivo do Open-Meteo. Executado contra o servidor de desenvolvimento **e contra o build de produção**; nas duas vezes, 10/10 etapas e nenhum erro de JavaScript.

| # | Etapa | Resultado (17/11/2026) |
|---|---|---|
| 1 | Criar conta (cria a organização) | ok |
| 2 | Sair e entrar de novo | ok |
| 3 | Organização e papel de proprietária | ok |
| 4 | Cadastrar propriedade **desenhando o limite no mapa** onde o INPE detectou focos nas últimas 6 h (Barreirinha/AM) | ok — 178,5 ha **calculados do polígono**, ponto = centro do polígono |
| 5 | Ver dados reais no entorno | ok — **26 focos dentro da propriedade, 32 até 10 km** (GOES-19, NOAA-20, NOAA-21) |
| 6 | Análise de risco (clima ao vivo + INPE automático) | ok — 31,9 °C, 61 %, foco a 0 km → **Moderado (41)** |
| 7 | Interpretar: natureza de cada dado | ok — Estimativa (Open-Meteo), Observado (INPE), Calculado (índice) |
| 8 | Relatório rastreável + PDF | ok — tabela variável/valor/natureza/origem |
| 9 | **Alerta automático** pela rotina horária do INPE e acompanhamento | ok — "Foco de calor dentro de …", evidências, ação registrada |
| 10 | Sair, entrar no celular e conferir persistência | ok — banco: 1 análise, 1 alerta em acompanhamento, limite `desenho`, área `calculada`; sem rolagem horizontal |

Capturas: `docs/artemis/capturas/produto/` (01 desenho do limite · 02 propriedade com dados reais · 03 resultado ·
04 relatório (PNG e PDF) · 05 alerta por foco detectado · 06 celular após novo login).

Também verificados no navegador: importação de **KML** (polígono aceito, ponto ignorado, 120,2 ha calculados), **shapefile .zip do CAR** em SIRGAS 2000 (aceito, 120,2 ha) e GeoJSON com **bordas cruzadas** (recusado com explicação).

## 2. Situação das integrações (dados reais)

| Fonte | Situação | Evidência |
|---|---|---|
| INPE — focos de calor | **Operacional**: sincronização incremental; rotina automática de hora em hora + alertas | 17/11: 5.601 (hoje) + 11.365 (ontem) focos; homologação carregada |
| Sisfogo — ROIs (Ibama/Prevfogo) | **Operacional**: contrato verificado na API real; completa + incremental; retificações com histórico | Homologação: 1.724 ROIs, 87 páginas, 0 rejeitados. Dev: retificação real registrada (ROI.25102026.AM.0001, revisão 2) |
| Open-Meteo — clima | **Operacional**, com até 3 tentativas e uso do último valor (≤ 3 h, declarado) se a API falhar | análises de 17/11 com valores ao vivo; 429 observado e tratado |
| IBGE — municípios | **Carregado** (era pendência) | 5.571 municípios na base de homologação |
| E-mail (SMTP) | **Pronto, não configurado**: sem SMTP, convites e recuperação usam link gerado pelo administrador | testes com transporte de e-mail substituto |

## 3. O que funciona (verificado)

- Cadastro, login, sair, recuperação de senha **real**: e-mail quando há SMTP; sem SMTP, a pessoa é orientada a pedir ao administrador, que gera um link de uso único (72 h).
- Organizações: membros, papéis, **convite por e-mail** (cria a conta), link de acesso para membros; administrador de organização não pode gerar link para quem participa de outra organização.
- Propriedades: desenho do limite no mapa, importação GeoJSON/KML/KMZ/shapefile, validação geométrica no servidor, área e centro **calculados** e identificados como calculados; avisos quando valores informados divergem do polígono.
- Página da propriedade: focos do INPE (dentro, 1/5/10 km, mais próximo, satélites, atualização), histórico do Sisfogo, ocorrências importadas, análises e alertas.
- Análise de risco com proveniência por variável (informado / estimativa / observado / registro / registro oficial / calculado) e limitações.
- Alertas: por análise (alto/crítico) e **por foco detectado** dentro ou a até N km da propriedade (configurável por propriedade, 0–50 km); um por propriedade por dia, atualizado sem duplicar; ciclo de vida com histórico.
- Mapa ambiental com camadas independentes e filtros; relatórios com rastreabilidade e PDF.
- Painel administrativo com **números reais** (antes exibia valores inventados, ex.: "12 + nº de sensores" usuários): usuários, organizações, áreas, análises, alertas, saúde das sincronizações, falhas, auditoria, lista de usuários com último acesso.
- Sincronizações automáticas monitoradas (agendador interno com trava) e manuais (administrador).

Corrigido nesta etapa por não funcionar de verdade: painel admin com números fictícios; recuperação de senha que nunca entregava o link em produção; adicionar membro só funcionava para quem já tinha conta; preferências em Configurações que não faziam nada (removidas); Open-Meteo falhando com 429 sem nova tentativa; texto "Foco de incêndio" para detecções de satélite.

## 4. Testes automatizados (executados)

| Suíte | Resultado |
|---|---|
| `npm test` (motor TS) | ok |
| Unitários | 46/46 |
| Integração com PostgreSQL real (API, banco, Sisfogo, produto) | 75/75 (com PostGIS) |
| Motor Python (pytest) | 109 passaram |
| E2E clássico (`flow.cjs`) | 12/12 |
| E2E de uso real (`real-user.cjs`) | 10/10 (dev e build de produção) |
| Acessibilidade (axe) | 17 telas, sem violações |
| Varredura de telas (desktop e celular) | 17 telas sem erro, sem rolagem horizontal |

## 5. Homologação

- **Agora (prévia privada desta sessão):** build de produção, base limpa `artemis_homolog` com dados reais (INPE, Sisfogo, IBGE), agendador ligado. Visível só para você no app do Claude, enquanto a sessão estiver ativa. Conta de administradora criada; senha definida por link de uso único.
- **VPS (privada, HTTPS + senha do site):** `scripts/ops/deploy-homolog.sh` — gera segredos que faltam, senha do site (mostrada uma vez, guardada só como hash), sobe a pilha com `docker-compose.homolog.yml` (Caddy com Let's Encrypt + senha), carrega IBGE/INPE/Sisfogo e cria sua conta de administradora. Caddyfile validado pelo próprio Caddy; compose validado. **Não executado** aqui (sem acesso à VPS).

## 6. Pendências (objetivas)

| Pendência | Depende de |
|---|---|
| Executar `deploy-homolog.sh` na VPS e apontar o DNS do domínio de homologação | você (acesso à VPS e ao DNS) |
| Configurar SMTP (`SMTP_URL`, `MAIL_FROM`) para e-mails de convite/recuperação/alertas | credenciais de e-mail |
| Notificação de alertas por e-mail | SMTP |
| Calibração do motor com incêndios reais da área (limiares documentados, não calibrados) | dados/estudo da Prova de Valor |
| Divergência antiga entre motores: foco a 5–15 km vale 15 pontos no Python e 12 no TypeScript (reserva) | decisão técnica sua (não alterei pesos) |
| Contornos de biomas no mapa são ilustrativos (não IBGE) | carga da malha oficial |
| Retenção das revisões do Sisfogo; termos de uso comercial do Ibama | decisão sua / Ibama |
| Desenho de polígono: sem edição vértice a vértice (redesenhar substitui) | evolução |
| Ambiente de produção pública | sua aprovação após a homologação |

## 7. Implantação, manutenção e recuperação

- Instalação na VPS: `04_IMPLANTACAO_HOSTINGER.md` (servidor) + `scripts/ops/deploy-homolog.sh` (homologação privada) + checklist `14_HOMOLOGACAO_HOSTINGER.md`.
- Primeiro administrador em qualquer instalação: `node dist/create-admin.cjs --email … --name … --org … --base https://…` (imprime link de uso único).
- Sincronizações: automáticas na API (`SCHEDULER_ENABLED=true`); manual em Fontes de Dados (Sisfogo) ou `docker compose --profile jobs run --rm inpe-sync|sisfogo-sync`.
- Monitoramento: Painel Admin (falhas 24 h, última sincronização) e `GET /api/health`.
- Backup e restauração testados: `05_BACKUP_RECUPERACAO.md` (`scripts/ops/backup.sh`, `restore.sh`, `fingerprint.sql`).
- Migrações: só aditivas; executor recusa arquivos inconsistentes e alterações em migrações já aplicadas; teste em cópia restaurada antes de produção (`10_BANCO_MANUTENCAO_SEGURANCA.md`).

## 8. Evidências operacionais e maturidade (2026-11-17)

- Telemetria própria (migração 0013): heartbeat por minuto, latência/erros por rota → `/admin/operacao`.
- Coleta de evidências de uso: avaliação de alertas por especialista, tempo de análise, botão "Enviar opinião", questionário SUS (`/avaliacao`), validação de desfechos, exportação `/api/admin/evidence.json`.
- Segurança 28/28 e carga sem erros: `16_SEGURANCA_DESEMPENHO.md`.
- Metodologia do índice: `17_METODOLOGIA_RISCO.md` · Piloto: `18_PLANO_PILOTO_OPERACAO.md` · Operação: `19_RUNBOOK_PRODUCAO.md`.
- **Maturidade avaliada: TRL 6** (`20_DOSSIE_TRL.md`). TRL 7–9 dependem de VPS, usuários reais e tempo de operação.
