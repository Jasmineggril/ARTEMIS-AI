# 03 — API REST

Base: mesma origem do frontend. Autenticação por cookie de sessão `artemis.sid`. Corpo e respostas em JSON (UTF-8). Erros: `{ "message": "..." }`.

Papéis (hierarquia): `viewer` < `analyst` < `manager` < `admin` < `owner`. A coluna **Papel** indica o mínimo. A organização é sempre a **ativa na sessão**; IDs de organização enviados pelo cliente são recusados (`400`). Recursos de outra organização respondem `404`.

Códigos comuns: `400` validação · `401` sem sessão · `403` papel insuficiente / origem não autorizada · `404` inexistente ou de outra organização · `409` conflito · `422` dados insuficientes · `429` limite de requisições · `503` fonte externa indisponível.

## Autenticação

| Método | Rota | Papel | Corpo / observações |
|---|---|---|---|
| POST | `/api/auth/signup` | público | `{ name, email, password, organizationName?, organizationType?, acceptPrivacy: true }` → `201`. Cria usuário + organização (owner). |
| POST | `/api/auth/login` | público | `{ email, password }` → `200`. Mensagem genérica em falha. |
| POST | `/api/auth/logout` | sessão | Destrói a sessão no servidor. |
| GET | `/api/auth/status` | sessão | `{ userId, email, name, platformRole, organization: { id, name, type, role } }` |
| GET | `/api/auth/organizations` | sessão | Organizações do usuário com `active`. |
| POST | `/api/auth/switch-organization` | sessão | `{ organizationId }` — exige ser membro. |
| PUT | `/api/auth/password` | sessão | `{ currentPassword, newPassword }` |
| POST | `/api/auth/password-reset/request` | público | `{ email }` — resposta idêntica exista ou não o e-mail. |
| POST | `/api/auth/password-reset/confirm` | público | `{ token, newPassword }` — token de uso único, 30 min. |

## Organização

| Método | Rota | Papel | Observações |
|---|---|---|---|
| GET | `/api/organization` | viewer | Dados da organização + papel do usuário |
| GET | `/api/organization/members` | admin | |
| POST | `/api/organization/members` | admin | `{ email, role }` — usuário deve existir; só owner concede `owner` |
| PATCH | `/api/organization/members/:userId` | admin | `{ role }` |
| DELETE | `/api/organization/members/:userId` | admin | Não remove a si mesmo |
| GET | `/api/audit-logs?limit=` | admin | Máx. 1000 |

## Áreas monitoradas

| Método | Rota | Papel | Observações |
|---|---|---|---|
| GET | `/api/areas` | viewer | Inclui `latestAnalysis` |
| POST | `/api/areas` | manager | Ver esquema abaixo |
| GET | `/api/areas/:id` | viewer | |
| PATCH | `/api/areas/:id` | manager | Campos parciais |
| DELETE | `/api/areas/:id` | admin | Análises mantidas para rastreabilidade |
| GET | `/api/areas/:id/weather` | viewer | Open-Meteo para as coordenadas; `503` se a fonte falhar |

Esquema da área: `name` (2–160), `operationType` (`propriedade_rural`, `agroindustria`, `florestal`, `energia`, `mineracao`, `logistica`, `industria`, `unidade_conservacao`, `outro`), `municipality`, `state` (UF), `latitude`/`longitude` (juntas ou nenhuma), `areaHectares`, `status` (`ativo`, `inativo`, `em análise`), `vegetationCategory`, `boundary` (GeoJSON `Polygon`/`MultiPolygon`, [lon, lat], anéis fechados), `notes`.

## Análises de risco (CERES AI)

| Método | Rota | Papel | Observações |
|---|---|---|---|
| POST | `/api/areas/:id/analyses` | analyst | Limite 30/min |
| GET | `/api/areas/:id/analyses?limit=` | viewer | Mais recentes primeiro |
| GET | `/api/analyses/:id` | viewer | |
| GET | `/api/reports/areas/:id?from=&to=` | viewer | Relatório agregado do período (padrão: últimos 90 dias) |
| GET | `/api/reports/areas/:id/analyses.csv` | analyst | CSV UTF-8 com BOM; células que começam com `= + - @` são prefixadas com `'` |

Requisição:

```json
{
  "useLiveWeather": true,
  "inputs": {
    "temperature": 36, "humidity": 18, "windSpeed": 25, "recentRainfall": 0,
    "vegetationCondition": "dry",
    "nearbyHotspot": false, "hotspotDistance": 3,
    "historicalOccurrences": 2,
    "dataQuality": "good"
  },
  "notes": "opcional"
}
```

- Campos meteorológicos ausentes são preenchidos pelo Open-Meteo **somente** se `useLiveWeather=true`; valores informados sempre prevalecem.
- Se faltarem dados → `422 { missing: [...], connectorError }`. Nada é preenchido com valor padrão.
- `historicalOccurrences` ausente → contagem de ocorrências da organização a até 10 km.

Resposta (`201`): a análise armazenada com `score`, `level`, `factors[]`, `recommendations[]`, `engineType`, `calculationVersion`, `isExperimental`, `dataSources[]`, `dataQuality { level, provenance[], connectorError }`, `limitations[]`, `confidence: null` e `alert: { id, created } | null`.

## Alertas

| Método | Rota | Papel | Observações |
|---|---|---|---|
| GET | `/api/alerts?status=&areaId=` | viewer | `status`: um dos status ou `abertos` |
| GET | `/api/alerts/:id` | viewer | Inclui `events[]` e `allowedTransitions[]` |
| POST | `/api/alerts/:id/status` | analyst | `{ status, note?, assignToMe? }`; `descartado` exige `note`; transição inválida → `409` |

Transições: `novo → reconhecido | em_acompanhamento | resolvido | descartado`; `reconhecido → em_acompanhamento | resolvido | descartado`; `em_acompanhamento → resolvido | descartado`; `resolvido → em_acompanhamento`; `descartado → reconhecido`.

## Ocorrências e importação

| Método | Rota | Papel | Observações |
|---|---|---|---|
| POST | `/api/import-batches` | manager | `{ filename, sourceName?, records[] }` (≤ 50 000). Resposta com relatório do lote e `rejectionReasons`. |
| GET | `/api/import-batches` | viewer | |
| GET | `/api/import-batches/:id` | viewer | |
| GET | `/api/fire-occurrences?from=&to=&state=&municipality=&batchId=` | viewer | Datas `AAAA-MM-DD`; até 5000 registros |

## Painel, fontes e saúde

| Método | Rota | Papel | Observações |
|---|---|---|---|
| GET | `/api/dashboard/summary` | viewer | Cada bloco traz `source` e `lastUpdate` |
| GET | `/api/insights?from=&to=` | viewer | Análises por semana e nível, fatores frequentes, alertas por status, ocorrências por mês |
| GET | `/api/connectors` | público | Situação real de cada fonte |
| GET | `/api/health` | público | `{ status, database, riskEngine }` — sem dados |

## Rotas legadas mantidas

`GET/PUT /api/user/profile` (sem `role`), `/api/sensors*` e `/api/readings*` (leitura autenticada; escrita só `platform_admin`), `/api/weather/latest`, `POST /api/weather/fetch`, `GET /api/user-stats/me`, `POST /api/denuncias` (público, 5/h), `GET /api/denuncias` (`platform_admin`), `/api/chat*` (autenticado), `POST /api/python-risk-analysis` (simulador público, não armazena).

## Serviço interno de risco (FastAPI, não exposto)

`GET /health` · `POST /analyze-risk` · `GET /model-info` · documentação OpenAPI em `/docs` dentro da rede interna.
