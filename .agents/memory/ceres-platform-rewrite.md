---
name: CERES AI Platform Rewrite
description: Full platform transformation from CAR haCARthon app to industrial fire-risk prediction platform — key decisions and constraints.
---

## What was done
Complete 24-section spec rewrite. Stack preserved (React 18, Vite, Wouter, Tailwind, shadcn/ui, TanStack Query, Recharts, Leaflet, Express, Drizzle ORM, PostgreSQL).

## Key architecture decisions

- **Motor de risco:** `shared/risk-engine.ts` — deterministic, rule-based, v1.0.0. Isolated to enable future swap for supervised ML. Score 0–100, 4 levels: baixo/moderado/alto/crítico.
- **Thresholds:** 0–24 baixo, 25–49 moderado, 50–74 alto, 75–100 crítico.
- **DEMO_SCENARIOS.moderado must score ≥25:** historicalOccurrences:2 (not 1) to guarantee score=27. Otherwise sits at 24 (baixo boundary).
- **shared/identity.ts:** Centralized SUBMISSION_MODE, PRODUCT_NAME, SIMULATED_DATA_LABEL, DECISION_SUPPORT_DISCLAIMER, TRL_LABEL.
- **Chat service:** `server/chat-service.ts` — OpenAI gpt-4o-mini with offline keyword fallback. Always answers even without API key. Route: POST /api/chat.

## New DB tables
`monitored_areas`, `risk_analyses`, `data_sources` added to `shared/schema.ts`. Run `npm run db:push` after schema changes.

## Test command
`npm run test:risk` → 34 tests, all passing. Uses `node --import tsx/esm`.

## Pages created/rewritten
Home, Dashboard, RiskAnalysis (/simulacao), Areas, Prevention, CeresMaps, CeresInsights, Reports, Layout (nav updated), App.tsx (routes updated).

## Forbidden terms removed
haCARthon, CAR (Cadastro Ambiental Rural), SICAR references cleared from Login, Signup, ResetPassword. SimulacaoCar.tsx is orphan (not imported) — kept for archival.

## Docs written
`docs/trl4/` — README, EVIDENCIAS, RELATORIO_TESTES, ARQUITETURA_TECNICA, CHECKLIST_CAPTURAS, MATRIZ_FUNCIONALIDADES.

**Why:** Spec requires TRL 4 evidence package, all data simulated must be labeled, no personal names in submission mode.
