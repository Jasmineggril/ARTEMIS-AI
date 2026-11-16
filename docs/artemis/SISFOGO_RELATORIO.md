# ARTEMIS AI — Relatório da Integração Sisfogo

## 1. Diagnóstico do acesso oficial
- **Órgão responsável:** Ibama (Prevfogo).
- **API oficial confirmada:** Sisfogo — Registro de Ocorrência de Incêndio Florestal (ROI).
- **Endpoint de produção:** `https://sisfogo.sistema.gov.br/api/v1/roi/publico`
- **Autenticação:** nenhuma (API externa, somente leitura).
- **Rate limit:** 10 req/s (pico 20 simultâneas).
- **Paginação:** `page` (1-based) e `size` (máx. 500).
- **Dados:** somente ROIs finalizados, anonimizados.
- **Documentado em:** `docs/artemis/SISFOGO_FONTES_E_ACESSO.md`.

## 2. Implementação realizada

### Conector
- Arquivo: `server/connectors/sisfogo.ts`.
- Funções: `fetchSisfogoPage`, `checkSisfogoHealth`, `normalizeRoi`, `buildSisfogoUrl`.
- Normalização de campos ROI → `fire_occurrences`.
- Validação de coordenadas e área; registros inválidos são marcados e contados.

### Serviço de sincronização
- Arquivo: `server/services/sisfogo-sync.ts`.
- Orquestra paginação, normalização, persistência transacional.
- Cria `import_batch` (sourceType = "sisfogo-api") e `fire_occurrences` (organization_id = NULL).
- Deduplicação via `dedup_key = "sisfogo:" + numeroRoi`.
- Atualiza `source_sync_runs` com status e contagens.
- Atualiza `data_sources` (status "ativo").

### Migração
- `migrations/0007_sisfogo_sync.sql`: tabela `source_sync_runs` + correção de dedup global (COALESCE) + índice por fonte/referência.

### Rotas
- `POST /api/sync/sisfogo` (platform_admin) — dispara sincronização.
- `GET /api/source-sync-runs` — lista histórico de sincronizações.
- `GET /api/connectors` — Sisfogo com status "implementado".

### Documentação
- `docs/artemis/SISFOGO_FONTES_E_ACESSO.md`
- `docs/artemis/SISFOGO_INTEGRACAO.md`
- `docs/artemis/SISFOGO_TESTES.md`

## 3. Testes executados

| Comando | Resultado |
|---------|-----------|
| `npm run check` | ✅ 0 erros |
| `npm run test:unit` | ✅ 17/17 (inclui 3 testes Sisfogo) |
| `npm run test:integration` | ✅ 30/30 (com migração 0007) |

## 4. Limitações
- Apenas ROIs finalizados (sem dados em andamento).
- Dados anonimizados (sem causa, observações, justificativas, anexos).
- Abrangência restrita aos órgãos aderentes ao Sisfogo.
- Estimativa de área queimada não é medição precisa.
- Coordenadas referem-se ao local do incêndio.

## 5. Próximos passos
- Executar sincronização real em ambiente de desenvolvimento (requer conectividade com sisfogo.sistema.gov.br).
- Validar volume e qualidade dos dados importados.
- Implementar consultas e mapas com camadas independentes (ocorrências, focos INPE, áreas, análises).
- Integrar histórico às análises de risco com proveniência.
- Criar testes de integração específicos para o fluxo Sisfogo.