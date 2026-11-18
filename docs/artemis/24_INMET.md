# 24 — Módulo INMET: observações meteorológicas oficiais (2026-11-18)

Branch: `feature/inmet-estacoes` (a partir de `operacional/artemis-dados-reais`). Nada publicado
e nada alterado em produção. Evidências: `evidencias/2026-11-18-inmet/`.

## 1. Fontes investigadas e condições de acesso

| Fonte | Endereço | Acesso | Situação |
|---|---|---|---|
| Cadastro de estações | `apitempo.inmet.gov.br/estacoes/T` | JSON público | **usada** — 668 estações automáticas (534 operantes, 134 em pane) |
| Dados históricos (portal) | `portal.inmet.gov.br/uploads/dadoshistoricos/<ANO>.zip` | download público, um CSV por estação | **usada** — 2026: 82 MB, 634 estações, até 31/10/2026 (atualizado em 05/11/2026) |
| API horária | `apitempo.inmet.gov.br/estacao/<ini>/<fim>/<cód>` | responde **204 (vazio) sem token**; o token é emitido pelo INMET a pedido | **não usada** — pendente de credencial; nada é simulado no lugar |

- Rede: os dois hosts foram liberados no ambiente pessoal ARTEMIS-AI em 18/11/2026.
- Licença: dados públicos (LAI); citar "Fonte: INMET".
- Cobertura: estações automáticas, com séries por ano desde 2000.
- Periodicidade: horária (UTC). O arquivo do ano corrente é atualizado cerca de uma vez por mês, então a observação mais recente disponível tem **até ~4 semanas de atraso**.
- Formato: latin-1, separado por `;`, vírgula decimal, 8 linhas de metadados (região, UF, nome, código, latitude, longitude, altitude e fundação); `-9999` ou campo vazio indicam ausência. Até 2018 a data e a hora usam outro formato (`AAAA-MM-DD` e `HH:MM`), também aceito.

## 2. Esquema (migração 0018, só aditiva)

A tabela `weather_data`, que já existia, é o **cache pontual do Open-Meteo**: não tem estação, chave de unicidade nem controle de qualidade. Por isso as observações de estação ficaram em tabelas próprias. A rastreabilidade reaproveita `data_sources` (fonte `inmet-estacoes`) e `source_sync_runs`.

| Tabela | Conteúdo | Chaves e índices |
|---|---|---|
| `weather_stations` | código, nome, UF, coordenadas, altitude, situação, fuso (UTC−3/−4/−5 por UF) e registro original do INMET | única (fonte, código); `geom geography` + GiST |
| `weather_station_observations` | uma linha por estação e hora UTC; valores processados nas unidades de origem; `quality_flags`; **sha256 do arquivo bruto, nome do arquivo e número da linha** | única (estação, hora); índice por hora; CHECKs físicos |
| `weather_station_daily` | dia **local** da estação: horas observadas, médias, máximas e mínimas, UR e temperatura às 13 h locais, vento, rajada, chuva e horas com alerta | PK (estação, dia) |

Os arquivos brutos são preservados como baixados em `INMET_RAW_DIR` (padrão `data/raw/inmet/<ano>/<ano>-<sha>.zip`, fora do git).

## 3. Pipeline (`server/connectors/inmet.ts`, `server/services/inmet-sync.ts`)

- **Coleta:** cadastro de estações e arquivo anual, com novas tentativas e espera crescente em erros de rede e HTTP 408/429/5xx. Um 404 não é repetido, e uma resposta que não seja ZIP vira falha registrada.
- **Incremental:**
  - o agendador consulta o `Last-Modified` do arquivo antes de baixar;
  - se o sha256 for igual ao da última execução bem-sucedida, nada é reprocessado;
  - se o arquivo mudou, só as linhas alteradas são reescritas (`IS DISTINCT FROM`) e as horas novas são inseridas.
- **Recuperável:**
  - cada arquivo de estação é gravado numa transação própria;
  - a execução registra os arquivos concluídos, e uma execução interrompida com o mesmo arquivo é retomada de onde parou;
  - execuções órfãs são encerradas;
  - um *advisory lock* impede execuções simultâneas.
- **Validação:**

| Situação | Tratamento |
|---|---|
| Data/hora inválida (mês 13, 31/02, minuto ≠ 00) | linha rejeitada com motivo |
| Data/hora no futuro | linha rejeitada com motivo |
| Data fora do ano do arquivo | linha rejeitada com motivo |
| Hora repetida no arquivo | mantém a primeira ocorrência e conta a repetição |
| Hora sem nenhuma medida | descartada e contada |
| Temperatura fora de −10…50 °C | valor anulado, com alerta |
| Umidade fora de 1…100 % | valor anulado, com alerta |
| Vento acima de 60 m/s ou rajada acima de 90 m/s | valor anulado, com alerta |
| Chuva acima de 150 mm/h | valor anulado, com alerta |
| Pressão fora de 500…1 100 hPa | valor anulado, com alerta |
| Orvalho acima da temperatura | valor mantido, com alerta |
| Rajada menor que a média | valor mantido, com alerta |
| Máxima menor que a mínima | valor mantido, com alerta |
| Salto de temperatura acima de 10 °C em 1 h | valor mantido, com alerta |
| Código ou coordenadas inválidos no cabeçalho | arquivo recusado |
| Colunas obrigatórias ausentes | arquivo recusado |

- **Agregação diária:** calculada no dia local da estação. A chuva do dia só é considerada completa com pelo menos 22 h observadas.
- **Agendamento:** `INMET_SYNC_HOURS` (padrão 24) baixa o cadastro e o ano corrente. `INMET_SYNC_ENABLED=false` desativa.

```bash
npm run sync:inmet -- --stations
npm run sync:inmet -- --year 2025 --year 2026
npm run sync:inmet -- --year 2026 --force   # reprocessa mesmo sem mudança
```

## 4. Execução real (evidência: `volume-execucoes.json`)

| Execução | Lidas | Inseridas | Atualizadas | Inalteradas | Descartadas | Duração |
|---|---|---|---|---|---|---|
| Cadastro de estações | 668 | 668 (registradas ou atualizadas) | — | — | 0 | 2 s |
| 2026 (primeira carga) | 4 556 568 | 3 196 619 | 0 | 0 | 1 359 949 horas sem nenhuma medida | 364 s |
| 2026 (mesmo arquivo) | — | — | — | — | — | 51 s (só o download; sha256 igual) |
| 2026 `--force` | 4 556 568 | **0** | **0** | **3 196 619** | 1 359 949 | 353 s |

- Volume no banco: 669 estações (668 do cadastro e 1 encontrada só no arquivo), 565 com dados, 3 196 619 observações horárias, 139 072 estação-dias e 1 029 MB.
- Qualidade: 1 414 horas com alerta (787 orvalho acima da temperatura, 506 saltos de temperatura, 109 rajadas menores que a média, 37 radiações fora da faixa, 10 máximas menores que a mínima, 7 orvalhos fora da faixa).
- Disponibilidade em outubro: média de 91,8 % das horas; 436 estações com 90 % ou mais.
- **Consistência independente** (`scripts/inmet_consistency.py`, só biblioteca padrão, a partir do ZIP bruto): **0 diferenças** em 107 estação-dias de 40 estações sorteadas (horas, máxima, mínima, UR mínima, UR às 13 h e chuva). A única divergência da primeira rodada era do próprio script de verificação, que tratava a máxima horária de forma diferente da regra documentada; foi corrigido.
- **Latência** (build de produção, 10 conexões, `latencia-api.json`), todas sem erros:

| Rota | req/s | p50 | p99 |
|---|---|---|---|
| Série diária de 30 dias | 1 094 | 8 ms | 15 ms |
| Série diária de 10 meses | 423 | 22 ms | 42 ms |
| Série horária de 7 dias | 683 | 14 ms | 25 ms |
| Comparação de períodos | 835 | 11 ms | 22 ms |
| FMA de 90 dias | 563 | 16 ms | 29 ms |
| Lista de estações | 188 | 52 ms | 87 ms |
| Status da fonte | — | 2 ms | — |

  O status da fonte levava 1,9 s porque contava 3,2 milhões de linhas. Agora usa os agregados diários, com totais idênticos, e um cache de 60 s.

## 5. Relação com as propriedades

- **Critério:** distância geodésica da estação até o **limite** da propriedade (0 se estiver dentro) ou até o ponto da área. Usa PostGIS (`ST_Distance`/`ST_DWithin`, GiST) ou haversine no modo sem PostGIS.
- **Representatividade, só por distância:**

| Classe | Distância | Uso |
|---|---|---|
| Próxima | ≤ 25 km | referência razoável |
| Intermediária | ≤ 50 km | condições regionais |
| Distante | ≤ 100 km | apenas contexto; não usada como observação da área |
| Não representativa | > 100 km | não usada |

- A tela mostra, para cada estação: distância, classe, disponibilidade nos últimos 30 dias de dados, última observação e situação. Também informa que relevo, altitude, proximidade do mar e uso do solo podem fazer a propriedade diferir mesmo de uma estação próxima.
- Ainda não se considera a diferença de altitude entre estação e propriedade, porque falta a altitude da propriedade (limitação registrada).

## 6. Integração ao motor de risco

- **Prioridade por variável:** valor informado pelo usuário → **observação do INMET** → estimativa do Open-Meteo, que continua como está e **não foi substituído**.
- **Quando a observação do INMET entra:**
  - só de estação a até 50 km com observação de no máximo 3 h;
  - a chuva de 72 h só entra com pelo menos 48 h observadas;
  - o vento é convertido de m/s para km/h.
- **Rastreabilidade de cada valor:**
  - origem `inmet-estacao`, com a natureza "Medição oficial", distinta de "Estimativa" (Open-Meteo), "Observado" (foco do INPE por satélite), "Registro oficial" (Sisfogo) e "Calculado";
  - fonte e estação na análise, em `risk_analysis_sources` e no relatório.
- **Sem observação recente:** a análise registra por quê. Hoje é sempre o caso, porque os dados públicos estão defasados: "INMET não utilizado: última observação disponível da estação … é de … — N dia(s) atrás…".
- **Pesos do motor:** não mudaram. Receber dados novos não significa que a IA foi treinada ou validada.

## 7. Índice de perigo de incêndio

| Índice | Requisitos | Avaliação | Situação |
|---|---|---|---|
| **FMA — Fórmula de Monte Alegre** (Soares, 1972) | UR às 13 h locais e chuva diária | dados horários do INMET atendem | **implementado** (`shared/fire-indices.ts`), exibido à parte, fora da pontuação |
| FMA+ (Nunes et al.) | + vento às 13 h | coeficientes e classes ainda não conferidos na publicação original | não implementado |
| Nesterov | T e ponto de orvalho às 15 h, chuva | possível com os dados | não implementado (calibração russa) |
| Angström | T e UR às 13 h | possível, mas não cumulativo | não implementado |
| FWI canadense | T, UR, vento ao meio-dia, chuva de 24 h, inicialização sazonal | possível, mas exige códigos de umidade de combustível e inicialização | não implementado |

Regras do FMA aplicadas:
- **Acumulação:** soma de 100/UR(13 h) desde a última chuva forte.
- **Fatores de chuva:** até 2,4 mm não altera; 2,5–4,9 mm ×0,7; 5–9,9 mm ×0,4; 10–12,9 mm ×0,2; acima de 12,9 mm zera.
- **Classes:** nulo ≤ 1 · pequeno ≤ 3 · médio ≤ 8 · alto ≤ 20 · muito alto > 20.
- **Exigências:** dia sem UR às 13 h ou com chuva incompleta fica "sem dados". A série começa 120 dias antes do período pedido e fica marcada como "possivelmente subestimada" até o primeiro zeramento por chuva.

**Verificação empírica** (`fma-vs-focos-inpe.json`; agosto a outubro, 542 estações, 23 002 estação-dias válidos): porcentagem de dias com foco do INPE a até 25 km no dia local ou nos dois seguintes.

| Classe | Estação-dias | Com foco |
|---|---|---|
| Nulo | 23 | 8,7 % |
| Pequeno | 3 411 | 17,6 % |
| Médio | 5 703 | 31,6 % |
| Alto | 5 532 | 46,2 % |
| Muito alto | 8 333 | 68,2 % |

O comportamento é coerente e monotônico. Isso **verifica a implementação, não calibra** o índice. Ficaram excluídos 26 862 estação-dias, a maioria séries em seca contínua sem zeramento por chuva desde a janela inicial.

## 8. Painel

- **`/estacoes`** (menu "Estações INMET"):
  - totais da fonte, período coberto e última sincronização;
  - **mapa de localização** das estações, com a cor indicando a disponibilidade;
  - filtro por UF;
  - **séries temporais** diárias em gráficos separados, sem eixo duplo: temperatura, umidade, chuva e vento;
  - **estatísticas descritivas** (n, média, mínimo, P10, mediana, P90, máximo e desvio);
  - **comparação** com o período anterior de mesma duração;
  - FMA em gráfico e em tabela.
- **Página da propriedade, seção "Meteorologia observada (INMET)":**
  - estações vinculadas, com distância, representatividade, disponibilidade e última observação;
  - histórico de 30 dias da estação representativa mais próxima, com estatísticas e FMA.
- **Acessibilidade e cores:** visão em tabela em todos os gráficos; paleta categórica validada (CVD ΔE ≥ 9,2); sem rolagem horizontal no celular.
- Capturas: `01-estacoes.png`, `02-propriedade-meteorologia.png` e `03-celular.png`.

## 9. Testes executados (`testes-com-postgis.log`, `testes-sem-postgis.log`)

- **`tests/unit/inmet.test.ts`** (8 testes):
  - arquivo **real** de Brasília;
  - ausentes, extremos e inconsistências;
  - horas duplicadas e horários divergentes (mês 13, minuto ≠ 00, futuro, outro ano, formato antigo);
  - cabeçalhos inválidos;
  - cadastro real de estações;
  - novas tentativas em falha de conexão;
  - FMA com contas feitas à mão;
  - classes de representatividade e estatísticas.

  O teste encontrou um defeito real, já corrigido: datas como 13/2026 viravam janeiro do ano seguinte.
- **`tests/integration/inmet.test.ts`** (5 testes, com e sem PostGIS):
  - carga com trecho real e estação controlada;
  - agregados diários **conferidos contra um cálculo independente**;
  - arquivo idêntico ignorado; arquivo alterado gera só 1 inserção e 1 atualização; `--force` idempotente;
  - retomada de execução interrompida;
  - falha de conexão, 404 e resposta que não é ZIP, sem gravar nada;
  - vínculo com a propriedade (4,9 km, "próxima") e isolamento entre organizações;
  - validação das rotas públicas;
  - motor usando uma observação recente (com rótulo, conversão de unidade e fonte) e recusando uma antiga.
- **Suíte completa:** 306 testes aprovados com PostGIS (57 unitários, 96 de integração, 109 pytest, 44 dos scripts) e 0 falhas sem PostGIS. Teste de uso real de ponta a ponta: 10/10.

## 10. Limitações e pendências

1. **Sem observação em tempo quase real:** o arquivo público chega uma vez por mês, e a API horária exige um token do INMET (pendência de credencial; a responsável pode solicitá-lo ao INMET). Até lá o INMET serve para histórico e contexto, e o Open-Meteo para as condições atuais.
2. Só o ano de 2026 foi carregado neste ambiente. Para outros anos: `--year AAAA`.
3. O fuso é aproximado por UF: o sudoeste do Amazonas, que é UTC−5, é tratado como UTC−4.
4. A representatividade considera só a distância.
5. O FMA não foi calibrado pela ARTEMIS e não entra na pontuação.
6. Cerca de 1 GB por ano de observações no banco. A retenção deve ser decidida antes da produção.
