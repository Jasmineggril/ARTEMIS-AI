# Matriz de Funcionalidades — Plataforma Preditiva de Inteligência Ambiental

## Funcionalidades implementadas

| # | Funcionalidade | Tela | Status | Dados |
|---|---|---|---|---|
| 1 | Motor de classificação de risco v1.0.0 | shared/risk-engine.ts | ✅ Implementado | — |
| 2 | Análise preditiva com entrada manual | /simulacao | ✅ Implementado | Entrada manual |
| 3 | Classificação em 4 níveis (0–100) | /simulacao | ✅ Implementado | — |
| 4 | Explicação dos fatores de risco | /simulacao | ✅ Implementado | — |
| 5 | Recomendações preventivas por nível | /simulacao | ✅ Implementado | — |
| 6 | 4 cenários demonstrativos | /simulacao | ✅ Implementado | Simulados |
| 7 | Painel de visão geral | /dashboard | ✅ Implementado | Simulados |
| 8 | Gráfico de evolução do risco | /dashboard | ✅ Implementado | Simulados |
| 9 | Tabela de áreas prioritárias | /dashboard | ✅ Implementado | Simulados |
| 10 | Mapa de risco georreferenciado | /maps | ✅ Implementado | Simulados |
| 11 | Filtros por nível e setor no mapa | /maps | ✅ Implementado | — |
| 12 | Painel lateral de área no mapa | /maps | ✅ Implementado | Simulados |
| 13 | Gráficos de inteligência operacional | /insights | ✅ Implementado | Simulados |
| 14 | Distribuição por nível de risco | /insights | ✅ Implementado | Simulados |
| 15 | Fatores críticos mais frequentes | /insights | ✅ Implementado | Simulados |
| 16 | Status das fontes de dados | /insights | ✅ Implementado | Simulados |
| 17 | Alertas preventivos com severidade | /alerts | ✅ Implementado | Banco de dados |
| 18 | Resolução de alertas | /alerts | ✅ Implementado | Banco de dados |
| 19 | Protocolos de prevenção por nível | /prevention | ✅ Implementado | — |
| 20 | Checklists interativos | /prevention | ✅ Implementado | — |
| 21 | Relatórios de análise | /reports | ✅ Implementado | Simulados |
| 22 | Relatório comparativo de cenários | /reports | ✅ Implementado | Simulados |
| 23 | Espaço de validação técnica | /reports | ✅ Implementado | — |
| 24 | Impressão de relatório | /reports | ✅ Implementado | — |
| 25 | Áreas monitoradas com tabela | /areas | ✅ Implementado | Simulados |
| 26 | Filtros e busca de áreas | /areas | ✅ Implementado | — |
| 27 | Fontes de dados / sensores | /sensors | ✅ Implementado | Banco de dados |
| 28 | Autenticação (signup/login/logout) | /login, /signup | ✅ Implementado | Banco de dados |
| 29 | Perfil de usuário | /settings | ✅ Implementado | Banco de dados |
| 30 | Modo de submissão (SUBMISSION_MODE) | global | ✅ Implementado | — |
| 31 | Dados climáticos reais (Open-Meteo) | — | ✅ Implementado | API real |
| 32 | Assistente de chat com IA (OpenAI) | global (chatbot) | ✅ Implementado | OpenAI API |
| 33 | Fallback offline do assistente | global (chatbot) | ✅ Implementado | Local |
| 34 | Testes automatizados (34 risco + 10 auth) | tests/ | ✅ Executados 17/07/2026 | — |

## Funcionalidades previstas (Prova de Valor)

| # | Funcionalidade | Prazo |
|---|---|---|
| 35 | Modelo supervisionado treinado com dados reais | PoV 60 dias |
| 36 | Integração com INPE (focos de incêndio) | PoV 60 dias |
| 37 | Integração com MapBiomas (cobertura vegetal) | PoV 60 dias |
| 38 | Integração com sensores físicos de campo | PoV 60 dias |
| 39 | Alertas via SMS/WhatsApp | PoV 60 dias |
| 40 | Exportação nativa de PDF | PoV 60 dias |
| 41 | Autenticação com 2FA | PoV 60 dias |
| 42 | Calibração dos thresholds do motor | PoV 60 dias |

## Legenda

- ✅ Implementado: funcionalidade completa e testável no protótipo
- 🔄 Em desenvolvimento: parcialmente implementado
- 📋 Previsto: planejado para a Prova de Valor

## Identificação de dados simulados

Todas as funcionalidades marcadas com "Simulados" exibem na interface o rótulo:

> **"Dados simulados para demonstração em ambiente controlado."**

As únicas fontes de dados reais integradas são:
- **Open-Meteo API:** dados climáticos em tempo real
- **Banco de dados PostgreSQL:** usuários, sensores, alertas cadastrados
- **OpenAI gpt-4o-mini:** respostas do assistente de chat
