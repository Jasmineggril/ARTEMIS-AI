"""
CERES AI — Python Risk Analysis Service (FastAPI)

Este serviço implementa o motor de classificação de risco de incêndio em Python,
preparado para futura integração com modelo supervisionado Scikit-learn.

Motor atual: transparent-rule-engine (regras documentadas, sem ML treinado).
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timezone

from schemas import RiskInput, RiskOutput, HealthResponse
from risk_model import analyze_risk, validate_input

app = FastAPI(
    title="CERES AI — Risk Analysis Service",
    description=(
        "Serviço Python de análise de risco de incêndio. "
        "Motor atual: regras transparentes. "
        "Prova de Valor prevê modelo supervisionado com dados representativos."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
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
