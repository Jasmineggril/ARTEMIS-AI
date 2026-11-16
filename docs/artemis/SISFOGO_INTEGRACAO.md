# ARTEMIS AI — Integração Sisfogo (ROI)

## 1. Visão geral
A integração utiliza a **API pública oficial** do Sisfogo (Ibama/Prevfogo) para Registros de Ocorrência de Incêndio (ROI). Não há autenticação, scraping ou acesso não autorizado.

- Endpoint: `https://sisfogo.sistema.gov.br/api/v1/roi/publico`
- Rate limit: 10 req/s (conector usa 120 ms entre páginas).
- Paginação: `page` (1-based) e `size` (máx. 500).
- Somente ROIs finalizados e anonimizados.

## 2. Arquitetura
```
Sisfogo API → server/connectors/sisfogo.ts (fetch + normalização)
           → server/services/sisfogo-sync.ts (orquestração, transação)
           → import_batches (sourceType = "sisfogo-api")
           → fire_occurrences (organization_id = NULL, dados públicos)
           → consultas/mapas/relatórios
```

Dados do Sisfogo são armazenados em `fire_occurrences` com `organization_id = NULL` (globais/públicos), distintos das importações manuais (org-scoped). Focos de satélite do INPE permanecem em fluxo independente (não misturados).

## 3. Deduplicação
- `dedup_key = "sisfogo:" + numeroRoi (ou id)`.
- Índice único parcial em `(COALESCE(organization_id, 0), dedup_key)`.
- Reimportação não cria duplicidades; registros já existentes são ignorados (`ON CONFLICT DO NOTHING`).

## 4. Rotas
- `POST /api/sync/sisfogo` — somente `platform_admin`. Dispara sincronização.
- `GET /api/source-sync-runs` — lista histórico de sincronizações.
- `GET /api/connectors` — inclui Sisfogo com status "implementado".

## 5. Campos mapeados (ROI → fire_occurrences)
| Destino | Origem | Transformação |
|---------|--------|---------------|
| occurrenceDate | dataInicioIncendio/dataDeteccaoIncendio/dataExtincaoIncendio | Extrai YYYY-MM-DD |
| occurrenceTime | dataInicioIncendio/dataDeteccaoIncendio | Extrai HH:MM |
| municipality | localIncendio.municipio.nomeMunicipio | Direto |
| state | localIncendio.municipio.unidadeFederativa.siglaUnidadeFederativa | Direto |
| latitude/longitude | localIncendio.latitude/longitude | Validação de faixa |
| occurrenceType | — | Fixo "incêndio florestal" |
| occurrenceStatus | statusRoi | Direto (sempre FINALIZADO) |
| affectedArea | informacoesPosIncendio.estimativaAreaQueimada | Direto (ha) |
| cause | — | null (anonimizado) |
| vegetationCondition | informacoesPosIncendio.vegetacoesAtingidas | Junção com ";" |
| source | — | "sisfogo" |
| sourceReference | numeroRoi ou id | Direto |
| rawData | ROI completo | Preservado para auditoria |

## 6. Proveniência
Cada análise de risco pode consultar ocorrências do Sisfogo como fonte identificável (`source = "sisfogo"`). A proveniência registra fonte, período consultado e quantidade de registros.

## 7. Limitações
- Apenas ROIs finalizados (sem dados em andamento).
- Dados anonimizados (sem causa, observações, justificativas, anexos).
- Abrangência restrita aos órgãos aderentes ao Sisfogo.
- Estimativa de área queimada não é medição precisa.
- Coordenadas referem-se ao local do incêndio.