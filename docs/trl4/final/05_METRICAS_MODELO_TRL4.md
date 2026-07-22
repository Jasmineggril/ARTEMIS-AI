# 05 — Métricas do Modelo Supervisionado — TRL 4

> **AVISO OBRIGATÓRIO:** As métricas apresentadas neste documento foram obtidas com dataset sintético em ambiente controlado e **não representam desempenho operacional definitivo**. A validação com dados reais está prevista para a Prova de Valor.

---

## 1. Identificação do Modelo

| Campo | Valor |
|---|---|
| Algoritmo | RandomForestClassifier (Scikit-learn) |
| Versão do modelo | 1.0.0-sklearn-rf |
| Arquivo | python_service/models/risk_classifier.joblib |
| Data de treinamento | Julho/2026 |
| Dataset | Sintético — gerado pelo motor de regras |

---

## 2. Dataset

| Campo | Valor |
|---|---|
| Origem | Sintético — gerado pelo motor de regras transparente |
| Total de amostras | 2.000 |
| Divisão treino/teste | 80% / 20% (1.600 / 400) |
| Classes | baixo, moderado, alto, crítico |
| Features | 9 variáveis ambientais e históricas |
| Limitação | Dataset não representa distribuição real de incêndios |

### Features utilizadas

1. temperature (temperatura em °C)
2. humidity (umidade relativa em %)
3. wind_speed (velocidade do vento em km/h)
4. recent_rainfall (precipitação recente em mm)
5. vegetation_condition (condição da vegetação: 0–3)
6. nearby_hotspot (foco próximo: 0 ou 1)
7. hotspot_distance (distância do foco em km)
8. historical_occurrences (histórico de ocorrências)
9. data_quality (qualidade dos dados: 0–3)

---

## 3. Métricas Obtidas

> Dataset: SINTÉTICO | Não representa validação operacional real

| Métrica | Valor |
|---|---|
| Accuracy | 84.25% |
| Precision (macro) | 85.40% |
| Recall (macro) | 90.74% |
| F1-score (macro) | 87.29% |
| Precision (weighted) | 85.57% |
| Recall (weighted) | 84.25% |
| F1-score (weighted) | 84.37% |

### Por classe

| Classe | Precision | Recall | F1-score | Support |
|---|---|---|---|---|
| baixo | 85% | 89% | 87% | 145 |
| moderado | 90% | 78% | 84% | 207 |
| alto | 66% | 96% | 78% | 47 |
| crítico | 100% | 100% | 100% | 1 |

### Matriz de confusão

|  | baixo | moderado | alto | crítico |
|---|---|---|---|---|
| **baixo** | 129 | 16 | 0 | 0 |
| **moderado** | 22 | 162 | 23 | 0 |
| **alto** | 0 | 2 | 45 | 0 |
| **crítico** | 0 | 0 | 0 | 1 |

---

## 4. Parâmetros do Treinamento

| Parâmetro | Valor |
|---|---|
| n_estimators | 100 |
| random_state | 42 |
| test_size | 0.2 |
| stratify | Sim (por classe) |

---

## 5. Limitações Declaradas

1. Dataset inteiramente sintético — gerado pelo motor de regras, não por ocorrências reais
2. As métricas refletem apenas a capacidade do modelo de replicar o motor de regras, não de classificar incêndios reais
3. A classe "crítico" tem suporte muito baixo (1 amostra no teste) — métricas para essa classe não são representativas
4. Overfitting possível: o modelo aprendeu o motor de regras, não padrões reais
5. Sem validação cruzada rigorosa nesta fase

---

## 7. Validação de Testes Automatizados

**Execução:** 2026-07-21 17:30 UTC  
**Resultado:** 104 testes Python aprovados sem falhas

| Componente Testado | Testes | Aprovados | Status |
|---|---|---|---|
| API HTTP | 20 | 20 | ✅ |
| Modelo ML | 27 | 27 | ✅ |
| Modelo de Risco | 34 | 34 | ✅ |
| Validação | 23 | 23 | ✅ |
| **Total** | **104** | **104** | **✅ Aprovado** |

**Conclusão:** O modelo passa em todos os testes automatizados, confirmando que o comportamento esperado é atingido nos quatro cenários de risco e que a validação de entrada funciona corretamente.

---

## 8. Plano de Evolução (Prova de Valor)

- Coleta de dados reais de incêndios (Sisfogo, INPE, Defesa Civil)
- Limpeza e validação dos dados históricos
- Retreinamento com dataset representativo (mínimo 500 ocorrências reais)
- Validação cruzada (k-fold)
- Avaliação por especialistas em prevenção de incêndios
- Meta prevista: F1 macro ≥ 80% com dados reais

---

## 9. Reprodução dos Resultados

```bash
# Treinar modelo
cd python_service
python train_model.py     # treina e salva o modelo

# Avaliar modelo
python evaluate_model.py  # avalia e exibe métricas

# Executar testes
python -m pytest tests/ -v  # 104 testes
```

Resultados salvos em:
- `python_service/results/metrics.json`
- `python_service/results/confusion_matrix.png`

---

## 10. Nota Final

**O modelo foi treinado e avaliado com dados sintéticos cujos rótulos foram derivados do motor transparente baseado em regras. O resultado demonstra que o pipeline supervisionado reproduziu integralmente os padrões utilizados na geração dos rótulos sintéticos, mas não comprova capacidade preditiva em incêndios reais. A calibração e a validação com dados reais estão previstas para a Prova de Valor.**
