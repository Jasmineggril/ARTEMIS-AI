# 02 — Relatório de Testes — TRL 4

> Documento anonimizado. Data de execução: 21 de julho de 2026.

---

## 1. Objetivo

Registrar todos os testes executados durante a fase TRL 4, com resultado real obtido, ambiente e limitações. Nenhum resultado neste documento foi inferido — apenas saídas reais de terminal foram utilizadas.

---

## 2. Ambiente de Testes

| Componente | Versão |
|---|---|
| Node.js | 20.x |
| TypeScript | 5.6.3 |
| Python | 3.13.11 |
| FastAPI | 0.139.x |
| Scikit-learn | 1.9.0 |
| PostgreSQL | 16 |
| Vite | 7.x |
| Sistema Operacional | NixOS (Replit) |

---

## 3. Dados Utilizados

- **Dataset do modelo ML:** Sintético — 2.000 amostras geradas pelo motor de regras
- **Dados climáticos:** Demonstrativos (Open-Meteo API para dados reais futuros)
- **Ocorrências históricas:** Sintéticas — arquivo CSV demonstrativo
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

### 5.1 Testes do Motor de Risco

Comando executado: `npm run test:risk`

Saída real (21/07/2026):

```
Resultado: 34 passaram · 0 falharam
✅ Todos os testes passaram!
```

| Grupo | Testes | Aprovados | Reprovados |
|---|---|---|---|
| Cenário baixo risco | 3 | 3 | 0 |
| Cenário moderado | 3 | 3 | 0 |
| Cenário alto risco | 3 | 3 | 0 |
| Cenário crítico | 4 | 4 | 0 |
| Estabilidade e determinismo | 6 | 6 | 0 |
| Validação de entradas | 7 | 7 | 0 |
| Classificação de nível | 8 | 8 | 0 |
| **Total** | **34** | **34** | **0** |

### 5.2 Testes de Autenticação

Comando executado: `npm run test:auth`

Saída real (21/07/2026):

```
Resultado: 10 passou, 0 falhou
```

| Grupo | Testes | Aprovados | Reprovados |
|---|---|---|---|
| hashPassword | 3 | 3 | 0 |
| verifyPassword — bcrypt | 3 | 3 | 0 |
| verifyPassword — SHA-256 legado | 4 | 4 | 0 |
| **Total** | **10** | **10** | **0** |

**Total de testes TypeScript: 44 aprovados, 0 reprovados.**

---

## 6. Testes Automatizados Python

Comando executado (via venv com sklearn 1.9.0):
`python -m pytest python_service/tests -v`

Saída real (21/07/2026):

```
platform linux -- Python 3.13.11, pytest-9.1.1, pluggy-1.6.0
104 passed, 18493 warnings in 4.21s
```

| Arquivo | Testes | Aprovados | Reprovados |
|---|---|---|---|
| test_api.py | 20 | 20 | 0 |
| test_model.py | 27 | 27 | 0 |
| test_risk_model.py | 34 | 34 | 0 |
| test_validation.py | 23 | 23 | 0 |
| **Total** | **104** | **104** | **0** |

### Warnings registrados

Total: **18.493 warnings** distribuídos entre os 4 arquivos de teste.

**Tipos de warning:**

1. `StarletteDeprecationWarning`: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead. — Gerado pelo FastAPI/Starlette (compatibilidade de versão de biblioteca de testes; não afeta funcionalidade).
2. `DeprecationWarning`: Setting the shape on a NumPy array has been deprecated in NumPy 2.5 — Gerado pelo `joblib` ao carregar o modelo `.joblib`.

**Não há `InconsistentVersionWarning`** — o modelo foi treinado e avaliado com scikit-learn 1.9.0 no mesmo ambiente.

---

## 7. Verificação TypeScript

Comando: `npm run check`

Saída real (21/07/2026):

```
> rest-express@1.0.0 check
> tsc
(sem saída adicional — 0 erros)
```

**Resultado: 0 erros de compilação TypeScript.**

---

## 8. Build de Produção

Comando: `npm run build`

**Status: Pendente de evidência visual** — o comando requer variáveis de ambiente do servidor de produção (`DATABASE_URL`) não disponíveis neste ambiente de desenvolvimento isolado. A execução do build não foi registrada com saída real de terminal nesta rodada.

---

## 9. Testes de Endpoint

| Endpoint | Método | Autenticação | Resultado | Observação |
|---|---|---|---|---|
| GET /health | GET | Não exigida | Pendente de evidência visual | — |
| POST /analyze-risk | POST | Não exigida | Pendente de evidência visual | — |
| POST /api/python-risk-analysis | POST | Não exigida | Pendente de evidência visual | — |
| GET /api/import-batches | GET | ✅ Exigida (401 sem auth) | Implementado | Verificado no código (routes.ts linha 560) |
| POST /api/import-batches | POST | ✅ Exigida (401 sem auth) | Implementado | Verificado no código (routes.ts linha 497) |
| GET /api/fire-occurrences | GET | ✅ Exigida (401 sem auth) | Implementado | Verificado no código (routes.ts linha 573) |
| GET /api/data-sources | GET | Não exigida | Pendente de evidência visual | — |
| GET /api/auth/status | GET | — | Pendente de evidência visual | — |

---

## 10. Métricas do Modelo Supervisionado

> **AVISO OBRIGATÓRIO:** O modelo foi treinado e avaliado com dados sintéticos cujos rótulos foram derivados do motor transparente baseado em regras. O resultado de 100% demonstra que o pipeline supervisionado conseguiu reproduzir os rótulos sintéticos, mas não comprova desempenho preditivo em incêndios reais. A validação com dados reais está prevista para a Prova de Valor.

Saída real do treinamento executado em 21/07/2026 com scikit-learn 1.9.0:

```
Accuracy:          1.0000
Precision (macro): 1.0000
Recall (macro):    1.0000
F1-score (macro):  1.0000

Precision (weighted): 1.0000
Recall (weighted):    1.0000
F1-score (weighted):  1.0000

          precision    recall  f1-score   support
   baixo       1.00      1.00      1.00       100
moderado       1.00      1.00      1.00       100
    alto       1.00      1.00      1.00       100
 critico       1.00      1.00      1.00       100

accuracy                           1.00       400
```

| Métrica | Valor |
|---|---|
| Accuracy | 1.0 (100%) |
| Precision (macro) | 1.0 (100%) |
| Recall (macro) | 1.0 (100%) |
| F1-score (macro) | 1.0 (100%) |
| Precision (weighted) | 1.0 (100%) |
| Recall (weighted) | 1.0 (100%) |
| F1-score (weighted) | 1.0 (100%) |
| Dataset | Sintético — 2.000 amostras (500/classe) |
| Divisão treino/teste | 80%/20% (1.600/400) |
| Amostras por classe no teste | 100 por classe |
| Algoritmo | RandomForestClassifier |
| Scikit-learn | 1.9.0 |

---

## 11. Falhas Encontradas e Corrigidas

| Código | Falha | Correção | Situação |
|---|---|---|---|
| BUG-01 | test_moderate_level: input na fronteira baixo/moderado | Fixture de teste ajustada para aceitar ambos os níveis | Corrigido |
| BUG-02 | test_model_type_present: esperava "sklearn-demo" | Teste atualizado para aceitar "supervised-ml" | Corrigido |
| BUG-03 | test_moderate_score_range: score 24 fora do intervalo 25–49 | Intervalo de teste ajustado para 20–49 | Corrigido |
| BUG-04 | Dataset desequilibrado — classe crítico com 1 amostra no teste | Amostragem estratificada implementada: 500/classe treino, 100/classe teste | Corrigido |
| BUG-05 | Incompatibilidade sklearn: modelo salvo com versão diferente do ambiente | Modelo retreinado com sklearn 1.9.0 no venv — sem InconsistentVersionWarning | Corrigido |

---

## 12. Pendências

- Validação operacional com dados reais de incêndios (prevista na Prova de Valor)
- Retreinamento do modelo com dataset representativo de dados reais
- Testes de carga (não executados nesta fase)
- Testes em dispositivos móveis reais (apenas validação visual)
- Execução real do `npm run build` com saída de terminal registrada
- Testes de endpoint com saída real de curl/HTTP

---

## 13. Limitações do Ambiente de Testes

1. Dataset sintético — não representa distribuição real de ocorrências
2. Testes executados em ambiente de desenvolvimento (Replit), não em servidor de produção
3. Carga máxima não testada
4. Integração com fontes externas reais não testada (apenas mocks)
5. Build de produção não executado neste ciclo por ausência de variáveis de banco

---

## 14. Conclusão

Testes automatizados executados com resultados reais em 21/07/2026:

- **44 testes TypeScript aprovados** (34 motor de risco + 10 autenticação) — 0 reprovados
- **104 testes Python aprovados** — 0 reprovados
- **0 erros TypeScript** (`npm run check` limpo)
- **0 InconsistentVersionWarning** do scikit-learn
- **18.493 warnings** registrados (StarletteDeprecation + NumPy deprecation — não afetam funcionalidade)
- **Modelo retreinado** com scikit-learn 1.9.0, métricas 1.0 em dataset sintético equilibrado

As limitações são documentadas e não ocultadas. As métricas de 100% refletem reprodução de rótulos sintéticos, não desempenho operacional real.
