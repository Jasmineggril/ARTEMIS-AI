# 13 — Relatório de segurança: integrações Sisfogo e INPE

Escopo: o que mudou na consolidação (`integration/artemis-sisfogo-inpe`). Os controles anteriores
(sessões, CSP, origem, limites, papéis por organização, auditoria, backups) continuam valendo e são
descritos em `02_ARQUITETURA.md` e `10_BANCO_MANUTENCAO_SEGURANCA.md`.

## 1. Fonte externa (Sisfogo)

| Risco | Controle | Onde |
|---|---|---|
| Escrita no sistema do governo | Só `GET`; nenhuma rota envia dados ao Sisfogo | `server/connectors/sisfogo.ts` |
| SSRF por configuração | `SISFOGO_BASE_URL` só aceita `https://sisfogo.sistema.gov.br` ou `https://sisfogo.hom.ibama.gov.br`, sem porta, usuário ou senha; redirecionamentos recusados (`redirect: "error"`) | `sisfogoBaseUrl()`; teste com IP de metadados, subdomínio enganoso, http, porta |
| Resposta maliciosa ou enorme | Limite de 20 MB por página; JSON estrito; envelope validado; texto livre nunca interpretado como HTML | `defaultFetchJson`, `parseSisfogoPage` |
| Sobrecarga da fonte | Uma execução por vez, 1 s entre páginas, páginas de 20, até 4 tentativas com espera crescente, respeita `Retry-After` | `sisfogo-sync.ts` |
| Disparo abusivo | Sincronização manual só para administrador da plataforma (verificado no banco a cada requisição), 3 por minuto, trava contra concorrência (409), registrada em `audit_logs` (`sisfogo.sync.iniciada`) | `server/sisfogo-routes.ts` |
| Dados falsos ou incoerentes | Registro sem UUID válido, sem número, não finalizado ou sem data com fuso é rejeitado; valores fora de faixa viram `NULL` | `normalizeRoi` |
| Sumiço em massa por falha da fonte | Não marca indisponibilidade se > 20 % (e > 5) somem; nada é apagado | `syncSisfogo` |

## 2. Dados e privacidade (LGPD)

- O Sisfogo publica ROIs anonimizados (sem nome, CPF, contato, causa ou observações). Verificado na amostra de 1.698 ROIs: nenhum campo de identificação pessoal.
- `localIncendio.nomeLocal` e `subTipoLocalidade` são texto livre (aldeias, povoados, propriedades): **armazenados, nunca expostos** pelas APIs públicas nem pelo mapa (teste automatizado).
- O JSON original fica em `sisfogo_roi_records.raw` e em cada revisão. **Pendente:** definir com você a retenção das revisões antigas (hoje: indefinida; ~8 MB para 1.698 ROIs).
- Registros oficiais têm `organization_id NULL` e uma `CHECK` impede misturar origem: não aparecem em consultas de nenhuma organização, e dados privados de uma organização nunca são lidos para outra (teste: o motor de risco ignora o registro de outra organização no mesmo ponto).
- A fixture de teste usa 3 ROIs reais com os nomes de local substituídos.

## 3. Banco de dados

- Sincronização roda com `artemis_app` (só DML); migrações com `artemis_owner` (`MIGRATION_DATABASE_URL`). A trava usa `pg_try_advisory_lock`, que não exige privilégio extra.
- Novas tabelas recebem permissões pelos privilégios padrão do `artemis_owner` (initdb).
- Consultas parametrizadas; o único valor interpolado (coordenadas no histórico de risco) passa por `Number.isFinite` antes.
- Executor de migrações: recusa numeração duplicada, BOM e codificação corrompida; falha se uma migração aplicada for editada (checksum SHA-256); CLI recusa opções desconhecidas.
- 0011 é aditiva; foi aplicada primeiro numa cópia restaurada com impressão digital dos dados idêntica.

## 4. API

| Rota | Acesso | Observação |
|---|---|---|
| `GET /api/public/sisfogo/summary` | público, 60/min | sem nome de local; dados que a fonte publica hoje |
| `GET /api/public/sisfogo/points` | público, 60/min | `bbox` validado; `limit` ≤ 5.000; paginação |
| `GET /api/connectors/sisfogo/status` | autenticado | sem JSON bruto; erros da fonte sem credenciais (não há credenciais) |
| `POST /api/admin/connectors/sisfogo/sync` | administrador da plataforma | corpo `{mode}` estrito; 202/409; auditado |

Entradas validadas com zod (UF da lista oficial, datas ISO, `bbox` com faixas e ordem). Respostas de erro não expõem pilha.

## 5. Logs

JSON por linha (`sync_start`, `page`, `retry`, `unavailable_skipped`, `sync_end`): página, contagens, tentativas, motivo.
Sem credenciais (a API não usa nenhuma), sem conteúdo de registros. Falha inesperada da sincronização em segundo plano gera `sync_crashed`.

## 6. Rede (Docker/VPS)

O job `sisfogo-sync` e a `api` precisam de saída HTTPS para `sisfogo.sistema.gov.br` (rede `edge`); o banco continua só
na rede `internal`, sem porta publicada.

## 7. Pendências de segurança

- Retenção das revisões e do JSON original (decisão sua).
- Confirmar termos de reutilização com o Ibama antes de uso comercial.
- Monitorar `source_sync_runs` com status `falha` (sugestão de consulta em `14_HOMOLOGACAO_HOSTINGER.md`).
