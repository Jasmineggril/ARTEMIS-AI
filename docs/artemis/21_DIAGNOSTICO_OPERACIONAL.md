# 21 — Diagnóstico operacional, plano e situação dos entregáveis (2026-11-18)

Branch de trabalho: **`operacional/artemis-dados-reais`**, criada a partir de
`integration/artemis-sisfogo-inpe` (PR #4, ainda não mesclado). Nada foi mesclado na `main`
nem publicado. Os bancos usados são de desenvolvimento e teste, locais.

## 1. Diagnóstico diferencial das branches

| Branch | Último commit | Commits que a integração não tem | Conclusão |
|---|---|---|---|
| `integration/artemis-sisfogo-inpe` | 30fdb12 (18/11) | — | **mais completa**: base deste trabalho |
| `claude/friendly-cerf-x7tgnx` | ad8101c (16/11) | 0 | já contida |
| `main` | ec5e5c2 (22/08) | 0 | já contida |
| `db/postgres-hostinger-dev` | 0dcbf35 (16/11) | 3 | auditada em `12_CONSOLIDACAO_BRANCHES.md`; o que era útil já foi incorporado |
| `feature/sisfogo-integration` | 0f999fc (16/11) | 5 | idem (conector antigo, substituído pelo contrato real da API) |
| `copilot/fix-…` | 611e640 (23/06) | 2 | só um "Initial plan"; nada a aproveitar |

Nenhuma branch recebeu commits novos desde a auditoria de 16/11. O arquivo
`ARTEMIS-AI-main (1).zip` e o PDF do cronograma não estão neste ambiente; o cronograma foi
seguido pelas etapas descritas no pedido (`22_PROVA_DE_VALOR_METODOLOGIA.md`).

## 2. Linha de base técnica (antes das mudanças)

`npm run test:all`: 46/46 unitários, 80 aprovados + 2 ignorados (PostGIS) de 82 de integração,
109/109 pytest, 35 s.

## 3. Problemas encontrados (com evidência) e o que foi feito

| # | Problema | Como foi comprovado | Correção |
|---|---|---|---|
| 1 | Os motores Python e TypeScript divergiam em **51 %** das entradas (foco a 5–50 km e histórico) | `tests/unit/engine-parity.test.ts`: 1 765 divergências em 3 433 entradas com o código anterior | motor 1.1.0 nos dois, com diferença zero; migração 0014 registra a versão |
| 2 | O motor Python explicava +4 pontos para foco além de 50 km sem somá-los à pontuação | mesmo teste (soma dos fatores ≠ pontuação) | corrigido |
| 3 | Faixas inteiras no Python (≥ 26 km/h, ≥ 11 mm) erravam valores fracionários do Open-Meteo | idem | faixas contínuas |
| 4 | **A API caía quando o banco reiniciava** (erro sem ouvinte no pool do `pg`) | `tests/resilience/resilience-check.cjs` | ouvinte de erro no pool; o processo sobrevive e se recupera sozinho |
| 5 | `/api/health` respondia 500, e não 503, com o banco fora, para quem tinha sessão | idem | health check fora do middleware de sessão |
| 6 | Consultas espaciais dos serviços não usavam PostGIS (caixa delimitadora + cálculo na aplicação) | leitura do código | `server/services/spatial.ts`: `ST_DWithin` + `ST_Distance` com índice GiST; reserva equivalente; teste compara os dois |
| 7 | Sem limites municipais oficiais | — | malhas do IBGE (5 570 polígonos, migração 0016), município por ponto e conferência do município declarado |
| 8 | INPE: sem nova tentativa em falhas transitórias, sem histórico além de ~4 semanas e sem fechar execuções interrompidas | testes | novas tentativas com espera crescente, arquivos mensais (`--month`), checagem de datas, execuções órfãs encerradas |
| 9 | Alertas sem notificação por e-mail nem registro de entrega | — | migração 0015: preferências, registro por destinatário, novas tentativas, "bloqueado por configuração" sem SMTP |
| 10 | Prova de Valor sem linha de base de tempo e sem avaliação das recomendações | — | migração 0017 + tela de cronômetro + indicadores I1/I2 |
| 11 | Motor nunca avaliado contra desfechos reais | — | backtest com 4 800 casos reais e treino experimental com separação temporal (`23`) |

Três achados de dados ficaram registrados sem correção, por serem da fonte:
- três polígonos do IBGE (Nhamundá/AM, Barbalha/CE e Juína/MT) têm autointerseção; as consultas os reparam com `ST_MakeValid`;
- Boa Esperança do Norte/MT (5101837) não tem malha publicada;
- arquivos diários do INPE anteriores a ~4 semanas retornam 404; os mensais existem.

## 4. Situação por entregável

| # | Entregável | Implementado | Testado | Evidência | Pendência | Próxima ação |
|---|---|---|---|---|---|---|
| 1 | Diagnóstico diferencial | sim | — | este documento, `12` | — | — |
| 2 | Plano priorizado | sim | — | §3 deste documento e `22` | — | — |
| 3 | Código em branch separada | sim | sim | `operacional/artemis-dados-reais` | revisão | revisar e decidir o PR |
| 4 | Pipelines de dados reais | INPE (diário/mensal), Sisfogo, Open-Meteo, IBGE (municípios e malhas) | sim | 2 650 395 focos carregados; reprocessar outubro inteiro = 0 inseridos / 931 795 inalterados; `testes-resumo.json` | agendamento real só na VPS | implantar |
| 5 | Migrações e banco | 0014–0017, só aditivas | sim, com e sem PostGIS | `testes-com-postgis.log`, `testes-sem-postgis.log`; EXPLAIN com GiST | aplicar na homologação após aprovação | — |
| 6 | Motor de risco consolidado | 1.1.0, paridade exata | sim (3 433 entradas) | `engine-parity.test.ts`, `17`, `23` | calibração de limiares | decidir proposta 1.2.0 (`23` §6) |
| 7 | APIs e frontend | sim | E2E 10/10 no build de produção | `e2e-usuario-real.log`, `capturas/` | — | — |
| 8 | Alertas e relatórios | alertas, registro de entrega por e-mail, relatórios rastreáveis | sim | `notifications.test.ts` | **SMTP sem credenciais**: e-mails ficam "não enviados" (registrado, não simulado) | configurar SMTP |
| 9 | Testes executados | sim | 293 aprovados com PostGIS, 0 falhas | `testes-resumo.json` | — | — |
| 10 | Instalação e operação | sim | parcial (local) | `04`, `14`, `19` | não executado na VPS | `deploy-homolog.sh` |
| 11 | Evidências técnicas e métricas | sim | sim | `evidencias/2026-11-18/` | métricas de operação real | piloto |
| 12 | Plano de piloto | sim | — | `18`, `22` | usuários reais | convidar avaliadores |
| 13 | Relatório TRL | atualizado | — | `20` | — | — |

## 5. Bloqueios externos (não simulados)

- **VPS/DNS/HTTPS público:** sem acesso à Hostinger a partir deste ambiente.
- **SMTP:** sem credenciais; o código registra "bloqueado por configuração".
- **Open-Meteo histórico (`archive-api`):** bloqueado pela rede deste ambiente; o backtest usou o
  endpoint permitido (`past_days=92`), o que limita a janela aos últimos ~90 dias.
- **Usuários reais e avaliadores:** dependem da sua seleção e autorização.
