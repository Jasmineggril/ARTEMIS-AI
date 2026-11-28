# 26 — Evolução técnica e científica: índices oficiais do INPE, Haines, IA, mapa e alertas

Branch: `feature/ciencia-risco-inpe` (não mesclada na `main`; nada publicado em produção).
Período: 23 a 28/11/2026. Este documento reúne os 14 entregáveis pedidos. A avaliação da IA
está detalhada em `27_IA_AVALIACAO_RISCO_OFICIAL.md`.

Regra seguida em todo o trabalho: **nada é dado como concluído sem evidência verificável**. Cada
item abaixo aponta para o teste, o arquivo de evidência ou a captura que o comprova, ou é
marcado como pendente.

---

## 1. Diagnóstico (antes desta etapa)

| Funcionalidade | Estado atual (antes) | Problema identificado | Melhoria proposta | Prioridade |
|---|---|---|---|---|
| Risco de fogo oficial do INPE | Ausente. Só havia o campo `fire_risk` que vem junto de cada foco | Não havia o índice oficial por área, nem previsão, nem série histórica | Ingerir os produtos oficiais (observado + previsão) e amostrar por propriedade | Alta |
| Motor de risco ARTEMIS | Regras 1.1.0, validado retrospectivamente (doc 23, AUC 0,723) | Sem referência oficial para comparar; vegetação não observada | Comparar com o índice oficial nos mesmos casos; mostrar os dois **separados** | Alta |
| Método Setzer/INPE | Ausente | — | Implementar a fórmula oficial verificada e reproduzir a grade do INPE | Média |
| Índice de Haines | Ausente | Exige dados em altitude, que o sistema não tinha | Implementar só com níveis de pressão; senão "indisponível" | Média |
| IA | Modelo experimental com separação temporal (doc 23) | Sem calibração, sem separação geográfica, sem variáveis oficiais | Avaliar com RF oficial, calibração, separação temporal e geográfica, explicabilidade | Alta |
| Mapa | Camadas de focos, Sisfogo, ocorrências, áreas | Sem índices oficiais, sem consulta por ponto, sem estações INMET | Camadas RF observado/previsto e dias sem chuva, consulta por clique, estações, exportação | Alta |
| Alertas | Focos próximos e risco calculado | Nenhum alerta de condição meteorológica persistente | Alerta de risco oficial persistente, com justificativa e deduplicação | Média |
| Balões do mapa | Existiam | **Transparentes**: o texto ficava sobre o mapa (defeito em todo o app) | Fundo próprio com as cores do tema | Alta (corrigido) |
| Diferenciação risco/foco/incêndio | Presente nos textos de focos | Precisava valer também para os índices novos | Todo índice traz "não é foco, não é incêndio confirmado, não é probabilidade" | Alta |

## 2. Fontes oficiais verificadas

| Produto | Onde | Formato verificado | Uso |
|---|---|---|---|
| Risco de Fogo **observado** (modelo 2.2) | `dataserver-coids.inpe.br/queimadas/queimadas/riscofogo_meteorologia/observado/risco_fogo/INPE_FireRiskModel_2.2_FireRisk_AAAAMMDD.nc` | NetCDF4/HDF5, 1 km, 8 899 × 8 699, lat −55,985→32,995, valor ausente −999, título "Risco de fogo para o dia AAAAMMDD" | Série por área/estação, grade do mapa, alertas, avaliação |
| Risco de Fogo **previsto** T0–T3 | `…/previsto/risco_fogo/RF.PREV.T{0..3}.tif` | GeoTIFF, norte para cima, mesma grade; validade no metadado GDAL | Previsão por área, mapa, alerta R2 |
| Dias sem chuva | `…/observado/numero_dias_sem_chuva/INPE_FireRiskModel_2.2_NDWR_AAAAMMDD.nc` | NetCDF3, 0,1°, variável `ndsc120` (dias com ≤ 1 mm) | Camada de seca do mapa |
| Entradas do modelo (precipitação IMERG, T e UR do GFS, vegetação, relevo) | mesmo servidor | NetCDF3 | Reprodução do cálculo (seção 4) |
| Método e classes | Script operacional publicado pelo INPE (`rf_previsto_1-5dias_2023.sh`), documento QMD003-2000-PRO-001-A, Anuário Risco de Fogo 2025 (Tabela 3.1) | — | Fórmulas e limites de classe |
| Níveis de pressão (Haines) | Open-Meteo (modelos GFS), `temperature_950/850/700/500hPa`, `dew_point_850/700hPa` | JSON | Haines; **dado de modelo**, não de radiossonda |

- Licença: dados abertos do INPE. A citação "Fonte: Programa Queimadas/INPE" aparece na
  interface, nos CSV exportados e no cadastro da fonte (migração 0019).
- Lacunas encontradas no servidor do INPE: a precipitação diária de 25/07, 23/10 e 28/10/2026
  responde 404. Ficam registradas na evidência da reprodução.
- Outros produtos que existem e ainda não foram integrados: área queimada (coleção 2, shp/tif),
  eventos de fogo (gpkg), médias mensais, anomalia e climatologia.

## 3. Plano e arquitetura

```
INPE (NetCDF/GeoTIFF) ──► server/connectors/inpe-fire-risk.ts   (download com nova tentativa, sha256, leitura, amostragem)
                           └► server/services/inpe-fire-risk-sync.ts (trava, idempotência por sha256, transação, registro em source_sync_runs)
                                ├► fire_risk_values  (valor por área/estação/dia/antecedência, método, arquivo, sha256)
                                └► fire_risk_grids   (grade de 0,2° com média e máximo, para o mapa)
scheduler (a cada INPE_RISK_SYNC_HOURS = 6 h) ─► syncRecentRisk(3 dias + previsão) ─► evaluateRiskAlerts (R1/R2)
API: /api/fire-risk/{available,grid,point}, /api/areas/:id/fire-risk, /api/areas/:id/haines
UI:  mapa (FireRiskLayer), página da área (AreaFireRisk), preferências de notificação
```

- O índice oficial é a **referência autoritativa**. A reimplementação ARTEMIS da fórmula
  (`shared/inpe-fire-risk.ts`) serve para verificar o método e para onde não houver produto
  oficial, sempre rotulada como reprodução.
- Nada substitui o Open-Meteo, o INMET, o Sisfogo nem os focos: tudo foi acrescentado.

## 4. Motor científico

### 4.1 Risco de Fogo INPE 2.2 (método Setzer) — `shared/inpe-fire-risk.ts`
- **PSE** = 105 · Π exp(cᵢ · Pᵢ) em 11 janelas (1, 2, 3, 4, 5, 6–10, 11–15, 16–30, 31–60, 61–90,
  91–120 dias), c = −0,14 … −0,0007. O dia 1 é o mais recente e inclui o próprio dia.
- **RB** por classe de vegetação 1–7 (A = 6 … 1,5; PSEmax = 30 … 120); **FU** = −0,006·UR + 1,3;
  **FT** = 0,02·T + 0,4; **RF** = min(1, RB·FT·FU); fatores 2.2: FLAT = 1 + 0,003|lat|, FTOP = 1 + 0,00003·elev.
- **Classes oficiais:** Mínimo ≤ 0,15 · Baixo ≤ 0,40 · Médio ≤ 0,70 · Alto ≤ 0,95 · Crítico > 0,95.
- **Reprodução contra a grade oficial** (20 000 pixels sorteados por dia), com as entradas do INPE:

| Variante | Dia | Erro médio absoluto | Mesma classe | Até 0,05 |
|---|---|---|---|---|
| UR em %, janela até o dia, FU −0,006, fatores 2.2 (**adotada**) | 22/11 | 0,016 | 92,7 % | 91,0 % |
| idem | 21/11 | 0,016 | 93,0 % | 90,1 % |
| FU −0,008 (valor do script de 2023) | 22/11 | 0,030 | 87,2 % | 82,9 % |
| janela até o dia anterior | 22/11 | 0,062 | 79,2 % | 66,3 % |

  O coeficiente −0,006 não foi ajustado aos dados: a varredura mostra que valores menores seguem
  reduzindo o erro, sinal de que compensam outro viés. Por isso o valor oficial publicado do INPE
  é sempre o mostrado ao usuário. O produto observado do INPE ainda é corrigido pelos focos dos
  últimos 3 dias, etapa que não é publicada. Evidências: `evidencias/2026-11-23-inpe-rf/`.
- **Conferência independente** da amostragem (Python, netCDF4/shapely): 40 de 40 estações iguais;
  15 de 17 áreas iguais. As 2 restantes eram polígonos só sobre área urbana, sem valor no INPE, e
  passaram a usar o centróide com o método registrado.

### 4.2 Índice de Haines — `shared/haines.ts`, `server/services/haines.ts`
- Haines (1988): HI = A (estabilidade) + B (umidade), de 2 a 6. Variantes baixa (950/850 hPa),
  média (850/700) e alta (700/500), escolhida pela altitude do local.
- **Só é calculado com níveis de pressão.** Sem eles, a resposta é `indisponivel` com o motivo
  (cota do Open-Meteo, nível ausente, falha de rede). Nunca usa dados de superfície.
- Conferido com dados reais em 24/11/2026: Brasília (variante média) 5 — moderado; Palmas, Cuiabá
  e Porto Velho (variante baixa) 4 — baixo. Evidência: `evidencias/2026-11-24-haines/`.
- Indica o potencial de crescimento de um fogo **já iniciado**, não o risco de ignição.

### 4.3 O que **não** foi feito, de propósito
- Nenhuma fórmula que combine RF, Haines, FMA e ARTEMIS com pesos arbitrários.
- Nenhum percentual de probabilidade. A calibração variou entre períodos (doc 27, seção 3).

## 5. IA

Resumo do doc 27 (4 800 casos reais, mesmo desenho do backtest de 18/11):
- AUC do RF oficial **0,662**, do motor ARTEMIS **0,723**. Sem fogo a até 50 km nas 24 h
  anteriores, os dois caem para 0,571 e 0,585.
- O RF oficial satura na estação seca (46 % dos casos em "crítico") e **não discriminou** na
  Caatinga, no Nordeste e no Sul (AUC ≈ 0,5).
- O modelo calibrado (logístico, separação temporal, geográfica e as duas juntas) ganha muito
  pouco sobre o motor ARTEMIS, e sua calibração muda entre períodos. **Não foi ativado.**

## 6. Mapa e alertas

**Mapa** (`client/src/components/map/FireRiskLayer.tsx`, capturas em `capturas/2026-11-28-risco-oficial/`):
- Camadas: RF observado por dia, previsão T0–T3, dias sem chuva, estações INMET (com link para a série).
- Legenda com as classes oficiais, fonte, arquivo e horário do processamento.
- Escolha entre a média e o máximo da célula de 0,2°.
- **Consulta por coordenada** com um clique.
- **Exportação** da grade em CSV com a fonte no cabeçalho.
- O desenho é feito em Mercator para as células não se deslocarem.

**Página da área** (`client/src/components/fire-risk/AreaFireRisk.tsx`):
- Série diária do RF sobre o polígono, mais a previsão, com os limites oficiais e uma tabela.
- Método e limites do índice, e o cartão do Haines.
- Aviso quando o dado tem mais de 2 dias.

**Alertas de risco oficial** (`server/services/fire-risk-alerts.ts`, tipo `risco_oficial`):

| Regra | Condição | Severidade |
|---|---|---|
| R1 persistência | RF médio da área > 0,70 nos últimos 3 dias observados consecutivos (`RISK_ALERT_DAYS`) | alto; crítico se os 2 últimos > 0,95 |
| R2 previsão | Sem R1, mas a previsão do INPE > 0,95 em algum dos próximos 3 dias | moderado |

- O texto sempre termina com: *"Condição de risco (índice meteorológico), não indica foco de calor
  nem incêndio confirmado."* Nenhum alerta de incêndio confirmado é gerado a partir de risco ou de
  foco não validado.
- Um alerta aberto por área (deduplicação), com recomendações. O e-mail segue o registro de
  entregas existente, e o tipo pode ser ligado ou desligado em Configurações → Notificações.
- Em dev, com dados reais: 9 alertas criados; uma nova execução deixou os 9 inalterados.
- **As regras não são calibradas.** Devem ser revistas com os especialistas do piloto (doc 27, seção 5).

## 7. Banco de dados (migrações)

| Migração | Conteúdo | Destrutiva? | Como reverter |
|---|---|---|---|
| 0019 | Fonte `inpe-risco-fogo`; tabelas `fire_risk_values` e `fire_risk_grids` | Não (só cria) | `DROP TABLE fire_risk_grids; DROP TABLE fire_risk_values; DELETE FROM data_sources WHERE key = 'inpe-risco-fogo';` e remover a linha de 0019 em `schema_migrations` — **apaga os dados do índice; exige autorização** |
| 0020 | Amplia os CHECK de `alerts.kind` e `notification_preferences.kinds` para incluir `risco_oficial` | Não (só amplia) | Possível só depois de encerrar/remover alertas `risco_oficial` e tirar o tipo das preferências; então recriar os CHECK com a lista anterior |

Aplicadas em dev e nos bancos de teste. **Não aplicadas em produção** (depende da sua aprovação e
do Matheus). O executor de migrações recusa migração já aplicada que tenha sido editada (checksum).

## 8. Testes (resultado em 28/11/2026)

| Suíte | Resultado |
|---|---|
| Verificação de tipos (`tsc`) e build do frontend | sem erros |
| `npm test` (motor de risco e autenticação) | 44 passaram, 0 falharam |
| Unitários (`npm run test:unit`) | 70 passaram, 0 falharam (inclui fórmula do RF, Haines e métricas estatísticas, todos com valores calculados à mão) |
| Integração com PostgreSQL real (`npm run test:integration`) | 97 passaram, 0 falharam, 4 pulados (dependem do PostGIS) |
| Python (`npm run test:python`) | 109 passaram, 0 falharam |

Resumo da execução: `evidencias/2026-11-28-ia/testes-resumo.txt`.

O teste de integração do risco oficial (`tests/integration/fire-risk.test.ts`) encontrou e
levou à correção de **dois defeitos reais**:
- A consulta por ponto dava erro 500 em célula sem dados e podia devolver o valor de outra célula
  para pontos fora da grade.
- A grade do mapa ficava deslocada quando o arquivo começava ao norte do limite do Brasil. Os
  arquivos reais do INPE não são afetados.

## 9. Segurança (checklist)

| Item | Situação |
|---|---|
| Chaves de API no frontend | Nenhuma. INPE e Open-Meteo não exigem chave; varredura do `client/` sem chaves |
| Credenciais no repositório | Nenhuma nova |
| Rotas públicas (`/api/fire-risk/*`) | Limite de 120 requisições/min, parâmetros validados (zod), SQL parametrizado, cache de 15 min |
| Rotas de área (`/api/areas/:id/fire-risk`, `/haines`) | Exigem organização; área de outra organização → 404 (testado) |
| Arquivos baixados | Limite de tamanho (pelo `content-length`), sha256 registrado, leitura num diretório temporário privado apagado ao final; arquivo com data errada ou que não é NetCDF é rejeitado (testado) |
| Concorrência | Trava consultiva no Postgres; execução interrompida é encerrada como falha na próxima |
| `npm audit` | Os mesmos 3 alertas altos conhecidos antes desta etapa; as 3 novas dependências (`h5wasm`, `netcdfjs`, `geotiff`) não acrescentaram alertas |

## 10. Integrações testadas

| Integração | Teste | Resultado |
|---|---|---|
| RF observado (NetCDF4) | Dados reais 20–22/11 em dev (721 alvos) + teste de integração com arquivo controlado | Funciona |
| RF previsto (GeoTIFF) | Dados reais T0–T3 de 23–26/11 em dev | Funciona (cerca de 48 s por arquivo) |
| Dias sem chuva | Dados reais 21–22/11 em dev | Funciona |
| Arquivos históricos do INPE (ago–nov/2026) | 12 arquivos baixados para a avaliação da IA | Funciona |
| Open-Meteo, níveis de pressão | 4 pontos reais em 24/11; cota diária esgotada em 23/11 e 28/11 → "indisponível" mostrado corretamente | Funciona, sujeito à cota gratuita |
| Servidor de documentos do INPE (`mtc-m21c.sid.inpe.br`) | Bloqueado na rede deste ambiente | Método conferido pelo Anuário 2025 |

**A sincronização periódica não foi executada na VPS.** Ela está pronta no agendador (6 em 6 h),
mas só fica "operacional" depois de rodar lá (seção 13).

## 11. Evidências para o relatório da PoV (ABDI)

| # | Evidência | Arquivo | O que comprova |
|---|---|---|---|
| E1 | Reprodução do RF oficial (16 variantes, 2 dias, 20 000 pixels/dia) | `evidencias/2026-11-23-inpe-rf/reproducao-*.json` | Que o método implementado é o do INPE (erro médio 0,016; 93 % na mesma classe) |
| E2 | Conferência independente da amostragem por área/estação | `evidencias/2026-11-23-inpe-rf/conferencia-independente-amostragem.json` | Que o valor por propriedade bate com um cálculo independente |
| E3 | Haines com dados reais de altitude | `evidencias/2026-11-24-haines/haines-openmeteo-4-pontos.json` | Cálculo com níveis de pressão, variante pela altitude |
| E4 | Avaliação retrospectiva RF × ARTEMIS × modelo calibrado | `evidencias/2026-11-28-ia/avaliacao-rf-oficial-artemis.json` | Desempenho real, por região, bioma e mês; divergência; calibração |
| E5 | Backtest do motor (18/11) | `evidencias/2026-11-18/backtest-motor.json` | Base de comparação |
| E6 | Capturas do mapa e da área com dados reais | `capturas/2026-11-28-risco-oficial/` | Interface com fonte, data, metodologia e limites |
| E7 | Testes automatizados | `tests/unit/*`, `tests/integration/fire-risk.test.ts` | Reprodutibilidade |

**O que ainda não existe como evidência** (e não deve constar como resultado): uso real por
produtores, avaliação dos alertas por especialistas, tempo até a análise medido no piloto,
desempenho contra incêndio **confirmado**, e funcionamento contínuo na VPS. As metas da PoV
seguem como **objetivos**, não como resultados.

## 12. Pendências e limitações

1. **Executar na VPS** (Matheus): aplicar 0019 e 0020, ligar `INPE_RISK_SYNC_ENABLED`, rodar uma
   carga inicial (`npm run sync:inpe-risk -- --from AAAA-MM-DD --to AAAA-MM-DD --forecast --dry-days`)
   e acompanhar alguns ciclos. Depende da sua aprovação.
2. **Haines** depende da cota gratuita do Open-Meteo. Para uso contínuo: plano pago, servidor
   próprio do Open-Meteo, ou GFS direto da NOAA.
3. **Desfecho de incêndio confirmado** para a avaliação (Sisfogo ou área queimada do INPE),
   cobrindo mais de uma estação.
4. **Regras R1/R2 não calibradas**: rever com os especialistas.
5. **Produtos do INPE ainda não integrados:** área queimada, eventos de fogo, anomalia e climatologia.
6. O limite de tamanho do download depende do cabeçalho `content-length`.
7. Vegetação da propriedade continua não observada pelo motor ARTEMIS.

## 13. Próximos passos de validação industrial (VTAQUINO)

1. **Homologação na VPS:** rodar a sincronização por 14 dias e registrar a disponibilidade
   (proporção de ciclos com sucesso, atraso em relação à publicação do INPE).
2. **Piloto com áreas reais:** registrar, por alerta `risco_oficial`, a avaliação dos especialistas
   (útil / não útil / falso), usando o módulo de avaliação que já existe.
3. **Desfecho confirmado:** cruzar alertas e índices com os ROIs do Sisfogo e com a área queimada
   do INPE, e repetir a avaliação do doc 27 com esse desfecho.
4. **Tempo até a análise:** medir no piloto, com a instrumentação já existente (doc 22).
5. **Revisão das regras** com os resultados dos itens 2 e 3, versionando as regras.
6. Só depois disso: decidir se algum modelo calibrado entra em produção, e com que rótulo.
