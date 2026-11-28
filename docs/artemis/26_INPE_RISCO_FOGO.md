# 26 — Risco de Fogo oficial do INPE e Índice de Haines

**Última atualização:** 24/11/2026 · **Situação:** integração implementada na branch científica e mesclada em `main`; componentes de UI reconstruídos e validados localmente com `tsc` e build de produção. Testes de integração com PostgreSQL e inspeção no navegador não executados neste ambiente.

## 1. O que é o produto

O **Risco de Fogo (RF)** do Programa Queimadas/INPE é um índice meteorológico de **susceptibilidade da vegetação para queimar**, de 0 a 1. Ele combina chuva dos últimos 120 dias, temperatura máxima e umidade relativa mínima às 18 UTC, tipo de vegetação, latitude e elevação. A versão implementada é a **2.2** (Setzer, 05/04/2019), com os fatores de latitude e elevação.

**Não é:** detecção de fogo, incêndio confirmado, laudo técnico, serviço de emergência nem probabilidade calibrada de ocorrência. Foco de satélite, risco meteorológico e incêndio confirmado são três coisas diferentes.

Classes oficiais (Anuário Risco de Fogo 2025, Tabela 3.1):

| Classe | Intervalo |
|---|---|
| Mínimo | RF ≤ 0,15 |
| Baixo | 0,15 < RF ≤ 0,40 |
| Médio | 0,40 < RF ≤ 0,70 |
| Alto | 0,70 < RF ≤ 0,95 |
| Crítico | RF > 0,95 |

Fontes e referências usadas na implementação:

- Script operacional publicado pelo INPE: `https://dataserver-coids.inpe.br/queimadas/queimadas/outros/rf/script/rf_previsto_1-5dias_2023.sh`
- Processo QMD003-2000-PRO-001-A (INPE, 2024–2025).
- Anuário Risco de Fogo 2025, seção 2.2 e Tabela 3.1.
- Produtos diários: NetCDF observado e GeoTIFF previsto (T0–T3) em `dataserver-coids.inpe.br/queimadas/queimadas/riscofogo_meteorologia/`.
- Dados abertos: `https://terrabrasilis.dpi.inpe.br/queimadas/portal/pages/secao_downloads/dados-abertos/index.html`.

A implementação pura está em `shared/inpe-fire-risk.ts`. A reconstrução independente contra a grade publicada pelo INPE e as ressalvas sobre a unidade da umidade estão registradas em `docs/artemis/evidencias/2026-11-23-inpe-rf/`.

## 2. Dados gravados

As migrações `0019_fire_risk_indices.sql` e `0020_alert_kind_official_risk.sql` acrescentam:

- `fire_risk_values`: um valor por `(índice, produto, alvo, dia, lead)`, com média/máx/mín, classe, pixels válidos/totais, método, arquivo de origem e hash.
- `fire_risk_grids`: grade grosseira de 0,2° com média e máximo dos pixels de 1 km por célula, para o mapa.
- Novo tipo de alerta para **condição de risco persistente**, explicitamente distinto de alerta por foco detectado.

Nenhuma linha é apagada por uma sincronização repetida: a ingestão é idempotente e registra falhas em `source_sync_runs`.

## 3. API

| Rota | Uso |
|---|---|
| `GET /api/fire-risk/available` | índices, produtos, leads e dias disponíveis; método e limitações |
| `GET /api/fire-risk/grid?index&product&day&lead` | grade 0,2° para o mapa e exportação CSV |
| `GET /api/fire-risk/point?lat&lng[&day]` | valor da célula que contém um ponto; fora da grade retorna sem valor |
| `GET /api/areas/:id/fire-risk?from&to` | série observada calculada sobre o polígono da área + previsão, restrita à organização |
| `GET /api/areas/:id/haines` | índice de Haines para a área, ou `indisponivel` com o motivo |

As rotas de área usam `requireOrg()`: uma organização não lê os valores da outra.

## 4. Interface reconstruída

- `client/src/components/map/FireRiskLayer.tsx`: camada em uma única `canvas`, reprojetada para Mercator pelo Leaflet; desenha só as células visíveis, legenda com classes e limites, escolha de produto/data/antecedência, consulta por clique na célula e exportação CSV da grade.
- `client/src/components/area/AreaFireRisk.tsx`: série da propriedade com observado em linha contínua e previsto em tracejada, linhas de referência dos limites oficiais, tabela alternativa e cartão de Haines.
- Integrações: `client/src/pages/EnvironmentalMap.tsx` e `client/src/pages/AreaDetail.tsx`.

A camada de dias sem chuva usa faixas de leitura da ARTEMIS (0–15, 16–30, 31–60, 61–90, > 90 dias), **não** classes oficiais; a legenda diz isso explicitamente.

## 5. Índice de Haines

Calculado segundo Haines (1988) com temperatura e ponto de orvalho **em níveis de pressão** (950/850, 850/700 ou 700/500 hPa), nunca com valores de superfície. A variante é escolhida pela elevação do local. Quando a elevação ou os níveis faltam, a resposta é `indisponivel` com o motivo — nenhum número é inventado.

Os valores vêm de dados de **modelo numérico** (Open-Meteo, família GFS), não de radiossonda. O índice indica o potencial de **crescimento de um incêndio já iniciado**; não mede risco de ignição. Referência brasileira: Melo, Justino, Melo & Silva (2012), *Mercator* 11(24): 187–207, DOI 10.4215/RM2012.1124.0012. Evidência de consulta real em quatro cidades: `docs/artemis/evidencias/2026-11-24-haines/haines-openmeteo-4-pontos.json`.

## 6. Operação no Compose

A API já executa a sincronização do risco oficial a cada `INPE_RISK_SYNC_HOURS` (padrão 6 h; `INPE_RISK_SYNC_ENABLED=false` desativa) e avalia alertas de risco persistente logo em seguida. Para carga inicial, backfill ou cron explícito, o Compose expõe o job `inpe-risk-sync` (binário gerado por `script/build.ts`):

```bash
docker compose --profile jobs run --rm inpe-risk-sync
docker compose --profile jobs run --rm inpe-risk-sync node dist/sync-inpe-risk.cjs --from 2026-08-01 --to 2026-11-22
```

As variáveis `INPE_RISK_SYNC_ENABLED`, `INPE_RISK_SYNC_HOURS`, `APP_URL` e todas as obrigatórias estão documentadas em `.env.example`. O job usa o papel `artemis_app` (sem DDL) e a rede `edge` para acessar os arquivos públicos do INPE.

## 7. Limitações e pendências

- O RF observado publicado pelo INPE sofre correção por focos dos 3 dias anteriores; essa etapa não é reproduzida pela ARTEMIS.
- A resolução é de 1 km, mas as entradas meteorológicas vêm de GFS (25–50 km) e IMERG (10 km) interpolados; o mapa mostra uma célula de 0,2° com média e máximo.
- O valor exibido no mapa é da célula; para uma propriedade cadastrada, use o valor calculado sobre o polígono na página da área.
- O risco oficial ainda **não** entra como variável do motor 1.1.0 nem foi calibrado com incêndios reais das áreas-piloto (Fase 4 pendente).
- `npm run check` e `npm run build` passaram com Node 26 portátil; `npm test` 44/44 e `npm run test:unit` 66/67 (a falha é o teste de paridade Python, bloqueado pelo atalho `python` da Microsoft Store neste Windows). Inspeção visual no navegador e testes de integração com PostgreSQL seguem pendentes.
