---
name: Python ML Pipeline
description: Architecture and decisions for the CERES AI Python risk classification service
---

# Python ML Pipeline

## Model
- File: `python_service/models/risk_classifier.joblib`
- Algorithm: `RandomForestClassifier` (4 classes: baixo/moderado/alto/crítico)
- Trained with: synthetic dataset from rule engine (2000 samples)
- Version: `1.0.0-sklearn-rf`
- model_type returned: `"supervised-ml"` (vs `"transparent-rule-engine"` when fallback)

## Schema contract (schemas.py)
- `RiskFactor`: `{name, contribution: int, description, weight: "alto"|"médio"|"baixo", value}`
- `RiskRecommendation`: `{priority: "imediata"|"urgente"|"preventiva"|"monitoramento", action, rationale}`
- `RiskOutput` includes `dataset_type` field: `"synthetic"` or `"rule-based"`

**Why:** Frontend uses these exact field names to render factors and recommendations. Breaking changes here break the UI.

## Express integration
- Route: `POST /api/python-risk-analysis` in `server/routes.ts`
- Forwards to `http://127.0.0.1:8000/analyze-risk`
- Fallback to TypeScript engine if Python unavailable (returns `model_type: "transparent-rule-engine-ts-fallback"`)

## Frontend (RiskAnalysis.tsx)
- Calls `/api/python-risk-analysis` (not the local TS calculateRisk function)
- Shows model_type badge: "Modelo supervisionado experimental" (violet) or "Motor demonstrativo baseado em regras"
- State type is `AnalysisResult` (not `RiskResult`) to include Python-specific fields

## Tests
- 104 tests total: test_api.py (20), test_model.py (27), test_validation.py (23), test_risk_model.py (34)
- Run: `cd python_service && python -m pytest tests/ -v`
- Moderate-risk fixture gives rule score=24 (boundary baixo/moderado) — tests accept both levels

## Training / Evaluation
- `python train_model.py` — generates dataset, trains, saves model + metrics.json + confusion_matrix.png
- `python evaluate_model.py` — re-evaluates saved model on test set
- Metrics (synthetic dataset): Accuracy=0.84, F1 macro=0.87, F1 weighted=0.84

**Why:** Dataset is synthetic (rule-engine-generated labels). These metrics show technical viability only, not operational accuracy. Never declare as validated AI.
