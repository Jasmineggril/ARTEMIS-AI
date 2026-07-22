# 08 — Checklist Final de Submissão — TRL 4

> Legenda: **CONCLUÍDO** = executado com saída real registrada | **PENDENTE** = não há captura ou saída de terminal confirmada | **NÃO SE APLICA** = fora do escopo desta fase

---

## Funcionalidades do Sistema

| Item | Status | Observação |
|---|---|---|
| Sistema abre sem erros | PENDENTE | Sem captura de tela registrada |
| Login funciona (email + senha + bcrypt) | CONCLUÍDO | 10 testes de autenticação aprovados (npm run test:auth, 21/07/2026) |
| Análise de risco funciona (4 cenários testados) | CONCLUÍDO | 34 testes aprovados (npm run test:risk, 21/07/2026) |
| Serviço Python responde (GET /health → 200 OK) | PENDENTE | Sem saída real de curl ou terminal |
| Banco de dados salva resultados (risk_analyses) | PENDENTE | Sem saída real de consulta ao banco |
| Mapa carrega com marcadores (Leaflet) | PENDENTE | Sem captura de tela registrada |
| Alerta é gerado e exibido | PENDENTE | Sem captura de tela registrada |
| Relatório é acessível | PENDENTE | Sem captura de tela registrada |
| Importação de ocorrências funciona (CSV) | PENDENTE | Sem captura de tela registrada |
| Importação de ocorrências funciona (XLS) | PENDENTE | Sem captura de tela registrada |
| Importação de ocorrências funciona (XLSX) | PENDENTE | Sem captura de tela registrada |
| Dados são validados com status por registro | PENDENTE | Sem captura de tela registrada |
| Lote de importação é salvo no banco | PENDENTE | Sem saída real de banco |
| Ocorrências aparecem como fonte de dados | PENDENTE | Sem captura de tela registrada |
| Tutorial de onboarding funciona | PENDENTE | Sem captura de tela registrada |
| Modo de submissão anônima funciona (VITE_SUBMISSION_MODE=true) | PENDENTE | Sem captura de tela registrada |
| Fallback TypeScript funciona quando Python está indisponível | PENDENTE | Sem saída real de log registrada |

---

## Testes Automatizados

| Comando | Status | Resultado real | Data de execução |
|---|---|---|---|
| `npm run check` | CONCLUÍDO | 0 erros TypeScript | 21/07/2026 |
| `npm run test:risk` | CONCLUÍDO | 34/34 aprovados, 0 reprovados | 21/07/2026 |
| `npm run test:auth` | CONCLUÍDO | 10/10 aprovados, 0 reprovados | 21/07/2026 |
| `npm run build` | PENDENTE | Não executado com saída real | — |
| `pytest python_service/tests -v` | CONCLUÍDO | 104/104 aprovados, 18.493 warnings | 21/07/2026 |
| `python train_model.py` | CONCLUÍDO | Modelo retreinado — accuracy 1.0 | 21/07/2026 |
| `python evaluate_model.py` | CONCLUÍDO | Métricas geradas — accuracy 1.0 | 21/07/2026 |

---

## Modelo de Machine Learning

| Item | Status | Observação |
|---|---|---|
| Modelo treinado com scikit-learn 1.9.0 | CONCLUÍDO | Venv com sklearn 1.9.0 instalado |
| Modelo salvo como risk_classifier.joblib | CONCLUÍDO | Arquivo em python_service/models/ |
| 0 InconsistentVersionWarning | CONCLUÍDO | Modelo e ambiente na mesma versão (1.9.0) |
| Dataset equilibrado (500 amostras/classe) | CONCLUÍDO | Amostragem estratificada implementada |
| Conjunto de teste (100 amostras/classe) | CONCLUÍDO | 400 amostras totais, 100 por classe |
| Accuracy 1.0 com dados sintéticos | CONCLUÍDO | Resultado esperado — viés circular declarado |
| Aviso obrigatório sobre resultado sintético | CONCLUÍDO | Incluído em 02, 05, 07 e na interface |

---

## Veracidade dos Dados

| Item | Status | Observação |
|---|---|---|
| Dados sintéticos/demonstrativos estão rotulados na interface | PENDENTE | Sem captura de tela confirmada |
| Motor de regras NÃO é chamado de Machine Learning | CONCLUÍDO | Verificado no código (shared/identity.ts) |
| Modelo supervisionado é apresentado como "experimental" | CONCLUÍDO | Verificado na matriz de rastreabilidade |
| Métricas do modelo indicam dataset sintético | CONCLUÍDO | metrics.json contém campo "warning" declarando origem sintética |
| Aviso de apoio à decisão presente na análise | PENDENTE | Sem captura de tela registrada |
| Aviso de não-integração oficial com Sisfogo | PENDENTE | Sem captura de tela registrada |
| Histórico de ocorrências não é único fator | CONCLUÍDO | Verificado nos testes (multiple factors) |

---

## Proteção de Rotas

| Rota | Autenticação exigida | Status | Evidência |
|---|---|---|---|
| POST /api/import-batches | Sim (401 sem auth) | CONCLUÍDO | routes.ts linha 497 — verificado em código |
| GET /api/import-batches | Sim (401 sem auth) | CONCLUÍDO | routes.ts linha 560 — verificado em código |
| GET /api/fire-occurrences | Sim (401 sem auth) | CONCLUÍDO | routes.ts linha 573 — verificado em código |
| POST /analyze-risk (Python) | Não exigida nesta fase | NÃO SE APLICA | Serviço interno |

---

## Anonimização (VITE_SUBMISSION_MODE=true)

| Item | Status | Observação |
|---|---|---|
| Nenhum nome pessoal visível | PENDENTE | Sem captura de tela com modo ativo |
| Nenhum cargo visível | PENDENTE | Sem captura de tela com modo ativo |
| Nenhum e-mail visível | PENDENTE | Sem captura de tela com modo ativo |
| Nenhuma empresa visível | PENDENTE | Sem captura de tela com modo ativo |
| Nenhuma instituição visível | PENDENTE | Sem captura de tela com modo ativo |
| Nenhum CNPJ visível | PENDENTE | Sem captura de tela com modo ativo |
| Nenhum LinkedIn visível | PENDENTE | Sem captura de tela com modo ativo |
| Nome neutro "Plataforma Preditiva de Inteligência Ambiental" exibido | PENDENTE | Sem captura de tela registrada |
| PDFs gerados com modo anônimo ativo | PENDENTE | PDFs não gerados |

---

## Documentação TRL 4

| Arquivo | Status | Observação |
|---|---|---|
| 01_EVIDENCIAS_MATURIDADE_TRL4.md | CONCLUÍDO | Arquivo presente |
| 02_RELATORIO_TESTES_TRL4.md | CONCLUÍDO | Atualizado com resultados reais de 21/07/2026 |
| 03_ARQUITETURA_TECNICA_TRL4.md | CONCLUÍDO | Arquivo presente |
| 04_EVIDENCIAS_VISUAIS_TRL4.md | PENDENTE | Roteiro presente; capturas de tela não realizadas |
| 05_METRICAS_MODELO_TRL4.md | CONCLUÍDO | Atualizado com métricas reais e aviso obrigatório |
| 06_MATRIZ_RASTREABILIDADE_TRL4.md | CONCLUÍDO | Atualizado com evidências reais e "Pendente de evidência visual" |
| 07_FICHA_SISTEMA_IA.md | CONCLUÍDO | Arquivo presente |
| 08_CHECKLIST_FINAL_SUBMISSAO.md | CONCLUÍDO | Este arquivo |
| 09_RELATORIO_IMPORTACAO_DADOS_HISTORICOS.md | CONCLUÍDO | Arquivo presente |
| README.md | PENDENTE | Verificar se está atualizado com versão atual |

---

## Itens Pendentes Antes da Submissão Final

| Item | Status |
|---|---|
| Realizar capturas de tela conforme roteiro (doc 04) | PENDENTE |
| Gerar PDFs com modo anônimo ativo | PENDENTE |
| Verificar que PDFs têm menos de 10 MB | PENDENTE |
| Confirmar ausência de qualquer identificação nos PDFs | PENDENTE |
| Executar npm run build com saída de terminal registrada | PENDENTE |
| Executar curl nos endpoints com saída real registrada | PENDENTE |
| Confirmar importação XLS funcionando com captura | PENDENTE |
| Confirmar importação XLSX funcionando com captura | PENDENTE |
| Confirmar mapa renderizando com captura | PENDENTE |
| Confirmar alertas funcionando com captura | PENDENTE |
| Confirmar relatórios acessíveis com captura | PENDENTE |
| Confirmar tutorial funcionando com captura | PENDENTE |
| Confirmar modo anônimo ativo com captura | PENDENTE |

---

## Itens que NÃO foram incluídos (declaração de ausência)

| Item | Motivo |
|---|---|
| Integração oficial com Sisfogo | Inexistente — apenas importação de arquivos |
| Modelo validado com dados reais | Previsto para a Prova de Valor |
| SMS/e-mail de alertas | Fora do escopo desta fase |
| Sensores IoT reais | Demonstrativos nesta fase |
| Testes de carga | Fora do escopo TRL 4 |
