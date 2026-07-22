# 04 — Roteiro de Evidências Visuais — TRL 4

> Capturas a serem realizadas para comprovação visual do protótipo funcional.
> Todas as telas devem ser acessadas com VITE_SUBMISSION_MODE=true para anonimização.

---

## Instruções de Captura

1. Ativar VITE_SUBMISSION_MODE=true no ambiente
2. Fazer login com conta demonstrativa
3. Fechar o tutorial de onboarding
4. Capturar cada tela conforme roteiro abaixo
5. Para o terminal: usar `npm run test:risk` e `pytest python_service/tests -v`

---

## Roteiro de Capturas

| # | Tela | Rota | Funcionalidade | Status da tela |
|---|---|---|---|---|
| 01 | Página inicial (Home) | / | Landing page com hero, seções e TRL badge | Implementada |
| 02 | Login | /login | Autenticação de usuário | Implementada |
| 03 | Visão Geral (Dashboard) | /dashboard | Cards de indicadores, gráficos | Implementada |
| 04 | Áreas Monitoradas | /areas | Listagem e cadastro de áreas | Implementada |
| 05 | Análise de Risco — Formulário | /risk-analysis | Formulário com campos ambientais | Implementada |
| 06 | Análise de Risco — Resultado Baixo | /risk-analysis | Score 0–24, fatores e recomendações | Implementada |
| 07 | Análise de Risco — Resultado Moderado | /risk-analysis | Score 25–49 | Implementada |
| 08 | Análise de Risco — Resultado Alto | /risk-analysis | Score 50–74 | Implementada |
| 09 | Análise de Risco — Resultado Crítico | /risk-analysis | Score 75–100 | Implementada |
| 10 | Fatores críticos | /risk-analysis | Cards de fatores com contribuição | Implementada |
| 11 | Recomendações preventivas | /risk-analysis | Lista de recomendações por prioridade | Implementada |
| 12 | Badge do modelo | /risk-analysis | Indicador "supervised-ml" ou "rule-engine" | Implementada |
| 13 | Mapa de Risco | /maps | Mapa Leaflet com marcadores | Implementada |
| 14 | Ocorrências no mapa | /maps | Pontos de ocorrências importadas | Implementada |
| 15 | Alertas Preventivos | /alerts | Listagem com severidade e status | Implementada |
| 16 | Importação — Upload | /data-import | Área de drag & drop + download demo CSV | Implementada |
| 17 | Importação — Mapeamento | /data-import | Interface de mapeamento de colunas | Implementada |
| 18 | Importação — Validação | /data-import | Tabela com status por registro | Implementada |
| 19 | Importação — Resultado | /data-import | Relatório de lote salvo | Implementada |
| 20 | Fontes de Dados | /data-sources | Grid de fontes com status e qualidade | Implementada |
| 21 | Inteligência Operacional | /insights | Gráficos e KPIs demonstrativos | Implementada |
| 22 | Protocolos de Prevenção | /prevention | Protocolos por nível de risco | Implementada |
| 23 | Relatórios | /reports | Listagem e geração | Implementada |
| 24 | Ajuda | /help | FAQ e instruções de uso | Implementada |
| 25 | Terminal TypeScript | Shell | Saída de `npm run test:risk` (35 aprovados) | Executado |
| 26 | Terminal Python | Shell | Saída de `pytest ... -v` (104 aprovados) | Executado |
| 27 | Terminal Python API | Shell | Resposta de POST /analyze-risk | Executado |
| 28 | Métricas do modelo | results/metrics.json | Accuracy, F1, matriz de confusão | Gerado |
| 29 | Matriz de confusão | results/confusion_matrix.png | Imagem gerada por matplotlib | Gerado |
| 30 | Schema do banco | shared/schema.ts | Definição das tabelas | No código |

---

## Metadados de cada captura

Para cada imagem, registrar:

| Campo | Conteúdo |
|---|---|
| Número | Sequencial (01–30) |
| Título | Nome descritivo |
| Funcionalidade demonstrada | O que está sendo provado |
| Status | Implementado / Demonstrativo / Experimental |
| Origem dos dados | Sintético / Demonstrativo / Público / Real |
| Indicação de simulação | Sim / Não |

---

## Aviso sobre Dados

Todas as telas que exibem dados de análise, alertas, sensores ou ocorrências utilizam dados demonstrativos ou sintéticos gerados em ambiente controlado. Isso é informado explicitamente na interface.
