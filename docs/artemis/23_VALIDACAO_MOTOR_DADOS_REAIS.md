# 23 — Validação retrospectiva do motor de risco com dados reais (2026-11-18)

**Natureza:** avaliação retrospectiva (backtest) com dados públicos reais. **Não** é validação
em campo nem acurácia de produção. Evidências: `evidencias/2026-11-18/backtest-motor.json`
(4 800 casos, um por linha) e `evidencias/2026-11-18/treino-experimental-temporal.json`.

## 1. Desenho

| Item | Definição |
|---|---|
| Unidade | (ponto, data D às 15:00 UTC ≈ meio-dia no Brasil) |
| Pontos | 400 municípios sorteados (semente 7) entre os 5 570 com limite oficial do IBGE; ponto = `ST_PointOnSurface` do limite |
| Datas | 12 semanas, de 25/08 a 10/11/2026 (passo de 7 dias) → 4 800 casos, 0 descartados por falta de clima |
| Entradas conhecidas em D | Open-Meteo horário (temperatura, umidade, vento) e chuva das 72 h anteriores; foco INPE mais próximo até 50 km nas 24 h anteriores; ROIs Sisfogo até 10 km anteriores a D |
| Vegetação | **não observada** por nenhuma fonte conectada → "moderada" para todos (+4 pontos em todos os casos) |
| Desfecho | ≥ 1 foco INPE a até 10 km nos 7 dias seguintes (D, D + 7] |
| Motor | regras 1.1.0 (paridade exata Python/TypeScript) — sem parâmetros treinados |
| Dados usados | 2 650 395 focos INPE (01/08–18/11/2026, arquivos mensais e diários), 1 708 ROIs Sisfogo, 5 570 limites IBGE, Open-Meteo |

Sem vazamento: nada posterior a D entra nas entradas; o desfecho usa só dados posteriores a D.

## 2. Resultados — todo o período (n = 4 800; prevalência 34,6 %)

| Nível atribuído | Casos | Com foco nos 7 dias seguintes | Taxa |
|---|---|---|---|
| Baixo | 3 026 | 682 | 22,5 % |
| Moderado | 1 726 | 949 | 55,0 % |
| Alto | 48 | 28 | 58,3 % |
| Crítico | 0 | — | — |

- **Discriminação (AUC da pontuação): 0,723**; 0,699 nos casos sem foco nas 24 h anteriores
  (o índice não depende só de "já havia fogo perto").
- A taxa de eventos **cresce com o nível** (22 % → 55 % → 58 %).

| Regra de decisão | Precisão | Recall (sensibilidade) | Falsos positivos (FPR) | F1 |
|---|---|---|---|---|
| Alertar em "alto ou crítico" | 0,583 | **0,017** | 0,006 | 0,033 |
| Alertar em "moderado ou mais" | 0,551 | 0,589 | 0,254 | 0,569 |
| Linha de base "persistência" (foco a até 10 km nas 24 h anteriores) | 0,717 | 0,188 | 0,039 | 0,298 |

### Estabilidade por mês

| Mês | Casos | Prevalência | AUC | Precisão / recall (moderado+) |
|---|---|---|---|---|
| ago (1 semana) | 400 | 0,33 | 0,606 | 0,41 / 0,50 |
| set | 2 000 | 0,34 | 0,672 | 0,49 / 0,57 |
| out | 1 600 | 0,37 | 0,782 | 0,64 / 0,64 |
| nov | 800 | 0,31 | 0,778 | 0,63 / 0,57 |

## 3. Treinamento experimental com separação temporal

Regressão logística nas mesmas entradas, **treinada** com as datas até 22/09 (2 000 casos;
desfechos até 29/09) e **testada** de 06/10 em diante (2 400 casos). O intervalo entre treino e
teste é maior que a janela do desfecho, então não há sobreposição.

| No mesmo conjunto de teste | AUC | Precisão | Recall | F1 |
|---|---|---|---|---|
| Motor de regras (sem treino) | 0,783 | 0,639 | 0,617 | 0,628 |
| Regressão logística (treinada) | 0,789 | 0,647 | 0,625 | 0,636 |

(mesma quantidade de alertas: 33,9 % dos casos). Os coeficientes padronizados apontam a
proximidade do foco (0,62) e a umidade (−0,22) como os sinais mais fortes.

## 4. Interpretação

1. **O índice tem poder de separação real** (AUC 0,72 a 0,78 nos meses com mais dados) e é
   monotônico: quanto maior o nível, maior a chance de foco nos dias seguintes.
2. **Os níveis "alto" e "crítico" estão mal calibrados para este desfecho:** só 1 % dos
   casos chega a "alto" e nenhum a "crítico"; um alerta só em "alto ou mais" perderia 98 % dos
   eventos. Parte disso vem da vegetação fixa em "moderada" (com "seca" seriam +6 pontos; com
   "muito seca", +11).
3. **Um modelo treinado não supera, hoje, as regras transparentes** (diferença de 0,006 de
   AUC, dentro do ruído de uma temporada). Não há base para trocar o motor por aprendizado de
   máquina: as regras ficam como motor oficial, e o pipeline de treino fica pronto para quando
   houver mais temporadas e desfechos de campo.
4. A linha de base "persistência" tem precisão maior, mas detecta só 19 % dos eventos; o motor
   (moderado+) detecta 59 %, ao custo de mais alarmes.

## 5. Limitações

- O rótulo é **foco de calor** (detecção térmica: inclui queimadas autorizadas e falsos
  positivos), não incêndio confirmado nem dano.
- Vegetação não observada; meteorologia de modelo em grade; pontos são centros de municípios,
  não propriedades.
- Uma única temporada (ago–nov 2026); casos do mesmo município em semanas seguidas não são
  independentes, então os intervalos de confiança reais são mais largos que o tamanho da amostra sugere.

## 6. Recomendação (decisão da responsável — nada foi alterado no motor)

- **Não** mudar limiares com base em uma temporada. Propor, para decisão, uma revisão 1.2.0 em
  que "alto" comece em 40 pontos, e reavaliar com este mesmo script (`scripts/backtest-risk.ts`)
  antes de qualquer publicação.
- Integrar um índice de vegetação por satélite (NDVI/umidade do combustível) para remover a
  constante "moderada".
- Repetir o backtest a cada mês do piloto e anexar o resultado ao dossiê.

## 7. Como reproduzir

```bash
npm run sync:inpe -- --month 2026-08   # e 2026-09, 2026-10; depois --from 2026-11-01 --to <hoje>
npm run db:load-municipalities && npm run db:load-boundaries
npx tsx scripts/backtest-risk.ts --from 2026-08-25 --to 2026-11-10 --step 7 --sample 400 --seed 7 --out backtest.json
python python_service/train_real_backtest.py backtest.json treino.json
```
