# ARTEMIS AI — Relatório de Testes (Fase de Validação do PostgreSQL)

## Ambiente
- PostgreSQL 17.12 (binários portáveis), encoding UTF8, locale C.
- Node.js v24.12.0.
- Branch: `db/postgres-hostinger-dev`.
- Banco de testes: `artemis_test` (reset via `DROP SCHEMA public CASCADE` antes de cada execução).

## Migrações aplicadas (dev/test)
| Arquivo | Status |
|---------|--------|
| 0000_initial_schema.sql | ✅ |
| 0001_add_property_profile_to_users.sql | ✅ |
| 0002_artemis_core.sql | ✅ |
| 0003_public_batches.sql | ✅ |
| 0004_integrity_indexes.sql | ✅ |
| 0005_occurrence_dedup.sql | ✅ |
| 0006_occurrence_typed_date.sql | ✅ |

## Testes executados
| Comando | Resultado |
|---------|-----------|
| `npm run check` | ✅ 0 erros TypeScript |
| `npm run test:risk` | ✅ 34/34 |
| `npm run test:auth` | ✅ 10/10 |
| `npm run test:unit` | ✅ 14/14 |
| `npm run test:integration` | ✅ 30/30 |

## Cenários cobertos pela integração
- Health check (DB ok, engine fallback).
- Signup/login/sessão HttpOnly+SameSite, senha fraca recusada.
- Escalada de privilégio bloqueada (role no profile).
- Bloqueio cross-origin.
- CRUD de áreas com validação (UF, coords, polígono aberto).
- Análise de risco: 422 sem dados inventados, proveniência, dedup de alerta, análise de baixo risco sem alerta.
- Ciclo de vida de alertas com transições e histórico.
- Importação: revalidação server-side, contagem de status, transação.
- Ocorrências alimentam fator histórico.
- Isolamento entre organizações (Bob não vê dados de Alice).
- Papéis (viewer leitura, sem criação/alteração).
- Dashboard, relatório CSV (neutralização de fórmula), relatório por período.
- Insights por organização.
- Consulta Pública: publicação explícita, sanitização, filtros, unpublish.
- Auditoria de operações críticas.
- Reset de senha single-use.
- Logout invalida sessão.

## Problemas encontrados e corrigidos
1. **Encoding da base de dados**: initdb padrão gerou WIN1252, incompatível com caracteres de box-drawing nos comentários SQL. Corrigido recriando a base com `--encoding=UTF8 --locale=C` e removendo caracteres não-ASCII dos comentários das migrações.
2. **Migrações não aplicavam**: resolvido após correção de encoding.
3. **Dedup em concorrência**: implementado `dedup_key` + índice único parcial + `ON CONFLICT DO NOTHING`.

## Pendências
- Validação em staging com Docker Compose (ambiente local sem Docker).
- Teste de restauração de backup (a executar mensalmente).
- Conectores INPE/Sisfogo (não implementados; apenas importação manual).
- PostGIS (adiado para Fase 3).
- Tabelas de expansão (satellite_hotspots, etc.) criadas apenas quando os conectores forem implementados.