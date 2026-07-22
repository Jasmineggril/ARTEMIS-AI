"""
Testes da API FastAPI — POST /analyze-risk e GET /health
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

LOW_RISK = {
    "temperature": 24, "humidity": 78, "wind_speed": 8,
    "recent_rainfall": 25, "vegetation_condition": "humid",
    "nearby_hotspot": False, "hotspot_distance": None,
    "historical_occurrences": 0, "data_quality": "good",
}
CRITICAL_RISK = {
    "temperature": 42, "humidity": 15, "wind_speed": 45,
    "recent_rainfall": 0, "vegetation_condition": "very_dry",
    "nearby_hotspot": True, "hotspot_distance": 4,
    "historical_occurrences": 6, "data_quality": "good",
}


# ── GET /health ──────────────────────────────────────────────────────────────

def test_health_status_ok():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

def test_health_service_name():
    r = client.get("/health")
    assert "risk-analysis-python" in r.json()["service"]


# ── POST /analyze-risk — campos obrigatórios ─────────────────────────────────

def test_analyze_risk_returns_200():
    r = client.post("/analyze-risk", json=LOW_RISK)
    assert r.status_code == 200

def test_analyze_risk_has_required_fields():
    r = client.post("/analyze-risk", json=LOW_RISK)
    body = r.json()
    for field in ("score", "level", "confidence", "factors",
                  "recommendations", "model_type", "model_version",
                  "dataset_type", "is_simulated", "calculated_at"):
        assert field in body, f"Campo ausente: {field}"

def test_analyze_risk_score_in_range():
    for payload in [LOW_RISK, CRITICAL_RISK]:
        r = client.post("/analyze-risk", json=payload)
        score = r.json()["score"]
        assert 0 <= score <= 100, f"Score fora do intervalo [0,100]: {score}"

def test_analyze_risk_level_valid():
    for payload in [LOW_RISK, CRITICAL_RISK]:
        r = client.post("/analyze-risk", json=payload)
        assert r.json()["level"] in ("baixo", "moderado", "alto", "critico")

def test_analyze_risk_confidence_in_range():
    r = client.post("/analyze-risk", json=LOW_RISK)
    c = r.json()["confidence"]
    assert 0.0 <= c <= 1.0, f"Confiança fora de [0,1]: {c}"

def test_analyze_risk_model_type_present():
    r = client.post("/analyze-risk", json=LOW_RISK)
    mt = r.json()["model_type"]
    assert mt in ("transparent-rule-engine", "supervised-ml"), f"model_type inesperado: {mt}"

def test_analyze_risk_dataset_type_present():
    r = client.post("/analyze-risk", json=LOW_RISK)
    dt = r.json()["dataset_type"]
    assert dt in ("synthetic", "rule-based"), f"dataset_type inesperado: {dt}"

def test_analyze_risk_factors_not_empty():
    r = client.post("/analyze-risk", json=CRITICAL_RISK)
    assert len(r.json()["factors"]) > 0

def test_analyze_risk_recommendations_not_empty():
    r = client.post("/analyze-risk", json=CRITICAL_RISK)
    assert len(r.json()["recommendations"]) > 0

def test_analyze_risk_factor_fields():
    r = client.post("/analyze-risk", json=CRITICAL_RISK)
    for f in r.json()["factors"]:
        for key in ("name", "contribution", "description", "weight", "value"):
            assert key in f, f"Campo '{key}' ausente no factor: {f}"

def test_analyze_risk_recommendation_fields():
    r = client.post("/analyze-risk", json=CRITICAL_RISK)
    for rec in r.json()["recommendations"]:
        for key in ("priority", "action", "rationale"):
            assert key in rec, f"Campo '{key}' ausente na recommendation: {rec}"


# ── POST /analyze-risk — campos ausentes / inválidos ────────────────────────

def test_missing_temperature_returns_422():
    payload = {k: v for k, v in LOW_RISK.items() if k != "temperature"}
    r = client.post("/analyze-risk", json=payload)
    assert r.status_code == 422

def test_invalid_humidity_negative_returns_422():
    r = client.post("/analyze-risk", json={**LOW_RISK, "humidity": -1})
    assert r.status_code == 422

def test_invalid_humidity_over_100_returns_422():
    r = client.post("/analyze-risk", json={**LOW_RISK, "humidity": 110})
    assert r.status_code == 422

def test_invalid_wind_negative_returns_422():
    r = client.post("/analyze-risk", json={**LOW_RISK, "wind_speed": -5})
    assert r.status_code == 422

def test_empty_body_returns_422():
    r = client.post("/analyze-risk", json={})
    assert r.status_code == 422


# ── Resposta crítica ──────────────────────────────────────────────────────────

def test_critical_risk_high_score():
    r = client.post("/analyze-risk", json=CRITICAL_RISK)
    assert r.json()["score"] >= 50, "Cenário crítico deve ter score ≥ 50"

def test_critical_risk_level_not_low():
    r = client.post("/analyze-risk", json=CRITICAL_RISK)
    assert r.json()["level"] != "baixo"
