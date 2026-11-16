# Dados — ARTEMIS AI Risk Analysis Service

## Dataset de Treinamento

**Tipo:** Sintético — gerado programaticamente a partir do motor de regras documentado.

**Origem:** O motor de regras transparente (`risk_model.py → calculate_rule_score`) foi usado como função geradora de rótulos. Os dados de entrada foram amostrados aleatoriamente dentro de faixas plausíveis para o domínio de risco de incêndio no Brasil.

**Registros:** 2000 amostras (versão atual)

**Features:**

| Feature | Tipo | Faixa |
|---|---|---|
| temperature | float | 15–45 °C |
| humidity | float | 10–95 % |
| wind_speed | float | 0–60 km/h |
| recent_rainfall | float | 0–50 mm |
| vegetation_condition | categórico | very_dry / dry / moderate / humid |
| nearby_hotspot | bool | True / False |
| hotspot_distance | float | 1–50 km (quando hotspot=True) |
| historical_occurrences | int | 0–8 ocorrências |
| data_quality | categórico | poor / regular / good / excellent |

**Classes (labels):**

| Classe | Label | Faixa de score |
|---|---|---|
| 0 | baixo | 0–24 |
| 1 | moderado | 25–49 |
| 2 | alto | 50–74 |
| 3 | crítico | 75–100 |

## Limitações

- Dataset sintético: não representa condições operacionais reais
- Rótulos gerados pelo próprio motor de regras (risco de viés circular)
- Distribuição de classes pode ser desequilibrada dependendo da amostragem
- Não inclui dados geoespaciais reais nem séries temporais de INPE/INMET

## Plano para Prova de Valor

Durante a Prova de Valor (60 dias), este dataset sintético será substituído por dados:

1. **Históricos reais** de focos de incêndio (INPE/BDQueimadas)
2. **Dados climáticos reais** via Open-Meteo / INMET
3. **Validação por especialistas** em campo

O modelo será calibrado e avaliado com o dataset real antes de qualquer declaração de precisão operacional.

---

> **AVISO:** As métricas obtidas com este dataset sintético demonstram apenas viabilidade técnica do pipeline de Machine Learning em ambiente controlado. Elas NÃO representam desempenho operacional real e serão substituídas por métricas validadas durante a Prova de Valor.
