# 17 — Metodologia de risco de incêndio (motor `1.1.0-rules`)

Documento de referência do cálculo exibido ao usuário. Fonte da verdade:
`python_service/risk_model.py` (motor principal) e `shared/risk-engine.ts`
(fallback em TypeScript usado só quando o motor Python está indisponível).

> **Status:** limiares definidos por critério técnico e literatura de manejo do fogo,
> **ainda não calibrados** com desfechos reais. A calibração é um critério de saída do
> piloto (ver `20_DOSSIE_TRL.md`). O resultado é apoio à decisão, não previsão.

## 1. Entradas e origem dos dados

| Entrada | Origem | Natureza registrada |
|---|---|---|
| Temperatura (°C), umidade (%), vento (km/h) | Open-Meteo no ponto da área (com repetição e último valor válido) ou informado pelo usuário | observado / estimado / informado |
| Chuva nas últimas 72 h (mm) | Open-Meteo ou usuário | observado / informado |
| Condição da vegetação | usuário (`very_dry`, `dry`, `moderate`, `green`) | informado |
| Foco próximo e distância | INPE Queimadas — focos mais recentes em relação à área | registro oficial / calculado |
| Ocorrências históricas | registros importados pela própria organização + ROIs oficiais do Sisfogo a até **10 km** (após sincronização completa; `RISK_USE_SISFOGO=false` desliga) | registro oficial / informado |

Cada análise grava a natureza de cada entrada e a decomposição do histórico
(próprios × Sisfogo), visíveis no relatório (seção de rastreabilidade).

## 2. Pontuação (soma de fatores, limitada a 0–100)

| Fator | Faixas → pontos |
|---|---|
| Temperatura | ≥ 40 → +20 · ≥ 35 → +15 · ≥ 30 → +8 · ≥ 25 → +3 |
| Umidade relativa | < 20 → +20 · < 30 → +15 · < 50 → +8 · < 65 → +3 |
| Vento | > 40 → +15 · > 25 → +10 · > 15 → +5 |
| Chuva 72 h (reduz) | > 30 → −15 · > 10 → −8 · > 2 → −3 |
| Vegetação | muito seca +15 · seca +10 · moderada +4 · verde 0 |
| Foco INPE próximo | ≤ 5 km +20 · ≤ 15 km +15 · ≤ 30 km +8 · ≤ 50 km +4 |
| Ocorrências históricas | ≥ 5 → +10 · ≥ 3 → +6 · ≥ 1 → +2 |

Máximo teórico antes do limite: 120 → limitado a 100.

## 3. Classificação

| Pontuação | Nível |
|---|---|
| 0–24 | baixo |
| 25–49 | moderado |
| 50–74 | alto |
| 75–100 | crítico |

Recomendações fixas por nível (`generate_recommendations`), exibidas com o resultado.
A "confiança" mostrada vem da qualidade declarada dos dados (excelente 0,95 · boa 0,85 ·
regular 0,70 · ruim 0,55; padrão 0,75) — **não** é uma probabilidade estatística.

## 4. Alertas por foco detectado (independentes da pontuação)

Um foco INPE dentro do polígono da propriedade ou a até `hotspot_alert_km`
(padrão 5 km, 0–50) do limite — ou do ponto, sem polígono — gera alerta
`foco_proximo`. Um alerta aberto por propriedade por dia; novas detecções atualizam a
evidência. O texto diz que foco é detecção térmica, não incêndio confirmado.

## 5. Limitações conhecidas

1. **Paridade entre motores (corrigida na 1.1.0, 18/11/2026):** a versão 1.0.0 do fallback
   TypeScript divergia do motor Python em 1 765 de 3 433 entradas testadas (51 %): foco a
   5–15 km (12 × 15 pontos), 15–30 km (6 × 8), 30–50 km (0 × 4), histórico de 2 ocorrências
   (5 × 2) e de 3–4 (5 × 6). O Python também usava faixas inteiras (≥ 26 km/h, ≥ 11 mm) que
   deixavam valores fracionários (ex.: 25,5 km/h) na faixa de baixo, e a explicação mostrava
   +4 para foco além de 50 km sem somar na pontuação. Agora os dois motores usam as faixas
   contínuas acima e o teste `tests/unit/engine-parity.test.ts` exige **diferença zero** de
   pontuação e nível e soma dos fatores igual à pontuação. Para entradas inteiras, o motor
   Python 1.1.0 dá o mesmo resultado da 1.0.0.
2. Vegetação é declarada pelo usuário; não há índice de satélite (NDVI) integrado.
3. Meteorologia é de modelo em grade (Open-Meteo), não de estação local.
4. Foco INPE tem atraso de horas e falsos positivos (ex.: superfícies quentes).
5. O modelo de aprendizado de máquina (`RISK_ENGINE_MODE=ml-experimental`) foi treinado
   com **dados sintéticos**, fica desligado por padrão e marca resultados como experimentais.

## 6. Como a metodologia será validada

`server/services/outcome-validation.ts` compara, para cada análise com janela encerrada,
o nível atribuído com focos INPE e ROIs Sisfogo ocorridos a até 10 km nos 7 dias
seguintes, e consolida as avaliações de especialistas sobre os alertas
(pertinente / parcialmente / não pertinente). Os resultados entram no pacote de
evidências (`/api/admin/evidence.json`). Só depois de volume suficiente
(ver critérios em `18_PLANO_PILOTO_OPERACAO.md`) os limiares poderão ser recalibrados,
com nova versão do motor e registro da mudança.
