"""
Testes de validação de input — campos ausentes, inválidos e de borda.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from pydantic import ValidationError
from schemas import RiskInput
from risk_model import validate_input, analyze_risk


# ── Campos obrigatórios ───────────────────────────────────────────────────────

def test_missing_temperature_raises():
    with pytest.raises(ValidationError):
        RiskInput(humidity=50, wind_speed=10)  # type: ignore[call-arg]

def test_missing_humidity_raises():
    with pytest.raises(ValidationError):
        RiskInput(temperature=30, wind_speed=10)  # type: ignore[call-arg]

def test_missing_wind_speed_raises():
    with pytest.raises(ValidationError):
        RiskInput(temperature=30, humidity=50)  # type: ignore[call-arg]


# ── Valores inválidos ─────────────────────────────────────────────────────────

def test_humidity_negative_raises():
    with pytest.raises(ValidationError):
        RiskInput(temperature=30, humidity=-1, wind_speed=10)

def test_humidity_over_100_raises():
    with pytest.raises(ValidationError):
        RiskInput(temperature=30, humidity=101, wind_speed=10)

def test_wind_negative_raises():
    with pytest.raises(ValidationError):
        RiskInput(temperature=30, humidity=50, wind_speed=-5)

def test_rainfall_negative_raises():
    with pytest.raises(ValidationError):
        RiskInput(temperature=30, humidity=50, wind_speed=10, recent_rainfall=-1)

def test_historical_negative_raises():
    with pytest.raises(ValidationError):
        RiskInput(temperature=30, humidity=50, wind_speed=10, historical_occurrences=-1)

def test_hotspot_distance_negative_raises():
    with pytest.raises(ValidationError):
        RiskInput(temperature=30, humidity=50, wind_speed=10, hotspot_distance=-1)


# ── Valores de borda válidos ──────────────────────────────────────────────────

def test_humidity_zero_valid():
    inp = RiskInput(temperature=30, humidity=0, wind_speed=10)
    assert inp.humidity == 0

def test_humidity_100_valid():
    inp = RiskInput(temperature=30, humidity=100, wind_speed=10)
    assert inp.humidity == 100

def test_wind_zero_valid():
    inp = RiskInput(temperature=30, humidity=50, wind_speed=0)
    assert inp.wind_speed == 0

def test_rainfall_zero_valid():
    inp = RiskInput(temperature=30, humidity=50, wind_speed=10, recent_rainfall=0)
    assert inp.recent_rainfall == 0

def test_historical_zero_valid():
    inp = RiskInput(temperature=30, humidity=50, wind_speed=10, historical_occurrences=0)
    assert inp.historical_occurrences == 0


# ── validate_input (manual) ───────────────────────────────────────────────────

def test_validate_input_returns_empty_for_valid():
    inp = RiskInput(temperature=30, humidity=50, wind_speed=10)
    assert validate_input(inp) == []

def test_validate_input_is_list():
    inp = RiskInput(temperature=30, humidity=50, wind_speed=10)
    assert isinstance(validate_input(inp), list)


# ── Análise completa com dados de borda ──────────────────────────────────────

def test_analyze_extreme_low_risk():
    inp = RiskInput(temperature=15, humidity=95, wind_speed=0,
        recent_rainfall=50, vegetation_condition="humid",
        nearby_hotspot=False, historical_occurrences=0, data_quality="excellent")
    result = analyze_risk(inp)
    assert result.score >= 0
    assert result.level == "baixo"

def test_analyze_extreme_critical():
    inp = RiskInput(temperature=45, humidity=10, wind_speed=60,
        recent_rainfall=0, vegetation_condition="very_dry",
        nearby_hotspot=True, hotspot_distance=1,
        historical_occurrences=8, data_quality="poor")
    result = analyze_risk(inp)
    assert result.score >= 75
    assert result.level == "critico"

def test_analyze_hotspot_none_distance():
    """nearby_hotspot=False com hotspot_distance=None não deve gerar erro."""
    inp = RiskInput(temperature=30, humidity=50, wind_speed=10,
        nearby_hotspot=False, hotspot_distance=None)
    result = analyze_risk(inp)
    assert result.score >= 0

def test_analyze_defaults_work():
    """Campos opcionais com defaults não devem lançar exceção."""
    inp = RiskInput(temperature=30, humidity=50, wind_speed=10)
    result = analyze_risk(inp)
    assert result.level in ("baixo", "moderado", "alto", "critico")


# ── Análise armazena metadados ────────────────────────────────────────────────

def test_result_has_calculated_at():
    inp = RiskInput(temperature=30, humidity=50, wind_speed=10)
    result = analyze_risk(inp)
    assert result.calculated_at
    assert "T" in result.calculated_at  # ISO 8601

def test_result_is_simulated_false_by_default():
    inp = RiskInput(temperature=30, humidity=50, wind_speed=10)
    result = analyze_risk(inp, is_simulated=False)
    assert result.is_simulated is False

def test_result_is_simulated_true_when_set():
    inp = RiskInput(temperature=30, humidity=50, wind_speed=10)
    result = analyze_risk(inp, is_simulated=True)
    assert result.is_simulated is True
