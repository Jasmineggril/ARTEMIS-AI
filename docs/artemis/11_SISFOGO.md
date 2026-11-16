# 11 — Sisfogo (Ibama/Prevfogo): leitura da API pública de ROI

> **Situação (16/11/2026):** implementado e testado com respostas simuladas.
> **Não verificado contra a API real** — o host `sisfogo.sistema.gov.br` é
> bloqueado pela rede do ambiente de desenvolvimento. Primeira tarefa no
> servidor: `docker compose run --rm sisfogo-sync node dist/sync-sisfogo.cjs --max-pages 1`
> e conferir o resultado (seção 5).

## 1. O que é

Registros de Ocorrência de Incêndio (ROI) **finalizados** publicados pelo
Ibama/Prevfogo no Sisfogo (Lei nº 14.944/2024). Segundo a documentação do
Ibama, os dados são anonimizados e cobrem apenas os órgãos que aderiram ao
Sisfogo. Não é convênio, nem acesso privilegiado, nem integração com o
sistema interno do Ibama: a ARTEMIS AI só **lê** o endpoint público.

| Item | Valor (conforme documentação do Ibama) |
|---|---|
| Endpoint | `GET https://sisfogo.sistema.gov.br/api/v1/roi/publico?page=<1..>&size=<1..500>` |
| Homologação | `https://sisfogo.hom.ibama.gov.br` (use `SISFOGO_BASE_URL`) |
| Autenticação | nenhuma |
| Limite | 10 req/s; o conector faz no máximo ~7 req/s (150 ms entre páginas) |
| Formato da página | `{ pagina, tamanhoPagina, totalItens, totalPaginas, itens: [...] }` |

Origem: branch `feature/sisfogo-integration` (conector, documentação de
acesso e testes). Foi adaptado para o esquema atual — a branch criava suas
próprias migrações 0004–0007, incompatíveis com as já aplicadas.

## 2. Onde os dados ficam

Tabela própria `sisfogo_roi_records` (migração `0010_sisfogo_roi.sql`, aditiva):
registros oficiais não pertencem a uma organização, então não vão para
`fire_occurrences`. Chave única `(source_id, external_id)` = UUID do ROI.
Cada execução fica em `source_sync_runs` (fonte `sisfogo-roi`).

| Campo do ROI | Coluna |
|---|---|
| `id` | `external_id` |
| `numeroRoi`, `statusRoi`, `retificado` | `roi_number`, `roi_status`, `rectified` |
| `dataInicioIncendio` | `started_on` (data) + `started_local_time` (HH:MM) |
| `dataDeteccaoIncendio`, `dataExtincaoIncendio` | `detected_on`, `extinguished_on` |
| `localIncendio.latitude/longitude` | `latitude`, `longitude` |
| `localIncendio.municipio.nomeMunicipio` | `municipality` |
| `…unidadeFederativa.siglaUnidadeFederativa` | `state` |
| `localIncendio.bioma.nomeBioma` | `biome` |
| `informacoesPosIncendio.estimativaAreaQueimada` | `burned_area_ha` |
| `informacoesPosIncendio.vegetacoesAtingidas[].vegetacao` | `vegetation` (separado por `; `) |
| registro completo | `raw` |

Regras (nada é inventado):
- As datas vêm sem fuso horário; guardamos data e hora **locais como publicadas**, sem converter para UTC.
- Valor fora da faixa (coordenada, área negativa, UF inválida, data impossível) vira `NULL` e é contado em `rejection_reasons` como `campo_descartado:*`.
- Sem `id` → rejeitado. `statusRoi` diferente de `FINALIZADO` → rejeitado.
- Resposta sem `itens`/`totalPaginas` → a execução falha com os nomes dos campos recebidos (para ajustar o mapeamento).
- ROI retificado (conteúdo diferente) atualiza a linha; conteúdo igual não é regravado.
- Cada página é uma transação: se a página N falhar, as anteriores ficam gravadas e a execução é marcada `falha` com a página. Rodar de novo é seguro.

## 3. Como rodar

```bash
npm run sync:sisfogo -- --max-pages 1      # desenvolvimento: confere 1 página
docker compose run --rm sisfogo-sync       # produção (perfil jobs)
```

Agendamento sugerido (cron do host, 1×/dia, fora do horário de pico):

```
17 3 * * * cd /opt/artemis && docker compose run --rm sisfogo-sync >> /var/log/artemis-sisfogo.log 2>&1
```

Limite padrão: 2.000 páginas × 500 = 1 milhão de registros por execução
(`--max-pages` ajusta). Não há download em massa; a paginação é o meio oficial.

## 4. Onde aparece

- **Consulta Pública** (`/consulta-publica`): painel "Registros oficiais de incêndio — Sisfogo", com os mesmos filtros de UF, município e período; total, área queimada estimada, período e os 20 mais recentes. Sem sincronização, mostra "ainda não sincronizado".
- **Fontes de dados**: a fonte `sisfogo-roi` aparece com status "em integração" e o resultado da última execução.
- API: `GET /api/public/sisfogo/summary?state=&municipality=&from=&to=`.

## 5. Checklist da primeira execução real

1. `--max-pages 1` termina com `"status":"sucesso"` e `read` > 0.
2. Se falhar com "fora do formato documentado", anotar os campos listados e ajustar `parseSisfogoPage`/`normalizeRoi` em `server/connectors/sisfogo.ts`.
3. Conferir `rejection_reasons` da execução: muitos `campo_descartado:*` indicam mapeamento errado.
4. Salvar uma página real (sem dados pessoais — a API já é anonimizada) em `tests/fixtures/` no lugar da sintética.
5. Só então mudar `data_sources.status` para `ativo` e `integration_status` para "verificado".

## 6. Testes

- `tests/unit/sisfogo.test.ts`: URL, mapeamento, descartes, formato da página.
- `tests/integration/api.test.ts` ("Sisfogo sync…"): falha HTTP, formato inesperado, idempotência, ROI retificado, limite de páginas, resumo público e filtros inválidos.
