# 06 — Matriz de Rastreabilidade — TRL 4

> Legenda de status:
> - **Implementado** — código existe e foi verificado
> - **Testado automaticamente** — existe saída real de teste automatizado
> - **Pendente de evidência visual** — funcionalidade existe no código mas não há captura ou saída de terminal registrada
> - **Experimental** — implementado mas não validado operacionalmente

| Requisito | Funcionalidade | Código-fonte | Teste executado | Resultado real | Evidência | Status |
|---|---|---|---|---|---|---|
| Entrada de dados ambientais | Formulário de análise | client/src/pages/RiskAnalysis.tsx | TC-01 a TC-04 (risk-engine.test.ts) | 34/34 testes aprovados | Saída terminal npm run test:risk | Testado automaticamente |
| Validação de entrada | validateRiskInput() | shared/risk-engine.ts | test_validation.py (23 testes) | 23/23 aprovados | Saída terminal pytest | Testado automaticamente |
| Motor de classificação | calculateRisk() | shared/risk-engine.ts | tests/risk-engine.test.ts (34 testes) | 34/34 aprovados | Saída terminal npm run test:risk | Testado automaticamente |
| Serviço Python | POST /analyze-risk | python_service/app.py | test_api.py (20 testes) | 20/20 aprovados | Saída terminal pytest | Testado automaticamente |
| Modelo supervisionado | predict_with_ml_model() | python_service/risk_model.py | test_model.py (27 testes) | 27/27 aprovados | Saída terminal pytest | Experimental |
| Score 0–100 | Score limitado 0–100 | risk-engine.ts + risk_model.py | TC-01 a TC-04 | 34/34 aprovados | Saída terminal npm run test:risk | Testado automaticamente |
| Fatores explicativos | factors[] | shared/risk-engine.ts | TC-01 a TC-04 | 34/34 aprovados | Saída terminal npm run test:risk | Testado automaticamente |
| Recomendações preventivas | recommendations[] | risk-engine.ts + risk_model.py | TC-01 a TC-04 | 34/34 aprovados | Saída terminal npm run test:risk | Testado automaticamente |
| Alertas | CRUD /api/alerts | server/routes.ts | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Mapa de risco | Leaflet + marcadores | client/src/pages/CeresMaps.tsx | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Relatórios | Tela /reports | client/src/pages/Reports.tsx | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Persistência | PostgreSQL + Drizzle | server/storage.ts, shared/schema.ts | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Importação de ocorrências | /data-import (CSV/XLS/XLSX) | DataImport.tsx + /api/import-batches | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Tratamento de dados | parseCSV + validateRows | DataImport.tsx | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Mapeamento de colunas | autoMap() + UI | DataImport.tsx | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Rastreabilidade por lote | import_batches table | shared/schema.ts | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Ocorrências por registro | fire_occurrences table | shared/schema.ts | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Histórico influencia risco | historical_occurrences | risk-engine.ts | TC-01 a TC-04 | 34/34 aprovados | Saída terminal npm run test:risk | Testado automaticamente |
| Autenticação | bcrypt + sessões | server/auth.ts | tests/auth.test.ts (10 testes) | 10/10 aprovados | Saída terminal npm run test:auth | Testado automaticamente |
| Proteção de rotas de importação | 401 sem autenticação | server/routes.ts linhas 497, 560, 573 | Verificado no código | session?.userId check + return 401 | Revisão de código confirmada | Implementado |
| Modo de submissão anônima | VITE_SUBMISSION_MODE | shared/identity.ts | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Tutorial de onboarding | OnboardingTour | OnboardingTour.tsx | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Fontes de dados | /data-sources | DataSources.tsx + /api/data-sources | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Áreas monitoradas | /areas | Areas.tsx + /api/monitored-areas | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Navegação completa | Sidebar + Router | Layout.tsx + App.tsx | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Fallback Python | TS rule engine fallback | server/routes.ts | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Dados rotulados como simulados | isSimulated flag + labels | shared/identity.ts | — | — | Pendente de evidência visual | Implementado |
| Aviso apoio à decisão | DECISION_SUPPORT_DISCLAIMER | shared/identity.ts | — | — | Pendente de evidência visual | Implementado |
| Anonimização de identidade | SUBMISSION_MODE | shared/identity.ts | Não executado com saída real | — | Pendente de evidência visual | Implementado |
| Não-integração oficial Sisfogo | Aviso na tela | DataImport.tsx | — | — | Pendente de evidência visual | Implementado |
| Build de produção | npm run build | vite.config.ts | Não executado com saída real | — | Pendente de evidência visual | Pendente de evidência visual |
| Verificação TypeScript | npm run check | tsconfig.json | Executado em 21/07/2026 | 0 erros de compilação | Saída terminal npm run check | Testado automaticamente |
| Testes Python | pytest | python_service/tests/ | Executado em 21/07/2026 | 104/104 aprovados | Saída terminal pytest | Testado automaticamente |
| Testes TypeScript (risco + auth) | npm run test | tests/ | Executado em 21/07/2026 | 44/44 aprovados | Saída terminal npm run test | Testado automaticamente |
