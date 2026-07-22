# Relatório de Testes — Motor de Risco v1.0.0

**Data:** 17 de Julho de 2026  
**Arquivo de testes:** `tests/risk-engine.test.ts`  
**Comando:** `npm run test:risk`  
**Evidência de execução:** testes executados e aprovados em 17/07/2026 via `node --import tsx/esm tests/risk-engine.test.ts`

---

## Resumo

| Métrica | Resultado |
|---|---|
| Total de testes | 34 |
| Aprovados | 34 |
| Reprovados | 0 |
| Cobertura de cenários | 4/4 (Baixo, Moderado, Alto, Crítico) |
| Tempo de execução | < 1s |

---

## Grupos de Testes

### Cenário 1 — Baixo Risco
| Teste | Status |
|---|---|
| Score deve estar entre 0 e 24 | ✅ PASS |
| Nível deve ser 'baixo' | ✅ PASS |
| Deve ter recomendações de monitoramento | ✅ PASS |

**Inputs (Cenário Baixo):**
- Temperatura: 24°C
- Umidade: 78%
- Vento: 8 km/h
- Precipitação 72h: 25 mm
- Vegetação: Úmida
- Foco próximo: Não
- Histórico: 0 ocorrências
- Qualidade dos dados: Boa

---

### Cenário 2 — Moderado
| Teste | Status |
|---|---|
| Score deve estar entre 25 e 49 | ✅ PASS |
| Nível deve ser 'moderado' | ✅ PASS |
| Deve ter fator de temperatura ou umidade | ✅ PASS |

**Inputs (Cenário Moderado):**
- Temperatura: 33°C
- Umidade: 45%
- Vento: 18 km/h
- Precipitação 72h: 5 mm
- Vegetação: Moderada
- Foco próximo: Não
- Histórico: 2 ocorrências
- Qualidade dos dados: Boa

---

### Cenário 3 — Alto Risco
| Teste | Status |
|---|---|
| Score deve estar entre 50 e 74 | ✅ PASS |
| Nível deve ser 'alto' | ✅ PASS |
| Deve ter recomendação urgente | ✅ PASS |

**Inputs (Cenário Alto):**
- Temperatura: 38°C
- Umidade: 28%
- Vento: 28 km/h
- Precipitação 72h: 0 mm
- Vegetação: Seca
- Foco próximo: Sim (20 km)
- Histórico: 3 ocorrências
- Qualidade dos dados: Boa

---

### Cenário 4 — Risco Crítico
| Teste | Status |
|---|---|
| Score deve estar entre 75 e 100 | ✅ PASS |
| Nível deve ser 'crítico' | ✅ PASS |
| Deve ter recomendação imediata | ✅ PASS |
| Deve ter múltiplos fatores identificados (≥3) | ✅ PASS |

**Inputs (Cenário Crítico):**
- Temperatura: 42°C
- Umidade: 15%
- Vento: 45 km/h
- Precipitação 72h: 0 mm
- Vegetação: Muito seca
- Foco próximo: Sim (4 km)
- Histórico: 6 ocorrências
- Qualidade dos dados: Boa

---

### Estabilidade e Determinismo
| Teste | Status |
|---|---|
| Motor é determinístico (mesma entrada = mesmo score) | ✅ PASS |
| Score mínimo nunca é negativo | ✅ PASS |
| Score máximo nunca excede 100 | ✅ PASS |
| calculationVersion está presente no resultado | ✅ PASS |
| calculatedAt é um ISO 8601 válido | ✅ PASS |
| isSimulated é preservado corretamente | ✅ PASS |

---

### Validação de Entradas
| Teste | Status |
|---|---|
| Lança erro se temperatura estiver ausente | ✅ PASS |
| Lança erro se umidade for maior que 100 | ✅ PASS |
| Lança erro se umidade for negativa | ✅ PASS |
| Lança erro se vento for negativo | ✅ PASS |
| Lança erro se vegetationCondition for inválido | ✅ PASS |
| validateRiskInput: retorna erros para entrada vazia | ✅ PASS |
| validateRiskInput: retorna válido para cenário correto | ✅ PASS |

---

### Classificação de Nível (scoreToLevel)
| Teste | Status |
|---|---|
| scoreToLevel(0) = 'baixo' | ✅ PASS |
| scoreToLevel(24) = 'baixo' | ✅ PASS |
| scoreToLevel(25) = 'moderado' | ✅ PASS |
| scoreToLevel(49) = 'moderado' | ✅ PASS |
| scoreToLevel(50) = 'alto' | ✅ PASS |
| scoreToLevel(74) = 'alto' | ✅ PASS |
| scoreToLevel(75) = 'crítico' | ✅ PASS |
| scoreToLevel(100) = 'crítico' | ✅ PASS |

---

## Motor — Tabela de Pontuação

| Fator | Condição | Pontos |
|---|---|---|
| Temperatura | ≥ 40°C | +20 |
| Temperatura | 35–39°C | +15 |
| Temperatura | 30–34°C | +8 |
| Temperatura | 25–29°C | +3 |
| Umidade | < 20% | +20 |
| Umidade | 20–29% | +15 |
| Umidade | 30–49% | +8 |
| Umidade | 50–64% | +3 |
| Vento | > 40 km/h | +15 |
| Vento | 26–40 km/h | +10 |
| Vento | 16–25 km/h | +5 |
| Precipitação | > 30 mm | −15 |
| Precipitação | 11–30 mm | −8 |
| Precipitação | 3–10 mm | −3 |
| Vegetação | Muito seca | +15 |
| Vegetação | Seca | +10 |
| Vegetação | Moderada | +4 |
| Vegetação | Úmida | 0 |
| Foco próximo | ≤ 5 km | +20 |
| Foco próximo | 6–15 km | +12 |
| Foco próximo | 16–30 km | +6 |
| Histórico | ≥ 5 ocorrências | +10 |
| Histórico | 2–4 ocorrências | +5 |
| Histórico | 1 ocorrência | +2 |

**Score final = clamp(soma dos fatores, 0, 100)**
