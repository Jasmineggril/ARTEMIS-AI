# 05 — Métricas do Modelo Supervisionado — TRL 4

> **AVISO OBRIGATÓRIO:** O modelo foi treinado e avaliado com dados sintéticos cujos rótulos foram derivados do motor transparente baseado em regras. O resultado de 100% demonstra que o pipeline supervisionado conseguiu reproduzir os rótulos sintéticos, mas **não comprova desempenho preditivo em incêndios reais**. A validação com dados reais está prevista para a Prova de Valor.

---

## 1. Identificação do Modelo

| Campo | Valor |
|---|---|
| Algoritmo | RandomForestClassifier (Scikit-learn 1.9.0) |
| Versão do modelo | 1.0.0-sklearn-rf |
| Arquivo | python_service/models/risk_classifier.joblib |
| Data de treinamento | 21 de julho de 2026 |
| Dataset | Sintético — gerado pelo motor de regras |
| Python | 3.13.11 |

---

## 2. Dataset

| Campo | Valor |
|---|---|
| Origem | Sintético — gerado pelo motor de regras transparente |
| Total de amostras | 2.000 |
| Divisão treino/teste | 80% / 20% (1.600 / 400) |
| Classes | baixo, moderado, alto, crítico |
| Amostras por classe (dataset completo) | 500 por classe |
| Amostras por classe (conjunto de teste) | 100 por classe |
| Features | 9 variáveis ambientais e históricas |
| Balanceamento | Amostragem estratificada — distribuição igual entre as quatro classes |
| Limitação | Dataset não representa distribuição real de incêndios |

### Distribuição das Classes

| Classe | Total | Treino | Teste |
|---|---|---|---|
| baixo | 500 | 400 | 100 |
| moderado | 500 | 400 | 100 |
| alto | 500 | 400 | 100 |
| crítico | 500 | 400 | 100 |
| **Total** | **2.000** | **1.600** | **400** |

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

> **Dataset: SINTÉTICO | Não representa validação operacional real**

Métricas obtidas na execução real de 21/07/2026 com scikit-learn 1.9.0:

```
          precision    recall  f1-score   support

   baixo       1.00      1.00      1.00       100
moderado       1.00      1.00      1.00       100
    alto       1.00      1.00      1.00       100
 critico       1.00      1.00      1.00       100

accuracy                           1.00       400
macro avg       1.00      1.00      1.00       400
weighted avg    1.00      1.00      1.00       400
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

### Por classe

| Classe | Precision | Recall | F1-score | Support (teste) |
|---|---|---|---|---|
| baixo | 1.00 | 1.00 | 1.00 | 100 |
| moderado | 1.00 | 1.00 | 1.00 | 100 |
| alto | 1.00 | 1.00 | 1.00 | 100 |
| crítico | 1.00 | 1.00 | 1.00 | 100 |

### Matriz de confusão

|  | baixo | moderado | alto | crítico |
|---|---|---|---|---|
| **baixo** | 100 | 0 | 0 | 0 |
| **moderado** | 0 | 100 | 0 | 0 |
| **alto** | 0 | 0 | 100 | 0 |
| **crítico** | 0 | 0 | 0 | 100 |

### Por que o resultado é 100%?

O resultado de 100% é esperado e tem uma explicação técnica clara: os rótulos do dataset foram gerados pelo **mesmo motor de regras** usado pelo sistema. O modelo supervisionado (RandomForest) aprendeu a replicar exatamente o comportamento do motor de regras e, como o dataset de teste foi gerado pelo mesmo processo, a correspondência é perfeita.

**Isso não significa que o modelo classifica incêndios reais com 100% de acurácia.** Representa apenas que o pipeline de aprendizado supervisionado é capaz de reproduzir os rótulos sintéticos — o que era o objetivo desta fase (TRL 4: demonstração de viabilidade técnica em ambiente controlado).

Este é um **viés circular**: rótulos gerados pela regra → modelo aprende a regra → avaliado sobre dados rotulados pela mesma regra → 100%. A validação com dados reais quebrará esse viés e fornecerá métricas representativas.

---

## 4. Parâmetros do Treinamento

| Parâmetro | Valor |
|---|---|
| Algoritmo | RandomForestClassifier |
| n_estimators | 100 |
| max_depth | 10 |
| class_weight | balanced |
| random_state | 42 |
| test_size | 0.2 |
| stratify | Sim (por classe) |

---

## 5. Limitações Declaradas

1. **Dataset inteiramente sintético** — gerado pelo motor de regras, não por ocorrências reais de incêndio
2. **Viés circular nos rótulos** — as métricas refletem a capacidade do modelo de replicar o motor de regras, e não de classificar incêndios reais; 100% é esperado neste contexto e não deve ser interpretado como desempenho operacional
3. **Sem validação independente** — o conjunto de teste foi gerado pelo mesmo processo do conjunto de treino
4. **Sem dados geoespaciais reais ou séries temporais** — features são variáveis ambientais pontuais
5. **Não declare este modelo como IA validada ou operacional** — resultado de 100% demonstra apenas a viabilidade técnica do pipeline

---

## 6. Plano de Evolução (Prova de Valor)

- Coleta de dados reais de incêndios (Sisfogo, INPE, Defesa Civil)
- Limpeza e validação dos dados históricos
- Retreinamento com dataset representativo (mínimo 500 ocorrências reais)
- Validação cruzada (k-fold)
- Avaliação por especialistas em prevenção de incêndios
- Meta prevista: F1 macro ≥ 80% com dados reais

---

## 7. Reprodução dos Resultados

```bash
# Usando o venv do projeto com scikit-learn 1.9.0
source .venv/bin/activate
python python_service/train_model.py    # treina e salva o modelo
python python_service/evaluate_model.py # avalia e exibe métricas
python -m pytest python_service/tests -v
```

Resultados salvos em:
- `python_service/results/metrics.json`
- `python_service/results/confusion_matrix.png`
