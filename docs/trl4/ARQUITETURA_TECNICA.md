# Arquitetura Técnica — Plataforma Preditiva de Inteligência Ambiental

## Diagrama de Alto Nível

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend (React/Vite)                        │
│                                                                  │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  Wouter   │  │ TanStack     │  │    shadcn/ui + Tailwind   │ │
│  │  Routing  │  │ React Query  │  │    Recharts + Leaflet     │ │
│  └───────────┘  └──────────────┘  └──────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP REST (JSON)
┌───────────────────────────▼─────────────────────────────────────┐
│                    Backend (Express/Node.js)                      │
│                                                                  │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────────────────┐  │
│  │   Routes     │  │  Sessions   │  │   Weather Service     │  │
│  │ server/      │  │ (pg-simple) │  │   (Open-Meteo API)    │  │
│  │ routes.ts    │  └─────────────┘  └───────────────────────┘  │
│  └──────┬───────┘                                               │
│         │                                                        │
│  ┌──────▼───────┐  ┌─────────────────────────────────────────┐ │
│  │  Storage     │  │     Chat Service (OpenAI gpt-4o-mini)   │ │
│  │ server/      │  │  + offline fallback por palavras-chave   │ │
│  │ storage.ts   │  └─────────────────────────────────────────┘ │
│  └──────┬───────┘                                               │
└─────────┼───────────────────────────────────────────────────────┘
          │
┌─────────▼──────────┐    ┌─────────────────────────┐
│   PostgreSQL        │    │     Open-Meteo API       │
│   (Drizzle ORM)     │    │  (dados climáticos reais)│
│                     │    │  sem autenticação        │
│   Tabelas:          │    └─────────────────────────┘
│   - users           │
│   - sensors         │    ┌─────────────────────────┐
│   - readings        │    │     OpenAI API           │
│   - alerts          │    │   (gpt-4o-mini)          │
│   - weather_data    │    │   Assistente de chat     │
│   - monitored_areas │    └─────────────────────────┘
│   - risk_analyses   │
│   - data_sources    │
└─────────────────────┘

shared/ (isomórfico — compartilhado entre frontend e backend):
  - risk-engine.ts  → Motor determinístico de classificação de risco
  - identity.ts     → Controle de identidade e modo de submissão
  - schema.ts       → Schema Drizzle + tipos TypeScript
  - routes.ts       → Contrato tipado da API
```

## Camadas

### Frontend (`client/`)
- **Framework:** React 18 com TypeScript
- **Build:** Vite
- **Roteamento:** Wouter (SPA)
- **Estado remoto:** TanStack React Query (cache + invalidação)
- **UI:** shadcn/ui (componentes) + Tailwind CSS (estilos)
- **Gráficos:** Recharts
- **Mapas:** Leaflet + react-leaflet
- **Autenticação:** Supabase Auth (frontend) + express-session (backend)

### Backend (`server/`)
- **Runtime:** Node.js + TypeScript (tsx para desenvolvimento)
- **Framework:** Express.js
- **ORM:** Drizzle ORM
- **Banco:** PostgreSQL gerenciado pela Replit
- **Sessões:** connect-pg-simple + express-session
- **Chat IA:** OpenAI gpt-4o-mini (com fallback offline)

### Shared (`shared/`)
- **Motor de risco:** `risk-engine.ts` — determinístico, isolado, versionado
- **Identidade:** `identity.ts` — controle de SUBMISSION_MODE e disclaimers
- **Schema:** `schema.ts` — único ponto de verdade para tipos de banco e API
- **Rotas:** `routes.ts` — contrato tipado para evitar inconsistências

## Motor de Risco

```
Entrada (RiskInput)
  → validateRiskInput()          → Validação de bounds
  → calculateScore()             → Cálculo por fator com weights
     ├── temperatura (0–20 pts)
     ├── umidade (0–20 pts)
     ├── vento (0–15 pts)
     ├── chuva recente (−15–0 pts)
     ├── vegetação (0–15 pts)
     ├── foco próximo (0–20 pts)
     └── histórico (0–10 pts)
  → clamp(0, 100)               → Limitar score
  → scoreToLevel()              → Classificar nível
  → buildRecommendations()      → Gerar recomendações
  → RiskResult                  → Resultado com metadados
```

**Decisão arquitetural:** O motor é separado da interface para facilitar futura substituição por modelo ML supervisionado sem impacto na UI.

## Decisões de Design

| Decisão | Razão |
|---|---|
| Motor baseado em regras (não ML) | Transparência, explicabilidade e TRL 4 controlado |
| Motor em `shared/` (isomórfico) | Executa tanto no browser quanto no servidor |
| TypeScript end-to-end | Segurança de tipos entre frontend, backend e shared |
| `SUBMISSION_MODE` centralizado | Ocultar identidade dos proponentes em avaliação |
| Fallback offline no chat | Garantir resposta mesmo com API OpenAI pausada |
| `SIMULATED_DATA_LABEL` em todo dado simulado | Conformidade com exigência de rastreabilidade |

## Fluxo de Autenticação

```
Signup/Login → POST /api/auth/register ou /api/auth/login
            → Verifica/cria usuário no PostgreSQL
            → Cria sessão (express-session + PostgreSQL)
            → Cookie de sessão retornado
            
Requisições protegidas:
  → Cookie de sessão enviado automaticamente
  → isAuthenticated middleware verifica sessão
  → 401 se não autenticado
```

## API Endpoints

| Método | Rota | Descrição |
|---|---|---|
| POST | /api/auth/register | Criar conta |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Usuário atual |
| POST | /api/chat | Chat com IA (OpenAI + fallback) |
| GET | /api/sensors | Listar sensores/fontes |
| GET | /api/alerts | Listar alertas |
| PATCH | /api/alerts/:id/resolve | Resolver alerta |
| GET | /api/weather | Dados climáticos |
