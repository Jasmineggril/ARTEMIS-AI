# ARTEMIS AI — Testes da Integração Sisfogo

## 1. Testes unitários do conector
- `normalizeRoi`: valida extração de data, hora, município, UF, coords, área, vegetação.
- `normalizeRoi`: marca inválido para lat/long fora de faixa e área negativa.
- `buildSisfogoUrl`: gera URL com page/size corretos e limita size a 500.
- `fetchSisfogoPage`: trata erro HTTP e resposta sem `itens`.

## 2. Testes de integração (a executar com PostgreSQL real)
- Sincronização cria `import_batch` com `sourceType = "sisfogo-api"`.
- Ocorrências são persistidas com `source = "sisfogo"` e `organization_id = NULL`.
- Reexecução da sincronização não cria duplicidades (dedup_key).
- `source_sync_runs` registra status, contagens e timestamps.
- Consulta por município/estado/período retorna dados do Sisfogo.
- Isolamento: dados do Sisfogo (globais) visíveis a usuários autenticados; dados privados de importação permanecem org-scoped.
- Proveniência em análise de risco inclui fonte "sisfogo" quando consultada.

## 3. Testes de resiliência
- Rate limit respeitado (120 ms entre páginas).
- Falha de rede registra sync run como "failed" com mensagem.
- Resposta malformada não persiste dados parciais (transação).
- Página vazia encerra a paginação.

## 4. Testes existentes reexecutados
- `npm run check` — 0 erros.
- `npm run test:risk` — 34/34.
- `npm run test:auth` — 10/10.
- `npm run test:unit` — 14/14.
- `npm run test:integration` — 30/30 (com migração 0007).