# 06 — Matriz de Rastreabilidade — TRL 4

| Requisito | Funcionalidade | Código-fonte | Teste | Evidência | Status |
|---|---|---|---|---|---|
| Entrada de dados ambientais | Formulário de análise | client/src/pages/RiskAnalysis.tsx | TC-01 a TC-04 | 4 cenários executados | COMPROVADO |
| Validação de entrada | validateRiskInput() | shared/risk-engine.ts | test_validation.py | 23 testes Python aprovados | COMPROVADO |
| Motor de classificação | calculateRisk() | shared/risk-engine.ts | tests/risk-engine.test.ts | 34 testes TypeScript aprovados | COMPROVADO |
| Serviço Python | POST /analyze-risk | python_service/app.py | test_api.py | 20 testes API aprovados | COMPROVADO |
| Modelo supervisionado | predict_with_ml_model() | python_service/risk_model.py | test_model.py | 27 testes aprovados | COMPROVADO |
| Score 0–100 | score limitado | risk-engine.ts + risk_model.py | TC-01 a TC-04 | Cenários: 17, 39, 62, 82 | COMPROVADO |
| Fatores explicativos | factors[] | shared/risk-engine.ts | TC-01 a TC-04 | 4 fatores por cenário moderado/alto/crítico | COMPROVADO |
| Recomendações preventivas | recommendations[] | risk-engine.ts + risk_model.py | TC-01 a TC-04 | 4 recomendações por cenário | COMPROVADO |
| Autenticação | bcrypt + sessões | server/auth.ts | test_auth.py | 10 testes autenticação aprovados | COMPROVADO |
| Rotas protegidas | HTTP 401 sem sessão | server/routes.ts | GET /api/import-batches | 401 Unauthorized verificado | COMPROVADO |
| Importação CSV | parseCSV() | DataImport.tsx | import-data.test.py | 20 registros válidos | COMPROVADO |
| Importação XLSX | XLSX library | DataImport.tsx | import-data.test.py | 20 registros válidos | COMPROVADO |
| Importação XLS | XLS library | DataImport.tsx | import-data.test.py | 20 registros válidos | COMPROVADO |
| Validação de coordenadas | latitude/longitude check | DataImport.tsx | import-data.test.py | 100% validos | COMPROVADO |
| Build de produção | npm run build | vite.config.ts | Script build.ts | Artefato dist/ gerado com sucesso | COMPROVADO |
| Testes Python | pytest 104 testes | python_service/tests/ | pytest -v | 104/104 aprovados (0 falhas) | COMPROVADO |
| Testes TypeScript | npm run test (44 testes) | tests/*.test.ts | test:risk + test:auth | 44/44 aprovados (34+10) | COMPROVADO |
| Verificação tipos | npm run check | tsc | TypeScript check | 0 erros de compilação | COMPROVADO |
| Alertas | CRUD /api/alerts | server/routes.ts | Manual | Tela /alerts | IMPLEMENTADO |
| Mapa de risco | Leaflet + marcadores | client/src/pages/CeresMaps.tsx | Manual | Tela /maps | IMPLEMENTADO |
| Relatórios | Tela /reports | client/src/pages/Reports.tsx | Manual | Tela /reports | IMPLEMENTADO — demonstrativo |
| Persistência | PostgreSQL + Drizzle | server/storage.ts, shared/schema.ts | Manual | Banco com fallback em-memória | IMPLEMENTADO |
| Tratamento de dados | parseCSV + validateRows | DataImport.tsx | import-data.test.py | Processamento automático | IMPLEMENTADO |
| Mapeamento de colunas | autoMap() + UI | DataImport.tsx | Manual | Tela mapeamento | IMPLEMENTADO |
| Rastreabilidade por lote | import_batches table | shared/schema.ts | — | Banco | IMPLEMENTADO |
| Ocorrências por registro | fire_occurrences table | shared/schema.ts | — | Banco | IMPLEMENTADO |
| Histórico influencia risco | historical_occurrences | risk-engine.ts | TC-01 a TC-04 | Factor "histórico" | IMPLEMENTADO |
| Modo de submissão anônima | VITE_SUBMISSION_MODE | shared/identity.ts | Manual | Header sem identidade | IMPLEMENTADO |
| Tutorial de onboarding | OnboardingTour | OnboardingTour.tsx | Manual | Modal inicial | IMPLEMENTADO |
| Fontes de dados | /data-sources | DataSources.tsx + /api/data-sources | Manual | Tela /data-sources | IMPLEMENTADO |
| Áreas monitoradas | /areas | Areas.tsx + /api/monitored-areas | Manual | Tela /areas | IMPLEMENTADO |
| Navegação completa | Sidebar + Router | Layout.tsx + App.tsx | Manual | Todos os menus | IMPLEMENTADO |
| Fallback Python | TS rule engine fallback | server/routes.ts | Manual | Log de fallback | IMPLEMENTADO |
| Dados rotulados como simulados | isSimulated flag + labels | shared/identity.ts | — | Badge na tela | IMPLEMENTADO |
| Aviso apoio à decisão | DECISION_SUPPORT_DISCLAIMER | shared/identity.ts | — | Texto na tela | IMPLEMENTADO |
| Anonimização de identidade | SUBMISSION_MODE | shared/identity.ts | Manual | Header anônimo | IMPLEMENTADO |
| Não-integração oficial Sisfogo | Aviso na tela | DataImport.tsx | — | Texto de aviso | IMPLEMENTADO |
