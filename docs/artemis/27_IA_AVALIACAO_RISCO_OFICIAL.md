# 27 — IA: avaliação do Risco de Fogo oficial do INPE, do motor ARTEMIS e de um modelo calibrado (2026-11-28)

**Natureza:** avaliação retrospectiva com dados públicos reais. **Não** é validação em campo,
**não** é acurácia de produção e **não** comprova precisão da IA. O desfecho é **detecção de foco
de calor por satélite**, não incêndio confirmado.

- Evidência completa (4 800 casos, um por linha, com os 12 arquivos do INPE e seus sha256):
  `evidencias/2026-11-28-ia/avaliacao-rf-oficial-artemis.json`
- Script reproduzível: `npm run eval:rf-oficial` (`scripts/evaluate-official-rf.ts`)
- Estatísticas (AUC, Brier, confiabilidade, regressão logística) em `shared/eval-metrics.ts`,
  com testes calculados à mão em `tests/unit/eval-metrics.test.ts`.

## 1. Desenho

| Item | Definição |
|---|---|
| Casos | os **mesmos** 4 800 do backtest de 18/11 (doc 23): 400 municípios sorteados × 12 datas semanais (25/08–10/11/2026), D às 15:00 UTC |
| Desfecho | ≥ 1 foco INPE a até 10 km em (D, D + 7] |
| Nova variável | **Risco de Fogo oficial do INPE (modelo 2.2) do dia D − 1**, o último observado publicado antes de D, lido no ponto do município (pixel de 1 km; 156 casos em área urbana/água usaram o pixel válido mais próximo, até 5 km) |
| Variáveis já existentes | pontuação do motor ARTEMIS em D; persistência (foco a até 10 km nas 24 h anteriores) |
| Cobertura | 4 800 de 4 800 casos com RF; 12 de 12 arquivos baixados do INPE |
| Vazamento | nenhum dado posterior a D entra nas variáveis; o modelo é treinado só na parte de treino de cada separação, e a padronização usa média e desvio do treino |

**Modelo experimental ("IA"):** regressão logística em [RF oficial, pontuação ARTEMIS, persistência].
Escolhida por ser **calibrável e explicável** (coeficientes padronizados legíveis); com 3 variáveis
e ~3 000 casos de treino, um modelo mais complexo não se justifica.

**Separações (sem sobreposição entre treino e teste):**

| Separação | Treino | Teste |
|---|---|---|
| Temporal | 25/08 a 13/10 (8 datas) | 20/10 a 10/11 (4 datas) |
| Geográfica | 19 UFs | 8 UFs sorteadas (semente 11): SP, BA, GO, MG, RS, MS, AC, PA |
| Temporal **e** geográfica (a mais rígida) | datas iniciais nas UFs de treino | datas finais nas UFs de teste |

## 2. Resultados — todos os casos (n = 4 800; 34,6 % com foco nos 7 dias seguintes)

**Discriminação (AUC):** RF oficial **0,662** · motor ARTEMIS **0,723** · persistência 0,574.

| Regra de decisão | Precisão | Recall | Falsos positivos (FPR) | F1 |
|---|---|---|---|---|
| RF oficial alto ou crítico (> 0,70) | 0,468 | 0,708 | 0,425 | 0,563 |
| RF oficial crítico (> 0,95) | 0,473 | 0,635 | 0,374 | 0,542 |
| ARTEMIS moderado ou mais | 0,551 | 0,589 | 0,254 | 0,569 |
| ARTEMIS alto ou mais | 0,583 | 0,017 | 0,006 | 0,033 |
| Persistência | 0,717 | 0,188 | 0,039 | 0,298 |
| RF > 0,70 **e** ARTEMIS moderado ou mais | 0,556 | 0,530 | 0,223 | 0,543 |

**Sem fogo por perto** (nenhum foco a até 50 km nas 24 h anteriores, n = 2 071, 16,7 % de eventos):
AUC do RF oficial **0,571**, do ARTEMIS **0,585**. Boa parte do poder preditivo de ambos vem de
fogo que já está acontecendo na região. Antecipar o **primeiro** foco é muito mais difícil.

## 3. Modelo calibrado — conjunto de teste de cada separação

| Separação (n teste) | Brier de referência* | RF oficial: AUC · Brier · ECE | ARTEMIS: AUC · Brier · ECE | Combinado: AUC · Brier · ECE |
|---|---|---|---|---|
| Temporal (1 600) | 0,224 | 0,755 · 0,191 · 0,101 | 0,785 · 0,182 · 0,087 | **0,788 · 0,180** · 0,077 |
| Geográfica (2 532) | 0,221 | 0,647 · 0,195 · 0,058 | 0,705 · 0,182 · 0,027 | **0,711 · 0,179** · 0,030 |
| Temporal e geográfica (844) | 0,207 | 0,684 · 0,165 · 0,073 | 0,720 · 0,162 · 0,062 | **0,728 · 0,161** · 0,077 |

\* Brier de prever sempre a taxa de eventos do treino. Brier e ECE: quanto menor, melhor.

**Explicabilidade:** coeficientes padronizados do modelo combinado (separação mais rígida):
pontuação ARTEMIS **0,52**, persistência **0,38**, RF oficial **0,04**. Na separação geográfica o
RF chega a 0,24. Ou seja, quando a pontuação ARTEMIS já está no modelo, o RF oficial acrescenta pouco.

**Calibração:** na separação temporal, o modelo superestima nas faixas baixas (prevê 18 %, ocorre
9,5 %) e subestima nas intermediárias (prevê 44 %, ocorre 60 %). A taxa de eventos e a relação mudam
entre o início e o fim da estação seca, e uma calibração feita num período não vale para outro.
**Por isso a plataforma continua sem exibir percentuais de probabilidade.**

## 4. Por região, bioma e mês (AUC: RF oficial / ARTEMIS)

| Recorte | n | Taxa de eventos | RF oficial | ARTEMIS |
|---|---|---|---|---|
| Norte | 408 | 45,8 % | 0,600 | 0,645 |
| Nordeste | 1 716 | 55,0 % | **0,496** | 0,615 |
| Centro-Oeste | 456 | 23,0 % | 0,602 | 0,659 |
| Sudeste | 1 380 | 20,1 % | 0,612 | 0,662 |
| Sul | 840 | 17,4 % | **0,494** | 0,583 |
| Amazônia | 444 | 47,7 % | 0,631 | 0,711 |
| Cerrado | 1 044 | 37,2 % | 0,607 | 0,687 |
| Caatinga | 1 044 | 52,0 % | **0,490** | 0,575 |
| Mata Atlântica | 1 776 | 27,5 % | 0,644 | 0,699 |
| Pampa | 108 | 6,5 % | 0,605 | 0,572 |
| ago/2026 · set · out · nov | 400 · 2 000 · 1 600 · 800 | 33 % · 34 % · 37 % · 31 % | 0,50 · 0,58 · 0,76 · 0,74 | 0,61 · 0,67 · 0,78 · 0,78 |

Bioma = o mais frequente nos focos do município no período. 384 casos de municípios sem focos não
entram na tabela (AUC 0,59 / 0,72; taxa de 5,2 %). Amostras pequenas (Pampa) têm alta incerteza.

**Leitura:** na Caatinga, no Nordeste e no Sul, o RF oficial **não discriminou** (AUC ≈ 0,5) neste
período. Na estação seca, a maior parte do semiárido fica em "crítico" e o índice satura:
2 228 dos 4 800 casos (46 %) estavam em crítico.

## 5. Divergência entre o índice oficial e o motor ARTEMIS

Casos e taxa de foco nos 7 dias seguintes, por classe do RF oficial (linhas) × nível ARTEMIS (colunas):

| RF oficial \ ARTEMIS | Baixo | Moderado | Alto |
|---|---|---|---|
| Mínimo | 1 618 · 16,7 % | 47 · 46,8 % | 1 |
| Baixo | 270 · 21,9 % | 57 · 49,1 % | 0 |
| Médio | 209 · 27,3 % | 88 · 52,3 % | 1 |
| Alto | 184 · 26,6 % | 95 · 72,6 % | 2 |
| Crítico | **745 · 33,0 %** | 1 439 · 54,5 % | 44 · 54,5 % |

- **Os dois índices divergem com frequência:** 745 casos estão em "crítico" no índice oficial e em
  "baixo" na ARTEMIS. A taxa de foco ali (33 %) é próxima da média, ou seja, o crítico oficial
  sozinho não separou bem esses casos.
- Quando os dois concordam em risco elevado (RF alto e ARTEMIS moderado), a taxa sobe a 72,6 %.
- Isso **não** autoriza uma fórmula que some os dois com pesos arbitrários. Os índices medem coisas
  diferentes e são mostrados **separados**, cada um com sua metodologia.

## 6. Decisões tomadas a partir desta avaliação

1. **O índice oficial do INPE entra na plataforma como referência separada** (mapa, área, alertas
   de risco persistente), com sua metodologia, e **não** substitui nem é somado ao motor ARTEMIS.
2. **O modelo combinado não foi ativado.** O ganho sobre o motor ARTEMIS é marginal (AUC +0,003
   a +0,008; Brier −0,001 a −0,003) e a calibração não se manteve entre períodos.
3. **Nenhum percentual é exibido como probabilidade**, porque a calibração variou entre os períodos.
4. As regras de alerta de risco oficial (doc 26, R1/R2) seguem marcadas como **não calibradas**, e
   devem ser revistas com os especialistas do piloto usando a tabela da seção 5.

## 7. Limitações

- O desfecho é foco de calor (detecção térmica), não incêndio confirmado. Focos não detectam fogo
  sob nuvens e incluem fontes de calor que não são incêndio.
- Uma única estação seca (ago–nov/2026) e 12 datas. Não há estação chuvosa nem outros anos.
- O RF é lido no ponto do município (1 km), não na propriedade. A pontuação ARTEMIS é a do backtest
  de 18/11, em que a vegetação não era observada.
- Municípios vizinhos de UFs diferentes podem ter focos correlacionados, o que pode deixar a
  separação geográfica otimista.
- Próximo passo para uma validação de verdade: desfecho de **incêndio confirmado** (ROI do Sisfogo
  ou área queimada do INPE), mais de uma estação e avaliação dos especialistas no piloto.
