# 10 — Banco de dados: registro de execução, manutenção e segurança

Complementa o plano em `09_BANCO_DIAGNOSTICO_E_PLANO.md` (aprovado em 16/11/2026).

## 1. Registro das migrações aplicadas

Protocolo para cada etapa: backup cifrado → restauração numa cópia nova → migração na cópia → **impressão digital dos dados** (`scripts/ops/fingerprint.sql`: contagem e hash por tabela, datas comparadas em UTC, coordenadas arredondadas) antes e depois → mesma coisa no banco de desenvolvimento.

| Migração | Conteúdo | Cópia restaurada | Banco de dev |
|---|---|---|---|
| 0004_integrity | 9 FKs com regras de exclusão, 2 `UNIQUE`, `area_snapshot`, 24 colunas → `timestamptz`, 21 → `double precision`, `CHECK`s de coordenadas | idêntica | idêntica |
| 0005_occurrences_dedup_indexes | `occurred_on`/`occurred_hour`/`dedup_key` gerados, índice único por organização, índices de consulta, tabela `municipalities` | idêntica | idêntica |
| 0006_sources_hotspots_weather | registro de fontes, `source_sync_runs`, `satellite_hotspots`, cache/proveniência em `weather_data`, view `v_fire_events` | idêntica | idêntica |
| 0007_model_versions_analysis_sources | `model_versions`, `risk_analyses.model_version_id`, `risk_analysis_sources` (com reconstrução do histórico) | idêntica | idêntica |
| 0008_postgis_optional | colunas `geom` + GiST se PostGIS existir; caso contrário, nada | aplicada (sem PostGIS: no-op) | aplicada |
| 0009_session_table | tabela de sessão criada por migração (API sem DDL) | — | aplicada |
| 0010_sisfogo_roi | fonte `sisfogo-roi` + tabela `sisfogo_roi_records` (aditiva) | — | aplicada |
| 0011_official_records_provenance | registros oficiais em `fire_occurrences` (`organization_id NULL`, chave fonte + id externo, `CHECK` de proveniência), `source_record_revisions`, campos verificados do Sisfogo, contadores/progresso em `source_sync_runs`, `v_fire_events` com origem `registro_oficial` | aplicada; impressão digital idêntica | aplicada |

Nenhum `DROP TABLE`, `DROP COLUMN` ou `TRUNCATE`. Único `DROP` usado: `DROP INDEX fire_occurrences_org_idx`, substituído por índice composto `(organization_id, occurred_on)`. Índice não contém dados.

**Salvaguardas embutidas:** a 0004 aborta, sem alterar nada, se houver leituras sem sensor, estatísticas ou conquistas órfãs ou duplicadas, ou se o fuso do banco não for UTC. A 0005 aborta se já existirem ocorrências duplicadas na mesma organização. Os dois abortos estão cobertos por teste.

## 2. Inventário final (25 tabelas + 1 view)

| Grupo | Tabelas |
|---|---|
| Originais (13, preservadas) | `users`, `user_stats`, `achievements`, `denuncias`, `sensors`, `readings`, `weather_data`, `monitored_areas`, `risk_analyses`, `alerts`, `data_sources`, `import_batches`, `fire_occurrences` |
| Organizações e segurança | `organizations`, `organization_members`, `audit_logs`, `password_reset_tokens`, `alert_events`, `session` |
| Dados ambientais | `municipalities`, `source_sync_runs`, `satellite_hotspots` |
| IA | `model_versions`, `risk_analysis_sources` |
| Controle | `_drizzle_migrations` |
| View | `v_fire_events` (ocorrências importadas + focos de satélite, coluna `origem` explícita) |

Diagrama: seção 3 do documento 09.

## 3. Papéis e privilégios (verificado)

| Papel | Uso | Pode |
|---|---|---|
| `artemis_admin` | superusuário — administração e backup | tudo; **nunca** usado pela aplicação |
| `artemis_owner` | serviço `migrate` (execução única) | DDL no schema `public` |
| `artemis_app` | API e jobs (`inpe-sync`) | `SELECT/INSERT/UPDATE/DELETE`; `statement_timeout 30s` |

Teste executado com `artemis_app`: `CREATE TABLE` → *permission denied*; `DROP`/`ALTER TABLE` → *must be owner*; `TRUNCATE` → *permission denied*; `CREATE EXTENSION` → *permission denied*; `SELECT`/`INSERT` → OK. A API completa (12 fluxos no navegador) e a sincronização do INPE rodaram com esse papel.

Criação: `infrastructure/postgres/initdb/01-roles-extensions.sh` (roda uma única vez, na criação do volume). Instalação sem Docker: executar o mesmo SQL do script como superusuário.

## 4. Fontes de dados

| Fonte | Tabela | Como entra | Situação |
|---|---|---|---|
| INPE — Programa Queimadas | `satellite_hotspots` | `npm run sync:inpe` / job `inpe-sync` (upsert por id do foco) | **verificado com dados reais**: 16.552 focos em 2 dias; segunda execução: 0 inseridos, 0 atualizados |
| Arquivos autorizados da organização | `import_batches` + `fire_occurrences` | upload na interface | implementado |
| Sisfogo — ROI públicos (Ibama) | `sisfogo_roi_records` (espelho), `source_record_revisions`, `fire_occurrences` (oficiais) | `npm run sync:sisfogo` / job `sisfogo-sync` (incremental diário, completa semanal) | **verificado com a API real**: sincronização completa em dev, 1.698 ROIs, 0 rejeitados; incremental seguinte sem regravações — ver `11_SISFOGO.md` |
| Open-Meteo | `weather_data` (`kind='atual'`) | sob demanda na análise, cache de 30 min | implementado |
| IBGE — municípios | `municipalities` | `npm run db:load-municipalities` | **pendente**: o servidor do IBGE derrubou todas as conexões nesta sessão; aceita `--file` com o JSON baixado manualmente |

Formato do INPE verificado em 16/11/2026: colunas `id, lat, lon, data_hora_gmt, satelite, municipio, estado, pais, municipio_id, estado_id, pais_id, numero_dias_sem_chuva, precipitacao, risco_fogo, bioma, frp`; `-999` = sem valor; horário em UTC; o arquivo do dia é atualizado de hora em hora e o do dia anterior reprocessado até 12h (documento de curadoria do INPE). Termos de uso não localizados: citar a fonte e confirmar com o INPE antes de uso comercial.

## 5. Rotinas de manutenção

### Cron da VPS (usuário `artemis`)

```
# focos de calor do INPE: de hora em hora, minuto 50 (após as publicações por satélite)
50 * * * * cd /home/artemis/artemis && docker compose --profile jobs run --rm inpe-sync >> /home/artemis/inpe-sync.log 2>&1
# backup diário
30 2 * * * cd /home/artemis/artemis && BACKUP_PASSPHRASE_FILE=/home/artemis/.artemis-backup-pass BACKUP_REMOTE=b2:artemis-backups scripts/ops/backup.sh >> /home/artemis/backup.log 2>&1
```

O job sai com código 1 se algum dia falhar; cada execução fica em `source_sync_runs`.

### Consultas úteis

```sql
-- últimas sincronizações por fonte
SELECT d.key, r.status, r.started_at, r.records_inserted, r.records_updated, r.error
FROM source_sync_runs r JOIN data_sources d ON d.id = r.source_id ORDER BY r.started_at DESC LIMIT 20;

-- duplicidades de ocorrências na mesma organização (a migração 0005 aborta se existirem)
SELECT organization_id, dedup_key, count(*), array_agg(id) FROM fire_occurrences
WHERE dedup_key IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;

-- tamanho das maiores tabelas
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;

-- análises que usaram uma fonte
SELECT a.id, a.created_at, s.fields FROM risk_analysis_sources s JOIN risk_analyses a ON a.id = s.analysis_id
WHERE s.source_key = 'inpe-queimadas' ORDER BY a.created_at DESC;
```

### Crescimento e retenção

Medido: cerca de 0,7 kB por foco de calor (com os atributos originais em `raw`), cerca de 12 MB para dois dias com ~16,5 mil detecções. Em época de seca, o volume diário pode ser várias vezes maior. Proposta, **a aprovar**: manter 24 meses de `satellite_hotspots` no banco e apagar `raw` (não as linhas) após 90 dias. Nada disso foi implementado, porque apagar dados exige sua autorização.

O autovacuum padrão do PostgreSQL basta para o volume atual. Após cargas grandes (backfill), rode `ANALYZE satellite_hotspots;`.

### Habilitar PostGIS numa instalação que não tinha

Como superusuário: `CREATE EXTENSION postgis;`. Depois, como dono do schema: `psql "$DATABASE_URL" -f scripts/db/enable-postgis.sql`. A aplicação detecta as colunas `geom` em até 5 minutos, sem reinício.

## 6. Fluxo de alteração do schema

1. Editar `shared/schema.ts` **e** escrever a migração SQL em `migrations/NNNN_descricao.sql`, revisada à mão.
2. `npm run test:integration`: inclui o **teste de deriva**, que falha se o schema e o banco divergirem.
3. Backup → restaurar numa cópia → aplicar → comparar `fingerprint.sql` antes e depois.
4. `npm run db:status` mostra as pendências; produção só após aprovação: `docker compose run --rm migrate`.

`npm run db:push` está bloqueado fora de banco local, porque aplica diferenças diretamente e pode alterar ou apagar colunas.

## 7. Checklist de segurança

| Item | Situação |
|---|---|
| Credenciais só em `.env` (fora do Git) e variáveis do Compose | ✅ `.env` no `.gitignore`; `.env.example` sem segredos |
| Logs sem credenciais | ✅ só host/porta/banco (`describeDbUrl`) |
| PostgreSQL sem porta publicada | ✅ verificado no Compose (rede `internal`) |
| Senhas no banco com `scram-sha-256` | ✅ parâmetro do servidor |
| Papel da aplicação sem DDL | ✅ verificado |
| Sem SQL concatenado com entrada do usuário | ✅ Drizzle/`sql` parametrizado; nomes dinâmicos só em migrações (`format('%I')`) |
| Isolamento por organização | ✅ coberto na suíte de API (39 testes) |
| Paginação e limites | ✅ `limit/offset` + `X-Total-Count`; focos ≤ 31 dias por consulta |
| Uploads | ✅ ≤ 50 mil linhas e 15 MB por lote; revalidação no servidor |
| Falha de conexão | ✅ API responde 503, sem fallback em memória (teste) |
| Importação que falha no meio | ✅ rollback total (teste) |
| Dados pessoais em relatos | ✅ `denuncias.user_id` vira NULL se a conta for excluída |
| Backups cifrados e restauração testada | ✅ local e dentro do Compose |
