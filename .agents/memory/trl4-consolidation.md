---
name: TRL4 Consolidation
description: Key architectural and veracidade decisions made during the TRL4 audit and implementation
---

# TRL4 Consolidation Decisions

## Route changes
- `/simulacao` kept for backward compat; added `/risk-analysis` as canonical route
- `/data-import` → DataImport.tsx (new)
- `/data-sources` → DataSources.tsx (new, replaces /sensors for data source listing)
- Sidebar updated: 13 items matching spec exactly

## Identity / Submission Mode
- `shared/identity.ts` already had VITE_SUBMISSION_MODE toggle with PRODUCT_NAME
- OnboardingTour uses PRODUCT_NAME from shared/identity.ts
- All new pages use Layout (which uses PRODUCT_NAME)

## Import module (DataImport.tsx)
- Client-side CSV parsing (parseCSV, autoMap, validateRows) — no extra library needed
- Backend: POST /api/import-batches saves to import_batches + fire_occurrences tables
- GET /api/import-batches, GET /api/fire-occurrences routes added to server/routes.ts
- Demo CSV at public/demo-ocorrencias.csv (20 synthetic records, Centro-Oeste Brazil)
- Aviso mandatório: "não representa conexão direta ou oficial com o Sisfogo"

## DB migration approach
- drizzle-kit push requires TTY (fails in shell); use `psql $DATABASE_URL -c "CREATE TABLE IF NOT EXISTS..."` for non-interactive additions
- Tables added: import_batches, fire_occurrences (added to shared/schema.ts)

## Veracidade rules enforced
- Motor transparente: model_type = "transparent-rule-engine" (not ML)
- Modelo RF: model_type = "supervised-ml", dataset_type = "synthetic"
- All simulated data labeled with SIMULATED_DATA_LABEL from shared/identity.ts
- No "integração oficial com Sisfogo" claims anywhere

## TRL4 docs (docs/trl4/final/)
- 9 markdown files: evidências, testes, arquitetura, evidências visuais, métricas, rastreabilidade, ficha IA, checklist, importação histórica
- All anonimized (no personal names, emails, institutions)

**Why:** Spec (1980-line document) requires strict veracidade: any claim must be backed by code or execution. Any synthetic data must be labeled. Integration with external systems must not be overstated.
