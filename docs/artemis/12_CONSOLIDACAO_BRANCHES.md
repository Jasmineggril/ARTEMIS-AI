# 12 — Comparação das branches e estratégia de consolidação

Data: 16/11/2026. Branch de integração: `integration/artemis-sisfogo-inpe`, criada a partir de
`claude/friendly-cerf-x7tgnx` (`ad8101c`). **Nenhum merge** das outras branches; nada foi alterado nelas.

## 1. Topologia

```
main (ec5e5c2) ── … ── 7bb7bcd  (auditoria do banco, sem mudança de esquema)
                         ├── claude/friendly-cerf-x7tgnx   referência: migrações 0004–0010, INPE, Open-Meteo,
                         │                                   motor com proveniência, papéis, Docker/Caddy, backups,
                         │                                   página inicial, identidade visual, Sisfogo v1 (0010)
                         └── db/postgres-hostinger-dev (0dcbf35)
                               └── feature/sisfogo-integration (0f999fc)  = db/… + 2 commits (conector + docs)
copilot/fix-…  (611e640)  só "Initial plan", sem código, histórico sem relação com as demais
```

## 2. Conflitos e regressões encontrados

| # | Onde | Problema | Consequência se mesclado |
|---|---|---|---|
| 1 | `db/…` e `feature/…`: `migrations/0000`–`0003` | Arquivos **já aplicados** foram regravados com BOM e codificação corrompida: `DEFAULT 'concluído'` → `'concluÃ­do'`, `'válido'` → `'vÃ¡lido'` | Bancos novos nasceriam com valores padrão corrompidos; bancos existentes divergiriam do código |
| 2 | `0004_integrity_indexes`, `0005_occurrence_dedup`, `0006_occurrence_typed_date`, `0007_sisfogo_sync` | Mesma numeração das nossas (`0004_integrity` … `0007_model_versions_analysis_sources`), **nomes diferentes** | O executor registra por nome: **todas** tentariam rodar por cima das nossas. A `0005` da branch faz `UPDATE` em `dedup_key`, que aqui é coluna gerada → erro e **implantação bloqueada**; as demais criariam índices e colunas paralelos (`occurrence_at`, índice único recriado) |
| 3 | `0007_sisfogo_sync.sql` | Cria `source_sync_runs` com outra estrutura (`source_key`, `records_fetched`, status em inglês) | `CREATE TABLE IF NOT EXISTS` não faria nada (a tabela já existe com outra estrutura) e o código da branch falharia |
| 4 | `0006_occurrence_typed_date` | Hora ausente vira `00:00:00`; fuso `America/Sao_Paulo` para todo o país | Inventa horário; erro de 1–2 h no AC/AM/MT/RO/RR |
| 5 | `server/connectors/sisfogo.ts` (branch) | Lê datas na raiz do ROI | Na API real as datas estão em `datasIncendio`: **todas** as datas ficariam vazias |
| 6 | `server/services/sisfogo-sync.ts` (branch) | Carrega toda a base em memória; um lote novo de importação por execução; `onConflictDoNothing` | Uso de memória crescente; lotes falsos; **retificações nunca aplicadas** |
| 7 | `POST /api/sync/sisfogo` (branch) | Sincroniza dentro da requisição HTTP | A carga completa leva minutos: timeout no proxy; sem trava contra execuções simultâneas |
| 8 | `docker-compose.prod.yml` (db/…) | Banco com um único usuário superusuário da aplicação; sem proxy HTTPS | Perderia o papel de privilégio mínimo e o Caddy |
| 9 | `public/logo.png` (1,7 MB) | Logo bitmap pesado | Já substituído por SVGs otimizados |

## 3. O que cada branch tinha de exclusivo e o destino

| Item | Origem | Decisão |
|---|---|---|
| Ideia e endpoint do conector Sisfogo, documentação de acesso (Lei nº 14.944/2024, COMIF) | `feature/…` | **Aproveitado e reescrito** sobre o contrato real (`11_SISFOGO.md`) |
| Testes do normalizador | `feature/…` | Substituídos por testes com ROIs reais |
| Prioridade `DATABASE_URL` sobre Supabase | `db/…` | Já existia na referência (`server/db-url.ts`) |
| `occurrence_at timestamptz` | `db/…` | Equivalente feito sem inventar hora: `occurred_at` só para fontes que publicam o instante (0011) |
| Auditoria do banco, diagrama ER, guia Hostinger, relatórios | `db/…` | Referência já tinha versões mais completas (`09`, `10`, `04`, `05`); não copiados |
| Rota síncrona `/api/sync/sisfogo` | `feature/…` | **Descartada** (ver §2-7); substituída por execução em segundo plano com trava |
| `copilot/…` | — | Nada a aproveitar |

## 4. Estratégia aplicada

1. Branch nova a partir da referência; outras branches intocadas (podem ser arquivadas depois, por decisão sua).
2. Migrações já aplicadas **não** foram alteradas. Mudanças novas em `0011_official_records_provenance.sql`, aditiva.
3. Proteção no executor de migrações contra a repetição destes problemas:
   - recusa números duplicados (`0004_a` + `0004_b`), BOM e texto com codificação corrompida;
   - grava SHA-256 de cada migração aplicada e **falha** se o arquivo mudar depois (`MIGRATION_ALLOW_CHANGED=1` só avisa);
   - `scripts/db/migrate.ts` recusa opções desconhecidas (antes, um `--dry-run` digitado errado aplicava as migrações).
4. Teste em cópia restaurada antes do banco de desenvolvimento: `pg_dump` → `pg_restore` → 0011 →
   impressão digital dos dados (`scripts/ops/fingerprint.sql`) **idêntica** antes/depois; reexecução sem efeito.
5. Contrato do Sisfogo confirmado com consultas reais antes de qualquer gravação; depois, sincronização completa real em dev.
6. Implementação incremental com testes a cada etapa (ver `STATUS_ENTREGAVEIS.md`).

## 5. Recomendação

- Revisar e mesclar `integration/artemis-sisfogo-inpe` (PR de consolidação).
- **Não** mesclar `db/postgres-hostinger-dev` nem `feature/sisfogo-integration`: tudo que era útil foi incorporado e
  o restante causaria as regressões do §2. Se quiser preservá-las, basta deixá-las como estão; apagá-las é decisão sua.
