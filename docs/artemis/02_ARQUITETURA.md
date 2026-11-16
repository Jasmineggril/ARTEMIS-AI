# 02 — Arquitetura

## Visão geral

```
                 Internet (HTTPS 443)
                        │
                 ┌──────▼──────┐
                 │    Caddy    │  TLS automático (Let's Encrypt), gzip/zstd
                 └──────┬──────┘
        rede "edge"     │
                 ┌──────▼──────────────────────────┐
                 │ api  (Node 22 / Express)        │  serve o SPA (React) + /api/*
                 │  sessões · RBAC · auditoria     │──► Open-Meteo (HTTPS, sob demanda)
                 └──────┬───────────────┬──────────┘
        rede "internal" │ (sem internet)│
                 ┌──────▼─────┐   ┌─────▼────────────┐
                 │ PostgreSQL │   │ risk-engine      │  FastAPI · regras (padrão)
                 │ 16         │   │ (Python 3.12)    │  · RF experimental (opcional)
                 └────────────┘   └──────────────────┘
```

Se o `risk-engine` não responder em 5 s, a API usa o motor de regras TypeScript equivalente (`shared/risk-engine.ts`) e registra isso nas limitações da análise.

## Mapeamento de pastas

O prompt mestre sugere `apps/web`, `apps/api`, `services/risk-engine`. A estrutura existente foi **mantida** (ver diagnóstico, seção 3):

| Sugerido | Atual |
|---|---|
| `apps/web/` | `client/` |
| `apps/api/` | `server/` (+ `api/` adaptador Vercel legado) |
| `services/risk-engine/` | `python_service/` |
| `packages/shared/` | `shared/` (schema Drizzle, motor TS, UFs, datas, identidade) |
| `database/` | `migrations/` |
| `infrastructure/docker`, `infrastructure/nginx` | `infrastructure/docker`, `infrastructure/caddy` |
| `tests/` | `tests/` (unit, integration, e2e) + `python_service/tests/` |

## Backend (`server/`)

| Arquivo | Papel |
|---|---|
| `app.ts` | Fábrica do app: sessão, cabeçalhos, verificação de origem, logs, rotas, erros |
| `index.ts` | Migrações (fatal em produção), Vite (dev) ou estáticos (prod), encerramento gracioso |
| `security.ts` | Cabeçalhos, origem, limitador, `requireAuth`, `requireOrg(papel)` |
| `auth-routes.ts` | Cadastro, login, logout, status, troca de organização, senha, redefinição |
| `artemis-routes.ts` | Organização, áreas, análises, alertas, ocorrências, dashboard, CSV, auditoria, conectores, health |
| `routes.ts` | Rotas legadas (perfil, sensores, clima, chat, simulador público, importação) |
| `services/risk-service.ts` | Procedência das entradas, chamada ao motor, limitações |
| `services/alert-service.ts` | Ciclo de vida e deduplicação de alertas |
| `services/audit.ts` | Gravação de auditoria |
| `connectors/open-meteo.ts` | Conector meteorológico com validação |

## Modelo de dados

Tabelas novas na migração `0002`: `organizations`, `organization_members`, `alert_events`, `audit_logs`, `password_reset_tokens` (+ criação de `import_batches` e `fire_occurrences`, que faltavam).

Colunas novas: `organization_id` em `monitored_areas`, `risk_analyses`, `alerts`, `import_batches`, `fire_occurrences`; procedência em `risk_analyses` (`engine_type`, `is_experimental`, `data_sources`, `data_quality`, `limitations`); ciclo de vida em `alerts` (`status`, `reason`, `assigned_to`, `dedup_key`, `occurrence_count`, `is_demo`…).

Restrições: chaves estrangeiras com `ON DELETE` explícito; `CHECK` em papel, status de alerta, coordenadas e índice 0–100; índice único `(organization_id, user_id)`.

### Relação com a lista do prompt mestre

| Entidade proposta | Situação |
|---|---|
| users, organizations, organization_members | ✅ |
| roles, permissions | Papéis fixos (`CHECK`) + hierarquia em código. Tabelas dedicadas só se surgirem permissões customizáveis. |
| monitored_areas, area_boundaries | ✅ (limite em `monitored_areas.boundary`, GeoJSON) |
| risk_analyses, risk_factors | ✅ (fatores em JSON na análise; tabela separada desnecessária por ora) |
| model_versions | ⏳ (versão gravada em cada análise; registro de modelos pendente) |
| alerts, alert_events | ✅ |
| fire_occurrences, import_batches | ✅ · import_records: os registros inválidos ficam contados por motivo no lote, não armazenados individualmente |
| audit_logs | ✅ |
| incident_reports | ⏳ (tabela legada `denuncias`) |
| data_sources, source_sync_runs | Registro de conectores via `/api/connectors` · ⏳ execuções de sincronização |
| weather_observations, sensors, sensor_readings | Legado (`weather_data`, `sensors`, `readings`), ainda sem escopo de organização |
| reports, pilot_projects, validation_metrics, notification_preferences | ⏳ |

### Retenção (proposta, a aprovar)

`audit_logs` 12 meses · `password_reset_tokens` expirados: limpeza periódica (pendente) · sessões: expiram em 8 h (tabela `session` do `connect-pg-simple`, limpeza automática).

## Motor de risco

- **Padrão:** motor de regras transparente (`RISK_ENGINE_MODE=rules`), implementado em Python e espelhado em TypeScript.
- **Experimental:** Random Forest treinado com dataset sintético. Ativado só com `RISK_ENGINE_MODE=ml-experimental`; toda análise resultante leva `is_experimental=true` e aviso nas limitações.
- `GET /model-info` (serviço interno) descreve o modo ativo e as métricas sintéticas com aviso.
- Sem porcentagens de confiança: o campo `confidence` das análises armazenadas é `null`.
