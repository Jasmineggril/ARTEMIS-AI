"""
ARTEMIS AI — Python Risk Analysis Service (FastAPI)

Este serviço implementa o motor de classificação de risco de incêndio em Python,
preparado para futura integração com modelo supervisionado Scikit-learn.

Motor atual: transparent-rule-engine (regras documentadas, sem ML treinado).
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from schemas import RiskInput, RiskOutput, HealthResponse
from risk_model import analyze_risk, validate_input, get_engine_mode, load_ml_model, MODEL_VERSION

app = FastAPI(
    title="ARTEMIS AI — Risk Analysis Service",
    description=(
        "Serviço Python de análise de risco de incêndio. "
        "Motor atual: regras transparentes. "
        "Prova de Valor prevê modelo supervisionado com dados representativos."
    ),
    version="1.0.0",
)

# The service is internal (called by the Node API). CORS is closed by default;
# set ALLOWED_ORIGINS (comma-separated) only if a browser must call it directly.
_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )


@app.get("/health", response_model=HealthResponse)
def health_check():
    return HealthResponse(status="ok", service="risk-analysis-python")


@app.post("/analyze-risk", response_model=RiskOutput)
def analyze_risk_endpoint(payload: RiskInput):
    errors = validate_input(payload)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    return analyze_risk(payload, is_simulated=False)


@app.get("/model-info")
def model_info():
    """Describe the active engine and the experimental model (if present)."""
    metrics_path = Path(__file__).parent / "results" / "metrics.json"
    metrics = None
    if metrics_path.exists():
        try:
            metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
        except Exception:
            metrics = None
    artifact = load_ml_model()
    return {
        "engine_mode": get_engine_mode(),
        "rule_engine_version": MODEL_VERSION,
        "ml_model_available": artifact is not None,
        "ml_model_version": artifact.get("version") if isinstance(artifact, dict) else None,
        "ml_dataset_type": "synthetic",
        "ml_metrics_warning": (
            "Métricas obtidas com dataset sintético em ambiente controlado; "
            "não representam desempenho em incêndios reais."
        ),
        "ml_metrics": metrics,
    }
