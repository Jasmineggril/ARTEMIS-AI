# 00 — Diagnóstico do repositório (Fase 1)

Data da auditoria: 15/11/2026 · Branch: `claude/friendly-cerf-x7tgnx` · Base: commit `ec5e5c2`

## 1. O que existia

| Camada | Estado encontrado |
|---|---|
| Frontend | React 18 + TS + Vite + Tailwind + shadcn/ui + Leaflet + Recharts. 21 páginas. |
| Backend | Express + Drizzle + PostgreSQL. Sessões `express-session` + bcrypt. |
| Serviço Python | FastAPI + Scikit-learn (Random Forest) + motor de regras. 104 testes pytest. |
| Migrações | `0000` e `0001` (Drizzle). |
| Deploy | Configuração Vercel (`vercel.json`, `api/index.ts`). Sem Docker. |
| Documentação | Pacote TRL 4 em `docs/trl4/` (preservado sem alterações). |

Linha de base medida antes de qualquer alteração: `tsc` 0 erros · testes TS 34 + 10 · pytest 104 · `npm run build` OK.

## 2. Problemas encontrados (todos verificados no código)

### Críticos — segurança e integridade

| # | Problema | Evidência | Situação |
|---|---|---|---|
| C1 | **Login do frontend era 100% local**: usuários e senhas em texto puro no `localStorage`, credencial demo fixa (`demo@ceres.ai` / `Demo123!`) pré-preenchida. O backend de sessão nunca era chamado pela interface. | `client/src/hooks/use-auth.ts`, `Login.tsx` | Corrigido |
| C2 | Três sistemas de autenticação concorrentes (sessão Express, Supabase opcional, `localStorage`). | idem + `lib/supabase.ts` | Unificado na sessão Express |
| C3 | **Escalonamento de privilégio**: `PUT /api/user/profile` aceitava o campo `role`. | `shared/routes.ts` | Corrigido (schema estrito) + teste |
| C4 | Endpoints sem autenticação: CRUD de sensores, `POST /api/user-stats/:id/add-points`, `GET /api/denuncias` (expunha dados pessoais de relatos). | `server/routes.ts` | Corrigido |
| C5 | Nenhum conceito de organização: qualquer usuário autenticado via todos os lotes de importação e ocorrências. | `server/routes.ts` | Corrigido (multi-organização) + testes de isolamento |
| C6 | `SESSION_SECRET` com valor padrão fixo no código; cookie sem `Secure`. | `server/index.ts` | Obrigatório em produção (≥ 32 caracteres) |
| C7 | Logs gravavam o corpo JSON completo de todas as respostas (dados pessoais). | `server/index.ts` | Logs estruturados sem corpos |
| C8 | Fallback de armazenamento em memória ativado silenciosamente em qualquer erro de banco — em produção, cadastros seriam perdidos. | `server/storage.ts` | Desativado por padrão; nunca em produção |
| C9 | Tabelas `import_batches` e `fire_occurrences` **não existiam em nenhuma migração**: a importação falharia em banco novo. | `migrations/` | Criadas na `0002` |
| C10 | CORS `*` no serviço Python. | `python_service/app.py` | Fechado por padrão |

### Integridade de dados e transparência

| # | Problema | Situação |
|---|---|---|
| D1 | Seed com afirmações falsas: "algoritmo com **94% de precisão**", "dados do INPE incorporados", "foco contido pelas equipes do **IBAMA**". | Seed removido; script demo novo, rotulado e bloqueado em produção |
| D2 | O modelo RF (treinado com **dados sintéticos**) era usado **por padrão** sempre que o `.joblib` existia. | Motor de regras é o padrão; ML exige `RISK_ENGINE_MODE=ml-experimental` e é sinalizado |
| D3 | "Confiança: 95%" exibida — derivada apenas da qualidade declarada, não calibrada. | Removida da interface; `confidence = null` nas análises armazenadas |
| D4 | Dashboard, Áreas, Mapa e Relatórios usavam arrays fixos no código; "Fontes de dados: Online" fixo (`activeSensors \|\| 3`). | Dashboard, Áreas, Mapa: dados reais. Relatórios/Insights: pendente |
| D5 | Análises de risco **não eram armazenadas** (não havia rota). | `POST /api/areas/:id/analyses` com proveniência |
| D6 | Datas `DD/MM/AAAA` gravadas sem normalização (quebra filtros por período); datas impossíveis aceitas. | Normalizador compartilhado cliente/servidor |
| D7 | Rotas `/api/weather/*` chamadas pelo frontend não existiam. | Implementadas |
| D8 | Textos "tempo real" / "Sistema Online" sem fonte contínua. | Corrigidos |

### Interface e acessibilidade

| # | Problema | Situação |
|---|---|---|
| U1 | Modal de tutorial abria sobre a tela de cadastro, bloqueando o formulário. | Só para usuário autenticado, fora das páginas públicas |
| U2 | No celular, a barra lateral ocupava toda a primeira tela. | Menu recolhível |
| U3 | `maximum-scale=1` bloqueava zoom (WCAG 1.4.4). | Corrigido |
| U4 | Contraste insuficiente em textos das telas de autenticação. | Corrigido |
| U5 | Diálogos cortados pela metade (ancestral com `transform`). | Renderizados via portal |

## 3. Decisões de arquitetura

- **Estrutura de pastas preservada** (`client/`, `server/`, `shared/`, `python_service/`) em vez de migrar para `apps/web`, `apps/api`, `services/risk-engine`. Mapeamento equivalente em `02_ARQUITETURA.md`. Motivo: a migração quebraria imports, testes, build e documentação TRL 4 sem ganho funcional nesta fase.
- **Sem PostGIS por enquanto**: consultas espaciais atuais (raio de 10 km, caixa delimitadora) resolvidas em SQL + haversine. PostGIS entra quando houver consultas de interseção de polígonos.
- **Sem novas dependências pagas**. Única dependência nova: `axe-core` (dev, MIT).
- **Supabase removido do frontend** (`@supabase/supabase-js`). O backend continua aceitando `SUPABASE_DATABASE_URL` como opção de Postgres gerenciado.
- **Vercel mantido como alvo legado**; alvo principal passa a ser Docker Compose em VPS.

## 4. Consulta pública (proposta original do projeto Florestaí)

A proposta original (consulta a dados do Sisfogo, geolocalização, filtros por data/local/horário, gráficos, denúncias) foi incorporada à ARTEMIS AI como **Consulta Pública** (`/consulta-publica`), alimentada por lotes que as organizações publicam explicitamente. O canal de relatos com moderação ainda está pendente.

## 5. Identidade

Toda a interface, a API, o serviço Python e a documentação nova usam o nome **ARTEMIS AI**. Os nomes anteriores permanecem apenas nos registros históricos (`docs/trl4/`, `CERES-AI/`, `archive/`, `attached_assets/`) e no modo opcional de submissão anônima (`VITE_SUBMISSION_MODE=true`), que usa um nome genérico.
