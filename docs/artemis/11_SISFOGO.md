# 11 — Sisfogo (Ibama/Prevfogo): leitura da API pública de ROI

> **Situação (16/11/2026):** contrato **verificado com consultas reais** à API
> pública e primeira **sincronização completa real** concluída no ambiente de
> desenvolvimento (1.698 ROIs, 85 páginas, 0 rejeitados, 0 novas tentativas,
> 4 min 17 s). Ainda **não** executado na VPS (ver `14_HOMOLOGACAO_HOSTINGER.md`).

## 1. O que é — e o que não é

Registros de Ocorrência de Incêndio (ROI) **finalizados** publicados pelo
Ibama/Prevfogo no Sisfogo (Lei nº 14.944/2024). Cobrem apenas os órgãos que
aderiram ao Sisfogo; ROIs em andamento ou em retificação não aparecem.

A ARTEMIS AI **só lê** o endpoint público com `GET`. Não há convênio, credencial,
acesso privilegiado nem envio de dados ao sistema do Ibama.

## 2. Contrato verificado (consultas de leitura em 16/11/2026)

| Item | Documentação | Observado na API real |
|---|---|---|
| Endpoint | `GET /api/v1/roi/publico?page=&size=` | igual; `200 application/json` |
| Saúde | `/api/v1/roi/actuator/health/readiness` | `{"status":"UP"}` |
| Autenticação | nenhuma | nenhuma |
| Envelope | `pagina, tamanhoPagina, totalItens, totalPaginas, itens` | igual |
| Página | inicia em 1 | `page=0` responde igual a `page=1`; página além do fim → `200` com `itens: []` |
| Ordem | — | **mais recente primeiro** (inclusões durante a leitura deslocam as páginas) |
| Tamanho | até 500 | `size=20` ≈ 3–18 s; `size=50` ≈ 51 s; **`size ≥ 100` → HTTP 502** (gateway, 60 s). Usamos 20 (máx. configurável 50) |
| Limite | 10 req/s | irrelevante na prática: a lentidão do servidor domina |
| Datas | — | **aninhadas em `datasIncendio`** e com `Z` (instantes UTC). Ex.: `meiosLocomocao…[].data = …T03:00:00Z` = meia-noite de Brasília, coerente com UTC real |
| Campos ausentes | — | **omitidos** (não vêm como `null`) |

Campos e presença (1.698 ROIs, sincronização completa):

| Campo do ROI | Coluna (`sisfogo_roi_records`) | Presença |
|---|---|---|
| `id` (UUID) | `external_id` | 100 % |
| `numeroRoi`, `statusRoi`, `retificado` | `roi_number`, `roi_status`, `rectified` | 100 % (`retificado=true` em 158) |
| `instituicaoResponsavel.nome/sigla` | `institution_name/acronym` | 100 % |
| `dataHoraCriacao`, `dataHoraUltimaAtualizacao` | `source_created_at`, `source_updated_at` | 100 % |
| `datasIncendio.dataInicioIncendio` | `started_at` | 100 % |
| `…dataDeteccaoIncendio` | `detected_at` | 100 % |
| `…dataInicioDeslocamento`, `…dataPrimeiroAtaque` | `dispatch_at`, `first_attack_at` | só quando houve combate |
| `…dataControleIncendio` | `controlled_at` | 1.444 |
| `…dataExtincaoIncendio` | `extinguished_at` | 1.643 |
| `localIncendio.latitude/longitude` | `latitude`, `longitude` | 100 % (todas dentro do Brasil) |
| `…municipio.nomeMunicipio`, `…siglaUnidadeFederativa` | `municipality`, `state` | 100 % |
| `localIncendio.bioma.nomeBioma` | `biome` | 100 % |
| `…tipoLocalidade.localidade` | `locality_type` | 1.672 |
| `…classificacaoArea.area`, `isAmazoniaLegal`, `nivelAcionamentoRoi` | `area_classification`, `legal_amazon`, `response_level` | 100 % |
| `houveCombate` | `had_combat` | 100 % |
| `informacoesPosIncendio.estimativaAreaQueimada` (ha) | `burned_area_ha` | **368 (22 %)** — estimativa informada, não medição |
| `…vegetacoesAtingidas[]`, `…estruturasAtingidas[]` | `vegetation`, `structures_hit` | 100 % |
| `localIncendio.nomeLocal` (texto livre) | `place_name` | guardado, **nunca exibido** (nomes de aldeias, povoados, propriedades) |
| registro completo | `raw` + `source_record_revisions.raw` | — |

Cobertura observada: início entre 04/01/2026 e 14/11/2026; UF com mais ROIs: AM 356, MA 279, MT 208, PA 200;
biomas: Amazônia 973, Cerrado 562, Caatinga 111, Mata Atlântica 30, Pantanal 22. Instituição: 100 % PREVFOGO
— reforça que a base **não** representa todos os incêndios do país.

Amostra de contrato: `tests/fixtures/sisfogo-roi-real.json` (3 ROIs reais; nomes de local substituídos).

## 3. Modelo de dados (migrações 0010 e 0011, aditivas)

```
sisfogo_roi_records      espelho da versão atual de cada ROI (todos os campos do Sisfogo + JSON original)
source_record_revisions  cada versão distinta publicada (novo, retificado, atualizado) — nada é sobrescrito sem histórico
fire_occurrences         ocorrência canônica, consultável por mapas e motor de risco:
                           organization_id NULL, import_batch_id NULL,
                           data_source_id = sisfogo-roi, external_id = UUID do ROI (único),
                           occurred_at = início (UTC), occurrence_date/time = horário de Brasília,
                           source = "Sisfogo (Ibama/Prevfogo)", source_reference = número do ROI,
                           source_available = false enquanto a fonte deixar de publicá-lo
source_sync_runs         cada execução: modo, gatilho, quem disparou, páginas, contagens, motivos, progresso, erro
```

Regra no banco (`fire_occurrences_provenance_ck`): ou é registro de organização (com organização **e** lote),
ou é registro oficial (sem organização, sem lote, com fonte **e** identificador). As consultas de organização
filtram `organization_id = <org>`, então registros oficiais nunca se misturam aos dados privados.

`v_fire_events` lista três origens separadas: `ocorrencia_importada`, `foco_satelite` (INPE) e
`registro_oficial` (Sisfogo). Nada é somado: um ROI e um foco podem ser o mesmo incêndio.

## 4. Sincronização

| Situação do ROI | O que acontece |
|---|---|
| novo | espelho + revisão 1 + `fire_occurrences` |
| já importado, mesmo conteúdo (hash SHA-256 do JSON canônico) | só "visto nesta execução" |
| conteúdo mudou e `retificado = true` | **retificado**: revisão N+1, espelho e ocorrência atualizados, versão anterior preservada |
| conteúdo mudou sem `retificado` | **atualizado**: idem |
| inválido (sem UUID, UUID malformado, sem número, não `FINALIZADO`, sem data de início com fuso) | contado por motivo; nada é gravado |
| valor fora de faixa (coordenada fora do Brasil ou incompleta, área negativa, UF inválida, data impossível) | o **campo** vira `NULL` (nunca 0) e é contado como `campo_descartado:*` |
| sumiu de uma execução **completa** | **indisponível**: `unavailable_since` + `source_available = false`; nunca apagado; volta sozinho se reaparecer |

Proteções:
- uma execução por vez (`pg_try_advisory_lock`); outra tentativa recebe "em andamento" (CLI sai com 75, painel com 409);
- uma transação por página; só a página atual fica em memória;
- progresso gravado a cada página; `--resume` continua da página seguinte à última gravada;
- execução interrompida (processo morto) é fechada como `falha` pela execução seguinte;
- timeout de 120 s por requisição, até 4 tentativas com espera crescente (5 s, 15 s, 45 s ± 20 %), respeitando `Retry-After` em 429; 4xx e resposta fora do contrato **não** são repetidos;
- se mais de 20 % (e mais de 5) dos ROIs sumirem numa execução completa, nada é marcado como indisponível (provável falha da fonte) e a execução registra a observação;
- só uma execução **completa** que leu até o fim pode marcar indisponibilidade e tornar a integração "operacional".

Modos:

```bash
npm run sync:sisfogo                          # incremental: para após 2 páginas sem novidades
npm run sync:sisfogo -- --mode completa       # lê todas as páginas
npm run sync:sisfogo -- --resume              # continua uma execução que falhou
npm run sync:sisfogo -- --max-pages 1         # verificação rápida
```

Produção: `docker compose --profile jobs run --rm sisfogo-sync` (incremental diário) e semanal com
`--mode completa` — linhas de cron em `04_IMPLANTACAO_HOSTINGER.md` §7. Resultados reais em dev:
completa 1.698/1.698 em 4 min 17 s; incremental seguinte: 2 páginas, 40 inalterados, nada regravado.

## 5. Onde aparece

| Lugar | O quê |
|---|---|
| **Fontes de Dados** | estado (operacional só após sincronização completa real), contagens, última completa e última bem-sucedida, histórico das 15 últimas execuções com novos/atualizados/retificados/inválidos/indisponíveis e erros. Administradores da plataforma veem "Buscar novos registros" e "Sincronização completa". |
| **Mapa Ambiental** | camada própria (laranja), agrupada, com filtros e data da última sincronização completa |
| **Consulta Pública** | painel com totais, área queimada estimada e os 20 mais recentes (sem nome de local) |
| **Análise de risco** | ver §6 |

API: `GET /api/public/sisfogo/summary`, `GET /api/public/sisfogo/points`,
`GET /api/connectors/sisfogo/status` (autenticado), `POST /api/admin/connectors/sisfogo/sync` (administrador da plataforma) — ver `03_API.md`.

## 6. Uso no motor de risco

`historicalOccurrences` = ocorrências da própria organização num raio de 10 km (todo o período importado)
**+** ROIs oficiais do Sisfogo no mesmo raio, quando:
- `RISK_USE_SISFOGO` não é `false` (padrão: ligado), e
- já houve uma sincronização completa real.

Um ROI que a organização já importou (mesmo número de ROI, ou mesma data a até 1 km) não é contado de novo.
Focos do INPE **não** entram nesta contagem (alimentam a variável separada "foco próximo").
Pesos, fórmulas e limiares do motor **não mudaram**; muda apenas o que alimenta a contagem.

Cada análise grava em `risk_analysis_sources`: fonte, raio, período (`first`–`last`), quantidade,
duplicatas descartadas e data da última sincronização completa; as limitações da análise descrevem a
composição e a cobertura parcial do Sisfogo.

## 7. Testes

- `tests/unit/sisfogo.test.ts` — contrato real (3 ROIs), datas aninhadas e fusos, campos ausentes, coordenadas, área, hash, envelope, SSRF, 429/502/timeout/retentativas, backoff.
- `tests/integration/sisfogo.test.ts` — banco real: indisponibilidade da fonte, contrato inválido, primeira carga, reimportação, retificação com histórico, indisponível/reaparece, proteção contra falha da fonte, incremental e limites, falha no meio + `--resume`, rollback de página, concorrência e execução interrompida, isolamento entre organizações, endpoints (permissões, auditoria), resumo público, camada do mapa (com e sem PostGIS) e proveniência no motor de risco.

## 8. Pendências

- Executar a primeira sincronização completa **na VPS** e registrar o resultado (`14_HOMOLOGACAO_HOSTINGER.md`).
- Confirmar com o Ibama as condições de reutilização para uso comercial (a documentação cita LAI e Lei nº 14.944/2024, mas não traz licença explícita).
- Os campos de combate (`combateRecursosHumanos`, `frentesCombate`, meios de locomoção) ficam só no JSON original; não são usados.
