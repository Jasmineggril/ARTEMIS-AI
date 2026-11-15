"""Engine selection: rule engine by default, ML only when explicitly enabled."""
import os
from fastapi.testclient import TestClient

from schemas import RiskInput
from risk_model import analyze_risk, load_ml_model
from app import app

client = TestClient(app)
SAMPLE = RiskInput(temperature=38, humidity=18, wind_speed=35, recent_rainfall=0,
                   vegetation_condition="very_dry", nearby_hotspot=True,
                   hotspot_distance=2, historical_occurrences=4, data_quality="good")


def test_default_mode_is_rule_engine(monkeypatch):
    monkeypatch.delenv("RISK_ENGINE_MODE", raising=False)
    r = analyze_risk(SAMPLE)
    assert r.model_type == "transparent-rule-engine"
    assert r.is_experimental is False
    assert r.engine_mode == "rules"


def test_invalid_mode_falls_back_to_rules(monkeypatch):
    monkeypatch.setenv("RISK_ENGINE_MODE", "anything")
    assert analyze_risk(SAMPLE).model_type == "transparent-rule-engine"


def test_ml_mode_is_flagged_experimental():
    r = analyze_risk(SAMPLE, engine_mode="ml-experimental")
    if load_ml_model() is None:
        assert r.model_type == "transparent-rule-engine"
    else:
        assert r.model_type == "supervised-ml"
        assert r.is_experimental is True
        assert r.dataset_type == "synthetic"


def test_model_info_warns_synthetic():
    data = client.get("/model-info").json()
    assert data["ml_dataset_type"] == "synthetic"
    assert "sintético" in data["ml_metrics_warning"]


def test_cors_closed_by_default():
    r = client.options("/analyze-risk", headers={"Origin": "https://evil.example",
                                                 "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
