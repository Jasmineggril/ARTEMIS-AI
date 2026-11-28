# Status dos entregáveis — ARTEMIS AI

Legenda: **Implementado e testado** · **Implementado** (sem teste automatizado dedicado) · **Parcial** · **Pendente** · **Bloqueado**

Última atualização: 28/11/2026 (itens 23–27 na branch `feature/ciencia-risco-inpe`, ainda não na `main` nem em produção).

| # | Entregável | Status | Evidência / observação |
|---|---|---|---|
| 1 | Diagnóstico do repositório | Implementado | `00_DIAGNOSTICO.md` |
| 2 | Requisitos funcionais e não funcionais | Implementado | `01_REQUISITOS.md` |
| 3 | Arquitetura atualizada | Implementado | `02_ARQUITETURA.md` |
| 4 | Identidade visual | Implementado | Nome ARTEMIS AI em todas as telas, API, serviço Python e documentação; marca, paleta, telas de autenticação; página inicial reescrita (indicadores reais do INPE, módulos, perfis de público, fontes e limites, privacidade, maturidade). Modo escuro não revisado tela a tela |
| 5 | Frontend funcional e responsivo | Parcial | Login, cadastro, recuperação de senha, dashboard, áreas, análise, alertas, mapa, organização e privacidade usam a API real. Relatórios e Inteligência Operacional também usam a API real. Testado em 1366 px e iPhone 13. |
| 6 | Backend integrado | Implementado e testado | 27 testes de integração com PostgreSQL real |
| 7 | Serviço de análise de risco | Implementado e testado | 109 pytest; caminho Node→Python testado com o serviço no ar e com fallback |
| 8 | Banco de dados e migrações | Implementado e testado | 12 migrações versionadas (0000–0011); 0004–0009 e 0011 aplicadas em cópia restaurada com impressão digital idêntica e em dev; executor recusa numeração duplicada, codificação corrompida e migração aplicada editada (checksum); papéis com privilégio mínimo; ver `09`–`12` |
| 9 | Mapas e gráficos | Parcial | Mapa Ambiental com camadas independentes (Sisfogo, INPE, ocorrências importadas, áreas, resultado de risco), agrupamento de pontos, filtros (UF, município, período, tipo de local, área monitorada num raio de 10 km, nível), legenda com fonte e data de atualização; Consulta Pública com mapa, gráficos e comparação. Pendente: desenho de polígono, busca por endereço. |
| 10 | Módulo de alertas | Implementado e testado | Ciclo de vida, histórico, deduplicação. **Notificação por e-mail pendente.** |
| 11 | Importação de dados | Implementado e testado | Revalidação no servidor, motivos de rejeição por lote, isolamento por organização |
| 12 | Relatórios | Parcial | Relatório por área e período (resumo, distribuição, histórico, alertas e medidas, fontes, qualidade, motor/versão, limitações), impressão/PDF pelo navegador e CSV. Pendentes: PDF gerado no servidor, mapa dentro do relatório, módulo PoV. |
| 13 | Testes automatizados | Implementado | TS legados (`npm test`), 37 unitários, 66 de integração com PostgreSQL real (41 API, 9 banco, 16 Sisfogo; os 66 também com PostGIS), 109 pytest, 12 passos E2E, 15 telas axe sem violações |
| 14 | Documentação das APIs | Implementado | `03_API.md` |
| 15 | Docker Compose dev e produção | Implementado e testado (parcial) | Pilha `artemis_ai` + PostGIS executada: init de papéis, `migrate`, API saudável com papel restrito, banco sem porta publicada, backup/restauração via contêiner, recuperação após reinício. Não verificado aqui: build completo das imagens (sem acesso a npm/PyPI no build) e motor Python em contêiner |
| 16 | Implantação na Hostinger | Implementado (documento) | `04_IMPLANTACAO_HOSTINGER.md`. Não executado: requer VPS e autorização. |
| 17 | Backup e recuperação | Implementado e testado | Ciclo backup → restauração executado com contagens idênticas; recusa banco não vazio; falha com senha errada |
| 18 | Manual do usuário e do administrador | Implementado | `06_MANUAL.md` |
| 19 | Limitações e pendências | Implementado | `07_LIMITACOES_PENDENCIAS.md` |
| 20 | Plano de validação da Prova de Valor | Implementado (plano) | `08_PLANO_PROVA_DE_VALOR.md`. Nenhum resultado da PoV existe ainda. |
| 21 | Integração Sisfogo (Ibama/Prevfogo) | Implementado e testado (dev) | Contrato verificado com a API real; sincronização completa real em dev (1.698 ROIs); histórico de retificações, indisponibilidade, retomada, trava; motor de risco com proveniência; painel e sincronização manual de administrador. Pendente: execução na VPS — `11`, `13`, `14` |
| 22 | Consolidação das branches | Implementado | `12_CONSOLIDACAO_BRANCHES.md`; branch `integration/artemis-sisfogo-inpe` |
| 23 | Risco de Fogo oficial do INPE (observado, previsto, dias sem chuva) | Implementado e testado (dev) | Dados reais em dev; teste de integração; conferência independente. Pendente: execução na VPS — `26` |
| 24 | Método INPE 2.2 (Setzer) reproduzido | Implementado e testado | Erro médio 0,016, 93 % na mesma classe contra a grade oficial — `26` §4 |
| 25 | Índice de Haines | Implementado e testado | Só com níveis de pressão; "indisponível" com o motivo caso contrário; depende da cota do Open-Meteo — `26` §4.2 |
| 26 | IA: avaliação com RF oficial, calibração, separação temporal e geográfica | Implementado (avaliação) | Modelo combinado **não ativado** (ganho marginal, calibração instável) — `27` |
| 27 | Mapa (camadas oficiais, consulta por ponto, exportação) e alertas de risco persistente | Implementado e testado (dev) | Capturas com dados reais; regras R1/R2 não calibradas — `26` §6 |

## Critérios de aceitação da primeira versão (seção 16 do prompt mestre)

| Critério | Situação | Evidência |
|---|---|---|
| Usuário autorizado acessa a plataforma | Atendido | integração 3–6, E2E `signup` |
| Organização cadastra área | Atendido | integração 11, E2E `create area` |
| Análise executada e explicada | Atendido | integração 14, E2E `analyze area` |
| Resultado armazenado e recuperado | Atendido | integração 14 (histórico + `GET /api/analyses/:id`) |
| Mapa apresenta áreas e ocorrências | Atendido | E2E `map renders area` |
| Filtros funcionam | Atendido (API) | integração 18; filtros do mapa sem teste E2E dedicado |
| Alertas gerenciados | Atendido | integração 15–17, E2E `alert lifecycle` |
| Dados históricos importados com validação | Atendido | integração 18–19 |
| Relatórios exportados | Parcial | Relatório por período e CSV testados (integração); PDF pelo navegador |
| Permissões impedem acesso indevido | Atendido | integração 20–21 |
| Funciona em celular e desktop | Atendido nas telas testadas | E2E `mobile layout` (4 rotas, sem rolagem horizontal) |
| Testes críticos executados e aprovados | Atendido | ver tabela acima |
| Implantação e restauração documentadas | Parcial | restauração testada; implantação documentada, não executada |

**A plataforma não está pronta para produção.** Ver `07_LIMITACOES_PENDENCIAS.md`.

## Atualização 2026-11-17 — rumo a TRL 9

| Entregável | Situação | Evidência |
|---|---|---|
| URL funcional (HTTPS) | Pendente — VPS/DNS | script pronto: `scripts/ops/deploy-homolog.sh` |
| Contas reais / usuários reais | Pendente — piloto | `18_PLANO_PILOTO_OPERACAO.md` |
| Integrações ativas (INPE, Sisfogo, Open-Meteo, IBGE) | Atendido em homologação local | `11_SISFOGO.md`, `15_PRODUTO_SITUACAO.md` |
| Monitoramento | Atendido (instrumentação) | `/admin/operacao`, migração 0013 |
| Evidências de uso real | Pendente — piloto | coleta pronta: opiniões, SUS, avaliação de alertas |
| Relatório de desempenho | Atendido (laboratório) | `16_SEGURANCA_DESEMPENHO.md`, `evidencias/2026-11-17/` |
| Documentação técnica e operacional | Atendido | `17`–`19` |
| Dossiê TRL | Atendido — nível atual **TRL 6** | `20_DOSSIE_TRL.md` |

## Atualização 2026-11-18 — operação com dados reais

Quadro completo (Implementado | Testado | Evidência | Pendência | Próxima ação): `21_DIAGNOSTICO_OPERACIONAL.md` §4.
Validação do motor com dados reais: `23`. Prova de Valor: `22`. Maturidade continua **TRL 6**.

## Atualização 2026-11-18 — módulo INMET

Observações oficiais das estações automáticas: coleta, validação, PostGIS, vínculo com propriedades,
integração rastreável ao motor e painel. Detalhes e evidências: `24_INMET.md` e `evidencias/2026-11-18-inmet/`.
Pendência: token do INMET para dados horários recentes (hoje o arquivo público chega ~1×/mês).
