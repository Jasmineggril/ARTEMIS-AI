"""
Testes do motor de risco Python — engine, classificação e fallback ML.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from schemas import RiskInput
from risk_model import (
    analyze_risk, calculate_rule_score, classify_risk,
    validate_input, generate_recommendations, explain_factors,
    load_ml_model, predict_with_ml_model,
)


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def low_risk_input():
    return RiskInput(temperature=24, humidity=78, wind_speed=8,
        recent_rainfall=25, vegetation_condition="humid",
        nearby_hotspot=False, historical_occurrences=0, data_quality="good")

@pytest.fixture
def moderate_risk_input():
    return RiskInput(temperature=33, humidity=45, wind_speed=18,
        recent_rainfall=5, vegetation_condition="moderate",
        nearby_hotspot=False, historical_occurrences=2, data_quality="good")

@pytest.fixture
def high_risk_input():
    return RiskInput(temperature=38, humidity=28, wind_speed=28,
        recent_rainfall=0, vegetation_condition="dry",
        nearby_hotspot=True, hotspot_distance=20, historical_occurrences=3, data_quality="good")

@pytest.fixture
def critical_risk_input():
    return RiskInput(temperature=42, humidity=15, wind_speed=45,
        recent_rainfall=0, vegetation_condition="very_dry",
        nearby_hotspot=True, hotspot_distance=4, historical_occurrences=6, data_quality="good")


# ── Baixo risco ───────────────────────────────────────────────────────────────

def test_low_score_range(low_risk_input):
    score = calculate_rule_score(low_risk_input)
    assert 0 <= score <= 24, f"Score baixo esperado ≤24, obtido {score}"

def test_low_level(low_risk_input):
    result = analyze_risk(low_risk_input)
    assert result.level == "baixo"

def test_low_confidence_positive(low_risk_input):
    result = analyze_risk(low_risk_input)
    assert 0 < result.confidence <= 1.0


# ── Moderado ──────────────────────────────────────────────────────────────────

def test_moderate_level(moderate_risk_input):
    result = analyze_risk(moderate_risk_input)
    assert result.level in ("baixo", "moderado", "alto"), \
        f"Nível inesperado para input moderado: {result.level}"


# ── Alto risco ────────────────────────────────────────────────────────────────

def test_high_score_range(high_risk_input):
    score = calculate_rule_score(high_risk_input)
    assert score >= 50, f"Score alto esperado ≥50, obtido {score}"

def test_high_level(high_risk_input):
    result = analyze_risk(high_risk_input)
    assert result.level in ("alto", "critico")


# ── Crítico ───────────────────────────────────────────────────────────────────

def test_critical_score_range(critical_risk_input):
    score = calculate_rule_score(critical_risk_input)
    assert score >= 75, f"Score crítico esperado ≥75, obtido {score}"

def test_critical_level(critical_risk_input):
    result = analyze_risk(critical_risk_input)
    assert result.level == "critico"


# ── Score sempre em [0, 100] ──────────────────────────────────────────────────

@pytest.mark.parametrize("temp,hum,wind", [
    (50, 5, 80),    # extremo máximo
    (5, 99, 0),     # extremo mínimo
    (30, 50, 20),   # normal
])
def test_score_never_out_of_range(temp, hum, wind):
    inp = RiskInput(temperature=temp, humidity=min(hum, 100), wind_speed=wind)
    score = calculate_rule_score(inp)
    assert 0 <= score <= 100


# ── classify_risk ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("score,expected", [
    (0, "baixo"), (24, "baixo"),
    (25, "moderado"), (49, "moderado"),
    (50, "alto"), (74, "alto"),
    (75, "critico"), (100, "critico"),
])
def test_classify_risk(score, expected):
    assert classify_risk(score) == expected


# ── explain_factors ───────────────────────────────────────────────────────────

def test_factors_not_empty_for_critical(critical_risk_input):
    factors = explain_factors(critical_risk_input)
    assert len(factors) > 0

def test_factors_have_required_fields(critical_risk_input):
    for f in explain_factors(critical_risk_input):
        assert hasattr(f, "name") and f.name
        assert hasattr(f, "contribution")
        assert hasattr(f, "description") and f.description
        assert f.weight in ("alto", "médio", "baixo")
        assert hasattr(f, "value") and f.value


# ── generate_recommendations ──────────────────────────────────────────────────

def test_recommendations_for_all_levels():
    for level in ("baixo", "moderado", "alto", "critico"):
        recs = generate_recommendations(level)
        assert len(recs) > 0, f"Sem recomendações para {level}"

def test_recommendation_priorities_valid():
    valid_priorities = {"imediata", "urgente", "preventiva", "monitoramento"}
    for level in ("baixo", "moderado", "alto", "critico"):
        for rec in generate_recommendations(level):
            assert rec.priority in valid_priorities, \
                f"Priority inválida '{rec.priority}' para nível {level}"

def test_critical_has_immediate_action():
    recs = generate_recommendations("critico")
    priorities = {r.priority for r in recs}
    assert "imediata" in priorities


# ── RiskOutput completude ─────────────────────────────────────────────────────

def test_analyze_risk_output_fields(low_risk_input):
    result = analyze_risk(low_risk_input)
    assert result.score >= 0
    assert result.level in ("baixo", "moderado", "alto", "critico")
    assert 0 <= result.confidence <= 1
    assert result.model_type in ("transparent-rule-engine", "supervised-ml")
    assert result.dataset_type in ("rule-based", "synthetic")
    assert result.calculated_at
    assert isinstance(result.factors, list)
    assert isinstance(result.recommendations, list)


# ── Fallback ML indisponível ──────────────────────────────────────────────────

def test_fallback_to_rules_runs_without_error(low_risk_input, monkeypatch):
    """Se o modelo ML não estiver disponível, deve usar motor de regras sem exceção."""
    monkeypatch.setattr("risk_model.MODEL_PATH",
        __import__("pathlib").Path("/tmp/nonexistent_model.joblib"))
    result = analyze_risk(low_risk_input)
    assert result.score >= 0
    assert result.level in ("baixo", "moderado", "alto", "critico")
    assert result.model_type == "transparent-rule-engine"


# ── ML model (se treinado) ────────────────────────────────────────────────────

def test_ml_model_predict_if_available(low_risk_input):
    """Se o modelo estiver disponível, predict_with_ml_model não deve lançar exceção."""
    artifact = load_ml_model()
    if artifact is None:
        pytest.skip("Modelo ML não treinado — execute python train_model.py")
    score, confidence = predict_with_ml_model(artifact, low_risk_input)
    assert score is not None and 0 <= score <= 100
    assert confidence is not None and 0.0 <= confidence <= 1.0
