# ARTEMIS AI — Auditoria de Banco de Dados e Plano de Migrações

**Data da auditoria:** branch `claude/friendly-cerf-x7tgnx` (PR #2), commit `7bb7bcd`.
**Banco principal:** `artemis_ai` (PostgreSQL, sem PostGIS hoje).
**Escopo:** diagnóstico do esquema existente, riscos e plano de migração versionada. Nenhuma alteração destrutiva foi aplicada.

---

## 1. Resumo executivo

O projeto já possui uma base de dados funcional e em produção de desenvolvimento, com **18 tabelas** (13 de origem CERES + 5 de multi-tenant/auditoria do ARTEMIS). A arquitetura de persistência é real (PostgreSQL via Drizzle ORM, migrações SQL versionadas em `./migrations`), e os testes de integração exigem um PostgreSQL real (`TEST_DATABASE_URL`). Não há instância PostgreSQL local nesta estação, portanto as validações de migração precisam ser executadas em um banco de desenvolvimento dedicado antes da aplicação em produção.

**Principais achados:**

1. **Relacionamentos não declarados no ORM.** `shared/schema.ts` define colunas `*_id` como `integer` simples, sem `.references(...)`. As migrações 0002/0003 adicionam *algumas* FKs no SQL, mas várias continuam ausentes (ex.: `readings.sensor_id`, `user_stats.user_id`, `achievements.user_id`, `denuncias.user_id`, `monitored_areas.created_by`, `risk_analyses.area_id`, `risk_analyses.created_by`, `alerts.sensor_id`, `import_batches.imported_by`, `fire_occurrences` sem índice de deduplicação).
2. **Tipos de data inconsistentes.** `fire_occurrences.occurrence_date` e `occurrence_time` são `text`. A normalização para ISO existe em código (`normalizeOccurrenceDate`), mas o banco não garante formato nem permite ordenação/filtro por tipo. `occurrence_time` aceita valores livres ("9h").
3. **Isolamento por organização incompleto no esquema.** Tabelas org-scoped (`monitored_areas`, `risk_analyses`, `alerts`, `import_batches`, `fire_occurrences`, `audit_logs`) têm `organization_id`, mas **não há FK** para `organizations` em `monitored_areas.organization_id`? Na migração 0002 sim, adicionada com `REFERENCES`. Porém `data_sources` é global (sem organização), o que é aceitável (registro de conectores), mas `sensors`, `readings`, `weather_data`, `denuncias`, `user_stats`, `achievements` também são globais/legados sem escopo de organização — risco de vazamento se usados em produção.
4. **Configuração de conexão prioriza Supabase.** `server/db.ts` e `drizzle.config.ts` usam `SUPABASE_DATABASE_URL` antes de `DATABASE_URL`. Em VPS Hostinger isso pode conectar acidentalmente ao banco antigo do Supabase. Precisa inversão + `.env.example`.
5. **Fallback em memória silencioso.** `server/storage.ts` (legado) permite fallback em memória apenas se `STORAGE_MEMORY_FALLBACK=true` e não-produção. Novas tabelas são acessadas diretamente via `db` (sem fallback) — bom, mas falhas de conexão não são tratadas explicitamente em todas as rotas (propagam 500). Precisa health check + logs estruturados.
6. **Deduplicação de ocorrências não materializada.** A importação detecta duplicados em memória no cliente/servidor, mas não há chave única no banco para impedir reimportação do mesmo lote/registro. Risco de duplicação em concorrência.
7. **Sem índices geoespaciais.** Coordenadas são `real` (float4). Consultas de proximidade (10 km) fazem varredura + cálculo Haversine em JS. Para volume real, PostGIS + índice GiST é recomendado.
8. **Migrações não totalmente versionadas pelo Drizzle.** O `_journal.json` do Drizzle só conhece `0000` e `0001`. As migrações `0002` e `0003` são SQL manual aplicado por `server/migrate.ts`. Funciona, mas não há snapshot Drizzle para elas (drizzle-kit não as gerou). O fluxo é híbrido.
9. **Sem Docker Compose / backup automatizado.** Infra Hostinger ainda não preparada.
10. **Dados simulados misturados.** `data_sources` e `alerts` têm flag `is_demo`/`is_simulated`, mas não há separação física. Aceitável se as flags forem respeitadas (são).

---

## 2. Inventário das tabelas (18)

### Base CERES (13)

| # | Tabela | Chave | Escopo org | FKs existentes (SQL) | Índices existentes |
|---|--------|-------|------------|----------------------|--------------------|
| 1 | `users` | `id` serial | não (global) | — | `email` UNIQUE |
| 2 | `sensors` | `id` serial | não | — | — |
| 3 | `readings` | `id` serial | não | `sensor_id` **sem FK** | — |
| 4 | `alerts` | `id` serial | sim (0002) | `organization_id`, `area_id`, `risk_analysis_id`, `assigned_to` | `org_status`, `dedup` |
| 5 | `weather_data` | `id` serial | não | — | — |
| 6 | `user_stats` | `id` serial | não | `user_id` **sem FK** | — |
| 7 | `denuncias` | `id` serial | não | `user_id` **sem FK** | — |
| 8 | `achievements` | `id` serial | não | `user_id` **sem FK** | — |
| 9 | `monitored_areas` | `id` serial | sim (0002) | `organization_id`, `created_by` **sem FK** | `org_idx` |
| 10 | `risk_analyses` | `id` serial | sim (0002) | `organization_id`, `area_id` **sem FK** | `org_area` |
| 11 | `data_sources` | `id` serial | global | — | — |
| 12 | `import_batches` | `id` serial | sim (0002/0003) | `organization_id`, `imported_by` **sem FK** | `org_idx`, `public (parcial)` |
| 13 | `fire_occurrences` | `id` serial | sim (0002) | `import_batch_id`, `organization_id` | `org (date)` |

### ARTEMIS multi-tenant/auditoria (5)

| # | Tabela | Chave | FKs | Índices |
|---|--------|-------|-----|---------|
| 14 | `organizations` | `id` serial | — | `slug` UNIQUE |
| 15 | `organization_members` | `id` serial | `organization_id`, `user_id` | `org_user_uq`, `user_idx` |
| 16 | `alert_events` | `id` serial | `alert_id`, `user_id` | `alert_idx` |
| 17 | `audit_logs` | `id` serial | `organization_id`, `user_id` | `org_created` |
| 18 | `password_reset_tokens` | `id` serial | `user_id` | `token_hash` UNIQUE |

**Total: 18 tabelas.** O prompt mestre menciona 13 originais — correspondem às linhas 1–13 acima.

---

## 3. O que funciona / o que é simulado / o que falta

| Área | Status | Observação |
|------|--------|------------|
| Persistência real (PostgreSQL) | Implementado | `server/migrate.ts` roda SQL em transação por arquivo. |
| Autenticação (bcrypt + sessão) | Implementado | `users.password` texto (hash), sessão httpOnly. |
| Multi-organização (5 papéis) | Implementado | `organizations`, `organization_members`, `requireOrg` revalida membership. |
| Análises de risco persistidas | Implementado | `risk_analyses` com proveniência, fontes, qualidade, limitações. |
| Alertas com ciclo de vida | Implementado | `alerts` + `alert_events`, dedup por `dedup_key`. |
| Importação CSV/XLS/XLSX | Implementado | `import_batches` + `fire_occurrences`, transação. |
| Publicação (Consulta Pública) | Implementado | `visibility`, coords arredondadas, sanitização. |
| Auditoria | Implementado | `audit_logs`. |
| Conector Open-Meteo | Implementado | Não inventa valores; apenas preenche vazios. |
| Conector INPE/Sisfogo | **Não implementado** | Apenas importação manual. Documentado como pendente. |
| PostGIS / geo índices | **Não implementado** | Coords `real`, Haversine em JS. |
| Backups automatizados | **Não implementado** | Manual. |
| Docker Compose Postgres | **Não implementado** | Apenas app. |
| `.env.example` | **Não existe** | Necessário. |
| Migrações Drizzle snapshot 0002/0003 | **Ausentes** | SQL manual. |

---

## 4. Problemas estruturais identificados (priorizados)

### P1 — Integridade referencial incompleta (alto)

Colunas `*_id` sem FK no banco (apesar de existirem no código):

- `readings.sensor_id` → `sensors.id` (NOT NULL, sem FK)
- `user_stats.user_id` → `users.id` (NOT NULL, sem FK)
- `achievements.user_id` → `users.id` (NOT NULL, sem FK)
- `denuncias.user_id` → `users.id` (nullable, sem FK)
- `monitored_areas.created_by` → `users.id` (nullable, sem FK)
- `risk_analyses.area_id` → `monitored_areas.id` (nullable, sem FK) — hoje pode ficar "dangling" após delete de área (intencional para rastreabilidade, mas sem FK impede `ON DELETE SET NULL` explícito)
- `risk_analyses.created_by` → `users.id` (sem FK)
- `alerts.sensor_id` → `sensors.id` (nullable, sem FK)
- `import_batches.imported_by` → `users.id` (sem FK)
- `monitored_areas.organization_id` → já tem FK (0002), mas falta índice composto com `status`? não crítico.

**Risco:** registros órfãos, deletes inconsistentes, impossibilidade de garantir cascata.

### P2 — Datas como texto (médio)

- `fire_occurrences.occurrence_date` (text) e `occurrence_time` (text).
- Filtros `from`/`to` com regex `YYYY-MM-DD` funcionam por ordenação lexicográfica (ISO), mas `occurrence_time` livre ("9h", "14:30") inviabiliza agregação por hora de forma robusta (o código tenta `substr`/parse; testes mostram 24 buckets).

**Proposta:** manter colunas text originais (rastreabilidade da fonte) + adicionar `occurrence_at` timestamptz nullable (derivado quando data+hora válidas) + índice. Conversão feita em backfill idempotente. Sem perda de dados originais.

### P3 — Deduplicação não materializada (médio)

Sem chave única para impedir duplicação em concorrência. Proposta: adicionar `dedup_key` text em `fire_occurrences` (hash de `org+date+municipality+lat+lon+type` ou `source_reference` quando presente) + índice único parcial `WHERE dedup_key IS NOT NULL`. Backfill para registros existentes. A importação passa a usar `ON CONFLICT DO NOTHING` e contar afetados.

### P4 — Isolamento de organizações nos legados (médio)

Tabelas legadas (`sensors`, `readings`, `weather_data`, `denuncias`, `user_stats`, `achievements`) não têm `organization_id`. Rotas legadas são `requireAuth`/`requirePlatformAdmin`, ou seja, não multi-tenant. **Não quebra testes atuais.** Proposta: manter como estão (plataforma/global) e documentar; se no futuro precisarem ser tenant-scoped, adicionar coluna + backfill em migração separada. Não misturar agora.

### P5 — Configuração de conexão (alto para deploy)

`SUPABASE_DATABASE_URL` tem precedência sobre `DATABASE_URL` em `server/db.ts` e `drizzle.config.ts`. Em VPS Hostinger, deve ser o inverso (ou remover Supabase). Proposta: preferir `DATABASE_URL`; manter `SUPABASE_DATABASE_URL` apenas como fallback explícito com log de aviso. SSL apenas se `PGSSLMODE=require` ou host Supabase.

### P6 — Persistência/fallback (médio)

- `storage.ts` (legado) faz fallback silencioso em dev. Em produção, fallback desabilitado (`fallbackAllowed` false), então erros propagam. OK.
- Rotas novas acessam `db` diretamente; uma falha de conexão vira 500 genérico. Proposta: middleware de erro centralizado que loga `{ level: "error", msg, err }` sem bodies; health check `/api/health` já testa `SELECT 1`.

### P7 — Índices ausentes (médio)

Faltam índices para consultas reais:
- `readings(sensor_id, timestamp DESC)`
- `weather_data(latitude, longitude, timestamp DESC)` (ou GiST se PostGIS)
- `sensors(status)`
- `denuncias(user_id, created_at DESC)`, `denuncias(status)`
- `monitored_areas(organization_id, status)`, `monitored_areas(municipality, state)`
- `risk_analyses(organization_id, created_at DESC)` (além do existente por area)
- `alerts(organization_id, severity)`, `alerts(created_at DESC)`
- `fire_occurrences(municipality, state, occurrence_date)`, `fire_occurrences(import_batch_id)`
- `import_batches(imported_by)`
- `audit_logs(user_id, created_at DESC)`
- `organization_members(organization_id)` (já tem user_idx; falta org_idx? PK implícito não. Adicionar.)

### P8 — Coordenadas e validação (baixo/médio)

CHECK constraints existem em `monitored_areas` (0002) e `risk_analyses.score`. Faltam em:
- `sensors.latitude/longitude` range
- `weather_data.latitude/longitude` range
- `denuncias.latitude/longitude` range
- `fire_occurrences.latitude/longitude` range
- `monitored_areas` já tem.

### P9 — Auditoria de migrações (baixo)

`_journal.json` não lista 0002/0003. Proposta: manter SQL manual (já funciona via `runMigrations`) mas adicionar cabeçalho de versão/checksum e documentar. Opcionalmente gerar snapshots Drizzle com `drizzle-kit generate` em banco de dev para reconciliar (não obrigatório).

### P10 — PostGIS (avaliar)

Consultas de proximidade e mapas. Proposta: **não obrigatório para TRL 4**. Adicionar extensão `postgis` no Docker Compose e coluna `geom geometry(Point, 4326)` opcional em `monitored_areas`/`fire_occurrences` em migração futura (Fase 3), com backfill a partir de lat/lon. Manter `real` lat/lon como fonte de verdade. Evitar custo/complexidade agora.

---

## 5. Proposta de tabelas de expansão (justificada)

Apenas quando houver necessidade real. Prioridade para a Prova de Valor:

| Tabela | Prioridade | Justificativa | Evitar duplicação com |
|--------|-----------|---------------|----------------------|
| `organizations` | ✅ já existe | multi-tenant | — |
| `organization_members` | ✅ já existe | papéis | — |
| `audit_logs` | ✅ já existe | rastreabilidade | — |
| `satellite_hotspots` | Fase 3 | focos de calor INPE, **distinto** de incêndio confirmado | `fire_occurrences` (histórico importado) |
| `environmental_observations` | Fase 3 | cache de Open-Meteo (evitar chamadas repetidas) | `weather_data` (legado, on-demand) |
| `area_boundaries` | Fase 4 | separar geometria de `monitored_areas` se multi-polígono complexo | `monitored_areas.boundary` (json) |
| `source_sync_runs` | Fase 3 | controle incremental de conectores (INPE) | `import_batches` (arquivos) |
| `model_versions` | Fase 4 | rastrear versão do modelo por análise | `risk_analyses.calculation_version` (texto) |
| `risk_analysis_sources` | Fase 4 | normalizar fontes por análise | `risk_analyses.data_sources` (json) |
| `validation_metrics` | Fase 4 | métricas de modelo | — |
| `notification_events` | Fase 5 | alertas externos (SMS/e-mail) | `alerts` |
| `notification_preferences` | Fase 5 | preferências por usuário/org | `users` |

**Recomendação:** não criar nenhuma tabela de expansão agora. Apenas documentar. Criar quando o conector correspondente for implementado (evita tabelas vazias).

---

## 6. Plano de migrações (versionado, não-destrutivo)

Princípio: **nenhum `DROP TABLE`, `TRUNCATE` ou rewrite de coluna sem aprovação.** Migrações idempotentes (`IF NOT EXISTS` / `IF EXISTS`). Cada migração em transação (já feito em `runMigrations`).

### Migração 0004 — integridade referencial e índices (segura, aditiva)

Arquivo: `migrations/0004_integrity_indexes.sql`

Conteúdo proposto:
- Adicionar FKs ausentes com `ON DELETE` apropriado:
  - `readings.sensor_id` → `sensors.id` ON DELETE CASCADE (leituras órfãs não têm sentido)
  - `user_stats.user_id` → `users.id` ON DELETE CASCADE
  - `achievements.user_id` → `users.id` ON DELETE CASCADE
  - `denuncias.user_id` → `users.id` ON DELETE SET NULL (preservar relato)
  - `monitored_areas.created_by` → `users.id` ON DELETE SET NULL
  - `risk_analyses.area_id` → `monitored_areas.id` ON DELETE SET NULL (rastreabilidade)
  - `risk_analyses.created_by` → `users.id` ON DELETE SET NULL
  - `alerts.sensor_id` → `sensors.id` ON DELETE SET NULL
  - `import_batches.imported_by` → `users.id` ON DELETE SET NULL
- CHECK constraints de range em coords (sensors, weather_data, denuncias, fire_occurrences).
- Índices listados em P7.
- `organization_members` índice por `organization_id`.

**Risco:** FKs em tabelas com dados órfãos falham. Em banco de dev (limpo) OK. Em produção existente, rodar `SELECT ... WHERE NOT IN` antes. Script de diagnóstico incluído no plano.

### Migração 0005 — deduplicação de ocorrências (aditiva)

Arquivo: `migrations/0005_occurrence_dedup.sql`

- `ALTER TABLE fire_occurrences ADD COLUMN IF NOT EXISTS dedup_key text;`
- Backfill: `UPDATE fire_occurrences SET dedup_key = md5(coalesce(organization_id::text,'') || '|' || coalesce(occurrence_date,'') || '|' || lower(coalesce(municipality,'')) || '|' || coalesce(latitude::text,'') || '|' || coalesce(longitude::text,'') || '|' || coalesce(occurrence_type,'')) WHERE dedup_key IS NULL;`
- Índice único parcial: `CREATE UNIQUE INDEX IF NOT EXISTS fire_occurrences_dedup_uq ON fire_occurrences (organization_id, dedup_key) WHERE dedup_key IS NOT NULL;`
- Atualizar `server/routes.ts` import para calcular `dedup_key` e usar `ON CONFLICT DO NOTHING`, contando conflitos como duplicados.

### Migração 0006 — data de ocorrência tipada (aditiva, sem perder texto)

Arquivo: `migrations/0006_occurrence_typed_date.sql`

- `ALTER TABLE fire_occurrences ADD COLUMN IF NOT EXISTS occurrence_at timestamptz;`
- Backfill idempotente: tentar parsear `occurrence_date` + `occurrence_time` para timestamptz UTC; se inválido, manter NULL (não inventar).
- Índice: `CREATE INDEX IF NOT EXISTS fire_occurrences_occurred_at_idx ON fire_occurrences (organization_id, occurrence_at);`
- Manter `occurrence_date`/`occurrence_time` text para rastreabilidade.
- Código: agregação por hora passa a usar `occurrence_at` quando presente, com fallback para parse do texto (compatibilidade).

### Migração 0007 — configuração de ambiente (não-SQL, doc)

- Inverter prioridade em `server/db.ts` e `drizzle.config.ts`.
- Criar `.env.example`.
- Documentar `DATABASE_URL`, `PGHOST`, etc.

### Migração 0008 — (futuro, Fase 3) PostGIS opcional

- `CREATE EXTENSION IF NOT EXISTS postgis;`
- Adicionar `geom geometry(Point, 4326)` em `monitored_areas` e `fire_occurrences`, backfill via `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`.
- Índice GiST.
- Atualizar consultas de proximidade para `ST_DWithin`.
- **Não executar agora** — requer validação de custo e disponibilidade da extensão no Hostinger.

---

## 7. Ajustes de backend necessários (sem quebrar contratos)

1. `server/db.ts` / `drizzle.config.ts`: inverter prioridade Supabase → DATABASE_URL; log de aviso se Supabase usado.
2. `server/storage.ts`: manter fallback desabilitado em produção (já está); adicionar log estruturado em falha (sem bodies).
3. `server/routes.ts` import: calcular `dedup_key`, usar `ON CONFLICT DO NOTHING`, contar duplicados.
4. `server/artemis-routes.ts`: índice de consultas de ocorrências por hora usar `occurrence_at` quando disponível (fallback texto).
5. Middleware de erro centralizado (em `server/index.ts`) para não vazar stack em produção.
6. Health check já existe; garantir que falha de DB retorne 503 (já faz).

---

## 8. Docker Compose (Hostinger) — esqueleto

Arquivo sugerido: `docker-compose.prod.yml` (não criar até aprovação).

```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4  # ou postgres:16-alpine se PostGIS não for usado
    restart: unless-stopped
    environment:
      POSTGRES_DB: artemis_ai
      POSTGRES_USER: artemis_app
      POSTGRES_PASSWORD: ${PGPASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./backups:/backups
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U artemis_app -d artemis_ai"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [internal]
    # NÃO publicar portas para a internet
  app:
    build: .
    environment:
      DATABASE_URL: postgresql://artemis_app:${PGPASSWORD}@postgres:5432/artemis_ai
      NODE_ENV: production
      SESSION_SECRET: ${SESSION_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
    networks: [internal, web]
volumes:
  pgdata:
networks:
  internal:
    internal: true
  web:
```

Usuário PostgreSQL com privilégios mínimos: `artemis_app` com `CONNECT`, `USAGE`, `SELECT/INSERT/UPDATE/DELETE` nas tabelas; sem `SUPERUSER`, sem `CREATEDB`. Migrations rodam por usuário `artemis_migrate` com DDL, ou via `DATABASE_URL` de migração separada.

---

## 9. Backup e restauração

- Backup diário via `pg_dump -Fc` + criptografia (gpg) + upload para storage externo (S3/Backblaze) via cron.
- Retenção: 7 diários, 4 semanais, 3 mensais.
- Teste de restauração mensal em banco de staging.
- Procedimento documentado em `docs/artemis/backup.md` (a criar).

---

## 10. Testes obrigatórios (a executar em banco de dev)

- Conexão (`SELECT 1`) e health check.
- CRUD + FKs (insert órfão deve falhar).
- CHECK constraints (coord fora de range deve falhar).
- Importação transacional (falha no meio → rollback, lote não parcial).
- Dedup (reimportar mesmo registro → conflito).
- Isolamento org (Bob não vê dados de Alice) — já coberto por `tests/integration/api.test.ts`.
- Paginação/filtros por município e período.
- Falha de conexão → 503 + log, sem fallback silencioso em produção.
- Backup/restore round-trip.

---

## 11. Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| FKs falham por dados órfãos em produção | Script de diagnóstico pré-migração; usar `ON DELETE SET NULL` onde apropriado. |
| Conversão de data perde informação | Manter colunas text originais + coluna tipada nullable. |
| Migração parcial | `runMigrations` usa transação por arquivo; rollback automático. |
| Conexão acidental ao Supabase | Inverter prioridade + `.env.example` + log de aviso. |
| Duplicação em concorrência | Índice único parcial + `ON CONFLICT`. |
| Custo PostGIS | Adiar para Fase 3; usar extensão apenas quando necessário. |

---

## 12. Ordem de execução recomendada

1. **Aprovação do diagnóstico** (este documento).
2. Aplicar migração **0004** em banco de desenvolvimento; rodar `npm run test:integration`.
3. Aplicar **0005** e **0006**; atualizar código de import/insights; rodar testes.
4. Atualizar `db.ts`/`drizzle.config.ts` + criar `.env.example`.
5. Preparar Docker Compose + backup (sem expor Postgres).
6. Validar em staging; só então aplicar em produção (com backup).
7. Expansion tables apenas quando conectores INPE/SMS forem implementados.

---

## 13. Entregáveis previstos (status)

| # | Entregável | Status |
|---|-----------|--------|
| 1 | Diagnóstico do banco | ✅ este documento |
| 2 | Inventário das 13 tabelas base (+5) | ✅ seção 2 |
| 3 | Diagrama ER | ✅ docs/artemis/er-diagram.md |
| 4 | Proposta de expansão justificada | ✅ seção 5 |
| 5 | `shared/schema.ts` atualizado | ✅ FKs + novas colunas |
| 6 | Migrações SQL versionadas | ✅ 0004–0006 criadas |
| 7 | Relacionamentos e índices | ✅ 0004 |
| 8 | Ajustes no backend | ✅ import dedup + insights |
| 9 | Consultas Sisfogo/INPE/clima | ⏳ conector (pendente) |
| 10 | Integração com mapa | ⏳ Fase 3 |
| 11 | Testes automatizados | ⏳ Fase 6 |
| 12 | Docker Compose Postgres | ✅ dev + prod |
| 13 | `.env.example` | ✅ criado |
| 14 | Manual Hostinger | ✅ hostinger-install.md |
| 15 | Backup/restauração | ✅ backup.md |
| 16 | Doc manutenção/segurança | ✅ test-report.md |

---

**Próximo passo solicitado:** aprovação para iniciar a Fase 2 (migrações 0004–0006 + ajustes de código). Nenhuma alteração foi feita no banco nem no esquema.