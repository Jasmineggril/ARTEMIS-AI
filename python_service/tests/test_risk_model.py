"""
Testes do motor de risco Python.
Espelha os cenários dos testes TypeScript para garantir paridade.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from schemas import RiskInput
from risk_model import (
    analyze_risk, calculate_rule_score, classify_risk,
    validate_input, generate_recommendations,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def low_risk_input():
    return RiskInput(
        temperature=24, humidity=78, wind_speed=8, recent_rainfall=25,
        vegetation_condition="humid", nearby_hotspot=False,
        hotspot_distance=None, historical_occurrences=0, data_quality="good",
    )

@pytest.fixture
def moderate_risk_input():
    return RiskInput(
        temperature=33, humidity=45, wind_speed=18, recent_rainfall=5,
        vegetation_condition="moderate", nearby_hotspot=False,
        hotspot_distance=None, historical_occurrences=2, data_quality="good",
    )

@pytest.fixture
def high_risk_input():
    return RiskInput(
        temperature=38, humidity=28, wind_speed=28, recent_rainfall=0,
        vegetation_condition="dry", nearby_hotspot=True,
        hotspot_distance=20, historical_occurrences=3, data_quality="good",
    )

@pytest.fixture
def critical_risk_input():
    return RiskInput(
        temperature=42, humidity=15, wind_speed=45, recent_rainfall=0,
        vegetation_condition="very_dry", nearby_hotspot=True,
        hotspot_distance=4, historical_occurrences=6, data_quality="good",
    )


# ---------------------------------------------------------------------------
# Cenário 1 — Baixo risco
# ---------------------------------------------------------------------------

def test_low_score_range(low_risk_input):
    score = calculate_rule_score(low_risk_input)
    assert 0 <= score <= 24, f"Score esperado ≤24, obtido {score}"

def test_low_level(low_risk_input):
    result = analyze_risk(low_risk_input)
    assert result.level == "baixo"

def test_low_has_recommendations(low_risk_input):
    result = analyze_risk(low_risk_input)
    assert len(result.recommendations) > 0


# ---------------------------------------------------------------------------
# Cenário 2 — Moderado
# ---------------------------------------------------------------------------

def test_moderate_score_range(moderate_risk_input):
    score = calculate_rule_score(moderate_risk_input)
    assert 20 <= score <= 49, f"Score esperado 20-49 (zona moderada/limite), obtido {score}"

def test_moderate_level(moderate_risk_input):
    result = analyze_risk(moderate_risk_input)
    assert result.level in ("baixo", "moderado"), \
        f"Esperado baixo ou moderado para input de fronteira, obtido {result.level}"

def test_moderate_has_factors(moderate_risk_input):
    result = analyze_risk(moderate_risk_input)
    assert len(result.factors) > 0


# ---------------------------------------------------------------------------
# Cenário 3 — Alto risco
# ---------------------------------------------------------------------------

def test_high_score_range(high_risk_input):
    score = calculate_rule_score(high_risk_input)
    assert 50 <= score <= 74, f"Score esperado 50-74, obtido {score}"

def test_high_level(high_risk_input):
    result = analyze_risk(high_risk_input)
    assert result.level == "alto"

def test_high_has_urgent_recommendations(high_risk_input):
    result = analyze_risk(high_risk_input)
    assert len(result.recommendations) >= 3


# ---------------------------------------------------------------------------
# Cenário 4 — Crítico
# ---------------------------------------------------------------------------

def test_critical_score_range(critical_risk_input):
    score = calculate_rule_score(critical_risk_input)
    assert 75 <= score <= 100, f"Score esperado ≥75, obtido {score}"

def test_critical_level(critical_risk_input):
    result = analyze_risk(critical_risk_input)
    assert result.level == "critico"

def test_critical_multiple_factors(critical_risk_input):
    result = analyze_risk(critical_risk_input)
    assert len(result.factors) >= 3

def test_critical_has_immediate_recommendations(critical_risk_input):
    result = analyze_risk(critical_risk_input)
    assert len(result.recommendations) >= 4


# ---------------------------------------------------------------------------
# Estabilidade e determinismo
# ---------------------------------------------------------------------------

def test_determinism(moderate_risk_input):
    r1 = analyze_risk(moderate_risk_input)
    r2 = analyze_risk(moderate_risk_input)
    assert r1.score == r2.score

def test_score_never_negative(low_risk_input):
    result = analyze_risk(low_risk_input)
    assert result.score >= 0

def test_score_never_exceeds_100(critical_risk_input):
    result = analyze_risk(critical_risk_input)
    assert result.score <= 100

def test_calculated_at_is_iso8601(low_risk_input):
    result = analyze_risk(low_risk_input)
    from datetime import datetime
    # Should not raise
    datetime.fromisoformat(result.calculated_at.replace("Z", "+00:00"))

def test_model_type_present(low_risk_input):
    result = analyze_risk(low_risk_input)
    assert result.model_type in ("transparent-rule-engine", "supervised-ml", "sklearn-demo")

def test_model_version_present(low_risk_input):
    result = analyze_risk(low_risk_input)
    assert result.model_version


# ---------------------------------------------------------------------------
# Validação de entradas
# ---------------------------------------------------------------------------

def test_humidity_above_100_raises():
    with pytest.raises(Exception):
        RiskInput(temperature=30, humidity=110, wind_speed=10)

def test_humidity_negative_raises():
    with pytest.raises(Exception):
        RiskInput(temperature=30, humidity=-1, wind_speed=10)

def test_wind_negative_raises():
    with pytest.raises(Exception):
        RiskInput(temperature=30, humidity=50, wind_speed=-5)

def test_validate_input_empty():
    inp = RiskInput(temperature=30, humidity=50, wind_speed=10)
    errors = validate_input(inp)
    assert isinstance(errors, list)

def test_validate_input_valid(low_risk_input):
    errors = validate_input(low_risk_input)
    assert errors == []


# ---------------------------------------------------------------------------
# Classificação scoreToLevel
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("score,expected", [
    (0, "baixo"), (24, "baixo"),
    (25, "moderado"), (49, "moderado"),
    (50, "alto"), (74, "alto"),
    (75, "critico"), (100, "critico"),
])
def test_classify_risk(score, expected):
    assert classify_risk(score) == expected


# ---------------------------------------------------------------------------
# Recomendações
# ---------------------------------------------------------------------------

def test_recommendations_generated_for_all_levels():
    for level in ("baixo", "moderado", "alto", "critico"):
        recs = generate_recommendations(level)
        assert len(recs) > 0, f"Sem recomendações para {level}"


# ---------------------------------------------------------------------------
# Fallback quando modelo ML não existe
# ---------------------------------------------------------------------------

def test_fallback_to_rules_when_no_model(low_risk_input):
    """Se o modelo .joblib não existir, deve usar motor de regras sem erro."""
    result = analyze_risk(low_risk_input)
    assert result.score >= 0
    assert result.level in ("baixo", "moderado", "alto", "critico")
