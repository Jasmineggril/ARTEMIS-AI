# 02 — Relatório de Testes — TRL 4

> Documento anonimizado. Data de execução: Julho/2026.

---

## 1. Objetivo

Registrar todos os testes executados durante a fase TRL 4, com resultado obtido, ambiente e limitações.

---

## 2. Ambiente de Testes

| Componente | Versão |
|---|---|
| Node.js | 20.x |
| TypeScript | 5.6.3 |
| Python | 3.12 |
| FastAPI | 0.115.x |
| Scikit-learn | 1.x |
| PostgreSQL | 16 |
| Vite | 7.x |
| Sistema Operacional | NixOS (Replit) |

---

## 3. Dados Utilizados

- **Dataset do modelo ML:** Sintético — 2.000 amostras geradas pelo motor de regras
- **Dados climáticos:** Demonstrativos (Open-Meteo API para dados reais futuros)
- **Ocorrências históricas:** Sintéticas — arquivo CSV demonstrativo (20 registros)
- **Áreas monitoradas:** Demonstrativas — seed do banco

---

## 4. Cenários de Risco Testados

| ID | Cenário | Entrada | Esperado | Score | Nível | Status |
|---|---|---|---|---|---|---|
| TC-01 | Baixo risco | T:22°C, U:78%, V:7km/h, P:32mm, veg:úmida | baixo | 0–24 | baixo | ✅ Aprovado |
| TC-02 | Moderado | T:30°C, U:48%, V:16km/h, P:8mm, veg:regular | moderado | 25–49 | moderado | ✅ Aprovado |
| TC-03 | Alto risco | T:35°C, U:28%, V:26km/h, P:0mm, veg:seca | alto | 50–74 | alto | ✅ Aprovado |
| TC-04 | Crítico | T:40°C, U:15%, V:42km/h, P:0mm, veg:muito seca, foco a 1,5km | crítico | 75–100 | crítico | ✅ Aprovado |

---

## 5. Testes Automatizados TypeScript

Comando: `npm run test:risk`

| Grupo | Testes | Aprovados | Reprovados |
|---|---|---|---|
| Cenário baixo risco | 3 | 3 | 0 |
| Cenário moderado | 3 | 3 | 0 |
| Cenário alto risco | 3 | 3 | 0 |
| Cenário crítico | 4 | 4 | 0 |
| Estabilidade e determinismo | 7 | 7 | 0 |
| Validação de entradas | 7 | 7 | 0 |
| Classificação de nível | 8 | 8 | 0 |
| **Total de Risco** | **34** | **34** | **0** |

---

## 6. Testes Automatizados Python

Comando: `python -m pytest python_service/tests -v`  
**Data:** 2026-07-21 17:30 UTC  
**Duração:** 6.87 segundos

| Arquivo | Testes | Aprovados | Reprovados |
|---|---|---|---|
| test_api.py | 20 | 20 | 0 |
| test_model.py | 27 | 27 | 0 |
| test_risk_model.py | 34 | 34 | 0 |
| test_validation.py | 23 | 23 | 0 |
| **Total** | **104** | **104** | **0** |

**Warnings:** 18.492 avisos de depreciação NumPy (sem impacto funcional)  
**Status:** ✅ Todos os testes aprovados

---

## 6.1. Testes Automatizados TypeScript — Autenticação

Comando: `npm run test:auth`

| Grupo | Testes | Aprovados | Reprovados |
|---|---|---|---|
| hashPassword | 3 | 3 | 0 |
| verifyPassword — bcrypt | 3 | 3 | 0 |
| verifyPassword — SHA-256 legado | 4 | 4 | 0 |
| **Total Autenticação** | **10** | **10** | **0** |

---

## 6.2. Resumo Total de Testes TypeScript

| Tipo | Total | Aprovados | Reprovados |
|---|---|---|---|
| Testes de Risco | 34 | 34 | 0 |
| Testes de Autenticação | 10 | 10 | 0 |
| **Total TypeScript** | **44** | **44** | **0** |

---

## 7. Verificação TypeScript

Comando: `npm run check`

**Data:** 2026-07-21 17:20 UTC  
**Resultado:** 0 erros de compilação ✓

---

## 8. Build de Produção

Comando: `npm run build`

**Resultado:** Build gerado com sucesso. Artefatos em `dist/`.

---

## 9. Testes de Endpoint

### 9.1. Endpoint de Saúde (Health Check)

| Endpoint | Método | Status | Resposta |
|---|---|---|---|
| GET /health | GET | 200 OK | `{"status":"ok","service":"risk-analysis-python"}` |

**Data:** 2026-07-21 17:40 UTC  
**Serviço:** Python/FastAPI na porta 8000

### 9.2. Análise de Risco (POST /analyze-risk)

#### Teste 1: Cenário Moderado
- Input: T=30°C, U=48%, V=16km/h, P=8mm, vegetação=moderada
- **Status:** 200 OK ✓
- **Score:** 39 (esperado: 25-49) ✓
- **Nível:** moderado ✓
- **Confiança:** 93.57%
- **Fatores identificados:** 4 (Temperatura, Umidade, Vento, Vegetação)
- **Recomendações:** 4 (1 urgente, 2 preventivas, 1 monitoramento)

#### Teste 2: Cenário Baixo Risco
- Input: T=22°C, U=78%, V=7km/h, P=32mm, vegetação=úmida
- **Status:** 200 OK ✓
- **Score:** 17 (esperado: 0-24) ✓
- **Nível:** baixo ✓
- **Confiança:** 82.57%

#### Teste 3: Cenário Alto Risco
- Input: T=35°C, U=28%, V=26km/h, P=0mm, vegetação=seca
- **Status:** 200 OK ✓
- **Score:** 62 (esperado: 50-74) ✓
- **Nível:** alto ✓
- **Confiança:** 98%
- **Fatores identificados:** 4

#### Teste 4: Cenário Crítico
- Input: T=40°C, U=15%, V=42km/h, P=0mm, vegetação=muito seca, foco próximo a 1,5km
- **Status:** 200 OK ✓
- **Score:** 82 (esperado: 75-100) ✓
- **Nível:** crítico ✓
- **Confiança:** 80.78%
- **Fatores identificados:** 4
- **Recomendações:** 4

### 9.3. Rotas Protegidas (Autenticação)

| Endpoint | Método | Sem Autenticação | Com Autenticação | Observação |
|---|---|---|---|---|
| GET /api/import-batches | GET | **401** ✓ | 200 | Autenticação obrigatória |
| GET /api/fire-occurrences | GET | **401** ✓ | 200 | Autenticação obrigatória |

**Resposta sem autenticação:** `{"message":"Not authenticated"}`  
**Conclusão:** Controle de acesso funciona corretamente

---

## 10. Importação de Dados Históricos

Teste de suporte a múltiplos formatos de arquivo para importação de ocorrências.

### 10.1. Resultado de Importação

| Formato | Total | Válidos | Ressalvas | Inválidos | Tamanho | Status |
|---|---|---|---|---|---|---|
| CSV | 20 | 20 | 0 | 0 | 0.003 MB | ✓ Aprovado |
| XLSX | 20 | 20 | 0 | 0 | 0.007 MB | ✓ Aprovado |
| XLS | 20 | 20 | 0 | 0 | 0.013 MB | ✓ Aprovado |

**Data de teste:** 2026-07-21 17:50 UTC

### 10.2. Validação de Dados

Arquivos testados contêm ocorrências de incêndios florestais com:
- **Período:** 2024-07-15 até 2025-03-05 (226 dias)
- **Localização:** Estados DF e GO, municípios da região Centro-Oeste
- **Coordenadas:** Todas válidas (latitudes -16° a -15°, longitudes -49° a -47°)
- **Dados de risco:** Área afetada de 2.0 ha a 25.0 ha
- **Causas documentadas:** Ação humana, Raio, Queima irregular, Queima para limpeza, Causa desconhecida
- **Status:** Controlado, Extinto
- **Fontes:** Corpo de Bombeiros, IBAMA, INPE, Defesa Civil, SEMARH

**Conclusão:** Importação e tratamento de dados provenientes de arquivos do Sisfogo ou de outras fontes autorizadas funcionam corretamente para os três formatos suportados.

---

## 11. Métricas do Modelo Supervisionado

## 11. Métricas do Modelo Supervisionado

> **AVISO CRÍTICO:** Métricas obtidas com dataset sintético em ambiente controlado.
> Não representam desempenho operacional definitivo.

### 11.1. Ambiente de Execução

| Componente | Valor |
|---|---|
| Python | 3.12.1 |
| Pytest | 9.1.1 |
| Scikit-learn | 1.9.0 |
| FastAPI | 0.115.x |
| Data de teste | 2026-07-21 17:30 UTC |
| Duração total | 6.87 segundos |

### 11.2. Resultado dos Testes Python

| Arquivo | Testes | Aprovados | Reprovados |
|---|---|---|---|
| test_api.py | 20 | 20 | 0 |
| test_model.py | 27 | 27 | 0 |
| test_risk_model.py | 34 | 34 | 0 |
| test_validation.py | 23 | 23 | 0 |
| **Total** | **104** | **104** | **0** |

### 11.3. Warnings Identificados

**Categoria:** Depreciação do NumPy  
**Quantidade:** 18.492 avisos  
**Origem:** `joblib/numpy_pickle.py` — DeprecationWarning sobre reshape de arrays  
**Impacto:** Nenhum — todos os testes foram aprovados  
**Conclusão:** Os testes foram concluídos sem falhas. Foram emitidos avisos de depreciação relacionados a dependências do ambiente, sem impacto identificado no resultado funcional dos testes. Os avisos serão tratados em atualização técnica posterior.

### 11.4. Propriedades do Modelo

| Propriedade | Valor |
|---|---|
| Algoritmo | RandomForestClassifier (Scikit-learn) |
| Dataset de treino | Sintético (2.000 amostras) |
| Distribuição | 500 amostras por classe |
| Divisão treino/teste | 80%/20% (1.600/400) |
| Classes | Baixo, Moderado, Alto, Crítico |
| Model Type | supervised-ml |
| Model Version | 1.0.0-sklearn-rf |
| Dataset Type | synthetic |

### 11.5. Limitação Crítica do Modelo

**O modelo foi treinado e avaliado com dados sintéticos cujos rótulos foram derivados do motor transparente baseado em regras. O resultado de 100% de acurácia demonstra que o pipeline supervisionado reproduziu integralmente os padrões utilizados na geração dos rótulos sintéticos, mas não comprova capacidade preditiva em incêndios reais. A calibração e a validação com dados reais estão previstas para a Prova de Valor.**

---

## 12. Falhas Encontradas

**Resultado:** Nenhuma falha detectada durante a execução.

Todos os 148 testes automatizados foram aprovados sem erros ou exceções:
- 44 testes TypeScript (34 risco + 10 autenticação)
- 104 testes Python (API, modelo, validação, risco)

---

## 13. Pendências para Próximas Fases

1. **Validação operacional com dados reais** — prevista na Prova de Valor
2. **Retreinamento do modelo** — com dataset representativo de incêndios reais
3. **Testes de carga** — não executados nesta fase TRL 4
4. **Testes em dispositivos móveis** — apenas validação visual parcial realizada

---

## 14. Limitações Documentadas

1. **Dataset sintético** — não representa distribuição real de ocorrências
2. **Ambiente de desenvolvimento** — testes executados em Replit (dev), não em servidor de produção
3. **Carga máxima não testada** — testes limitados a cargas normais
4. **Modelo de ML** — treinado exclusivamente com dados sintéticos
5. **Integração com Sisfogo** — não realizada; importação via upload de arquivo

---

## 15. Conclusão Executiva

**Status:** ✅ **APROVADO PARA TRL 4**

### Resumo de Testes Aprovados

**148 testes executados com sucesso (100% aprovação):**
- ✅ **44 testes TypeScript** (34 risco + 10 autenticação) — 0 falhas
- ✅ **104 testes Python** (API, modelo, validação, risco) — 0 falhas
- ✅ **4 cenários de risco** validados manualmente (baixo, moderado, alto, crítico) — todos aprovados
- ✅ **3 formatos de importação** testados (CSV, XLSX, XLS) — 60 registros válidos importados
- ✅ **Endpoints de autenticação** validados (401 sem sessão, 200 com sessão)
- ✅ **Build de produção** completado sem erros

### Análise Crítica

O sistema demonstra comportamento correto conforme esperado para uma Demonstração de Conceito em TRL 4. As limitações são documentadas explicitamente:
- Modelo treinado com dados sintéticos (não comprova desempenho em incêndios reais)
- Validação operacional real prevista para Prova de Valor
- Ambiente de teste é de desenvolvimento, não produção

### Recomendações

1. Realizar Prova de Valor com dados reais de incêndios
2. Retreinar modelo com histórico real de ocorrências
3. Implementar testes de carga e stress
4. Validar em ambiente de produção escalado

---

**Documento gerado:** 2026-07-21 18:00 UTC  
**Status do TRL 4:** ✅ Evidências completas e verificadas
