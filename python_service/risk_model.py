"""
Motor de classificação de risco de incêndio.

Este motor baseado em regras é utilizado para demonstração do fluxo tecnológico
em ambiente controlado. A Prova de Valor prevê treinamento, calibração e validação
de modelo supervisionado com dados representativos.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    import joblib
    import numpy as np
    _ML_AVAILABLE = True
except ImportError:
    _ML_AVAILABLE = False

from schemas import RiskInput, RiskOutput, RiskFactor, RiskRecommendation, RiskLevel
from feature_engineering import input_to_array

MODEL_PATH = Path(__file__).parent / "models" / "risk_classifier.joblib"

MODEL_VERSION     = "1.0.0-rules"
ML_MODEL_VERSION  = "1.0.0-sklearn-rf"

# Pontuações médias representativas por classe (para derivar score numérico)
CLASS_SCORE_MIDPOINT = {0: 12, 1: 37, 2: 62, 3: 87}
CLASS_NAMES = ["baixo", "moderado", "alto", "critico"]


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

def validate_input(data: RiskInput) -> list[str]:
    """Return list of validation error messages (empty = valid)."""
    errors: list[str] = []
    if data.temperature is None:
        errors.append("Temperatura é obrigatória")
    if not (0 <= data.humidity <= 100):
        errors.append("Umidade deve estar entre 0 e 100")
    if data.wind_speed < 0:
        errors.append("Velocidade do vento não pode ser negativa")
    if data.recent_rainfall < 0:
        errors.append("Precipitação não pode ser negativa")
    if data.historical_occurrences < 0:
        errors.append("Histórico de ocorrências não pode ser negativo")
    return errors


# ---------------------------------------------------------------------------
# Feature normalization (kept for backward compatibility)
# ---------------------------------------------------------------------------

def normalize_features(data: RiskInput) -> dict:
    """Normalize raw input into a feature dict for both rule engine and ML."""
    from feature_engineering import extract_features
    return extract_features(data)


# ---------------------------------------------------------------------------
# Rule engine — mirrors shared/risk-engine.ts exactly
# ---------------------------------------------------------------------------

def calculate_rule_score(data: RiskInput) -> int:
    """Deterministic rule-based score in range [0, 100]."""
    score = 0

    # Temperature
    t = data.temperature
    if t >= 40:    score += 20
    elif t >= 35:  score += 15
    elif t >= 30:  score += 8
    elif t >= 25:  score += 3

    # Humidity
    h = data.humidity
    if h < 20:     score += 20
    elif h < 30:   score += 15
    elif h < 50:   score += 8
    elif h < 65:   score += 3

    # Wind
    w = data.wind_speed
    if w > 40:     score += 15
    elif w >= 26:  score += 10
    elif w >= 16:  score += 5

    # Rainfall (reduces score)
    r = data.recent_rainfall
    if r > 30:     score -= 15
    elif r >= 11:  score -= 8
    elif r >= 3:   score -= 3

    # Vegetation
    vc = data.vegetation_condition
    if vc == "very_dry":   score += 15
    elif vc == "dry":      score += 10
    elif vc == "moderate": score += 4

    # Nearby hotspot
    if data.nearby_hotspot and data.hotspot_distance is not None:
        d = data.hotspot_distance
        if d <= 5:    score += 20
        elif d <= 15: score += 15
        elif d <= 30: score += 8
        elif d <= 50: score += 4

    # Historical occurrences
    ho = data.historical_occurrences
    if ho >= 5:   score += 10
    elif ho >= 3: score += 6
    elif ho >= 1: score += 2

    return max(0, min(100, score))


# ---------------------------------------------------------------------------
# Risk classification
# ---------------------------------------------------------------------------

def classify_risk(score: int) -> RiskLevel:
    if score <= 24: return "baixo"
    if score <= 49: return "moderado"
    if score <= 74: return "alto"
    return "critico"


# ---------------------------------------------------------------------------
# Factor explanation — rich format matching the TypeScript interface
# ---------------------------------------------------------------------------

def explain_factors(data: RiskInput) -> list[RiskFactor]:
    """Generate explanatory factors with contribution, description and weight."""
    factors: list[RiskFactor] = []

    # Temperature
    t = data.temperature
    if t >= 40:
        factors.append(RiskFactor(name="Temperatura extrema", contribution=20,
            description="Temperatura ≥40°C aumenta drasticamente a taxa de evaporação e a probabilidade de ignição.",
            weight="alto", value=f"{t:.1f} °C"))
    elif t >= 35:
        factors.append(RiskFactor(name="Temperatura muito alta", contribution=15,
            description="Temperatura entre 35°C e 39°C cria condições favoráveis para propagação de fogo.",
            weight="alto", value=f"{t:.1f} °C"))
    elif t >= 30:
        factors.append(RiskFactor(name="Temperatura elevada", contribution=8,
            description="Temperatura entre 30°C e 34°C aumenta o risco moderadamente.",
            weight="médio", value=f"{t:.1f} °C"))
    elif t >= 25:
        factors.append(RiskFactor(name="Temperatura moderada", contribution=3,
            description="Temperatura entre 25°C e 29°C contribui levemente ao risco.",
            weight="baixo", value=f"{t:.1f} °C"))

    # Humidity
    h = data.humidity
    if h < 20:
        factors.append(RiskFactor(name="Umidade crítica", contribution=20,
            description="Umidade abaixo de 20% desidrata rapidamente a vegetação e combustíveis.",
            weight="alto", value=f"{h:.0f}%"))
    elif h < 30:
        factors.append(RiskFactor(name="Umidade muito baixa", contribution=15,
            description="Umidade entre 20% e 29% favorece ignição e propagação rápida.",
            weight="alto", value=f"{h:.0f}%"))
    elif h < 50:
        factors.append(RiskFactor(name="Umidade baixa", contribution=8,
            description="Umidade entre 30% e 49% contribui significativamente ao risco.",
            weight="médio", value=f"{h:.0f}%"))
    elif h < 65:
        factors.append(RiskFactor(name="Umidade moderada", contribution=3,
            description="Umidade entre 50% e 64% representa contribuição leve ao risco.",
            weight="baixo", value=f"{h:.0f}%"))

    # Wind
    w = data.wind_speed
    if w > 40:
        factors.append(RiskFactor(name="Vento intenso", contribution=15,
            description="Vento acima de 40 km/h propaga focos rapidamente e dificulta o combate.",
            weight="alto", value=f"{w:.0f} km/h"))
    elif w >= 26:
        factors.append(RiskFactor(name="Vento forte", contribution=10,
            description="Vento entre 26 e 40 km/h aumenta significativamente a velocidade de propagação.",
            weight="médio", value=f"{w:.0f} km/h"))
    elif w >= 16:
        factors.append(RiskFactor(name="Vento moderado", contribution=5,
            description="Vento entre 16 e 25 km/h contribui moderadamente ao risco.",
            weight="baixo", value=f"{w:.0f} km/h"))

    # Rainfall
    r = data.recent_rainfall
    if r > 30:
        factors.append(RiskFactor(name="Chuva recente significativa", contribution=-15,
            description="Precipitação acima de 30 mm nas últimas 72h reduz consideravelmente o risco.",
            weight="alto", value=f"{r:.0f} mm"))
    elif r >= 11:
        factors.append(RiskFactor(name="Chuva recente moderada", contribution=-8,
            description="Precipitação entre 11 e 30 mm reduz o risco de forma relevante.",
            weight="médio", value=f"{r:.0f} mm"))
    elif r >= 3:
        factors.append(RiskFactor(name="Chuva recente leve", contribution=-3,
            description="Precipitação entre 3 e 10 mm atenua levemente o risco.",
            weight="baixo", value=f"{r:.0f} mm"))

    # Vegetation
    vc = data.vegetation_condition
    veg_labels = {"very_dry": "Muito seca", "dry": "Seca", "moderate": "Moderada", "humid": "Úmida"}
    if vc == "very_dry":
        factors.append(RiskFactor(name="Vegetação extremamente seca", contribution=15,
            description="Vegetação muito seca é altamente inflamável e acelera a propagação.",
            weight="alto", value=veg_labels.get(vc, vc)))
    elif vc == "dry":
        factors.append(RiskFactor(name="Vegetação seca", contribution=10,
            description="Vegetação seca aumenta significativamente o risco de ignição.",
            weight="médio", value=veg_labels.get(vc, vc)))
    elif vc == "moderate":
        factors.append(RiskFactor(name="Vegetação moderada", contribution=4,
            description="Vegetação em condição moderada contribui levemente ao risco.",
            weight="baixo", value=veg_labels.get(vc, vc)))

    # Nearby hotspot
    if data.nearby_hotspot and data.hotspot_distance is not None:
        d = data.hotspot_distance
        if d <= 5:
            contrib, desc, w_label = 20, "Foco de incêndio a menos de 5 km — risco muito elevado de propagação imediata.", "alto"
        elif d <= 15:
            contrib, desc, w_label = 15, "Foco a menos de 15 km — alta probabilidade de propagação.", "alto"
        elif d <= 30:
            contrib, desc, w_label = 8, "Foco a menos de 30 km — risco moderado de propagação com ventos fortes.", "médio"
        else:
            contrib, desc, w_label = 4, "Foco ativo na região — contribuição leve ao risco.", "baixo"
        factors.append(RiskFactor(name="Foco de incêndio próximo",
            contribution=contrib, description=desc, weight=w_label, value=f"{d:.0f} km"))

    # Historical occurrences
    ho = data.historical_occurrences
    if ho >= 5:
        factors.append(RiskFactor(name="Alto histórico de ocorrências", contribution=10,
            description="5 ou mais ocorrências históricas indicam área com padrão recorrente de incêndio.",
            weight="alto", value=f"{ho} ocorrência(s)"))
    elif ho >= 3:
        factors.append(RiskFactor(name="Histórico significativo de ocorrências", contribution=6,
            description="3 a 4 ocorrências históricas indicam área com histórico preocupante.",
            weight="médio", value=f"{ho} ocorrência(s)"))
    elif ho >= 1:
        factors.append(RiskFactor(name="Histórico leve de ocorrências", contribution=2,
            description="1 a 2 ocorrências históricas, contribuição leve ao risco.",
            weight="baixo", value=f"{ho} ocorrência(s)"))

    return factors


# ---------------------------------------------------------------------------
# Recommendations — structured by level
# ---------------------------------------------------------------------------

def generate_recommendations(level: RiskLevel) -> list[RiskRecommendation]:
    base = [
        RiskRecommendation(priority="monitoramento",
            action="Monitorar condições meteorológicas",
            rationale="Acompanhar temperatura, umidade e velocidade do vento para detectar deterioração das condições."),
    ]
    if level == "baixo":
        return base + [
            RiskRecommendation(priority="preventiva",
                action="Manter roçadas e aceiros em dia",
                rationale="Reduzir material combustível na área como medida preventiva básica."),
            RiskRecommendation(priority="preventiva",
                action="Verificar equipamentos de combate",
                rationale="Garantir que equipamentos estejam disponíveis e funcionais para emergências."),
        ]
    if level == "moderado":
        return [
            RiskRecommendation(priority="urgente",
                action="Intensificar patrulhamento da área",
                rationale="Aumentar frequência de inspeções para detecção precoce de focos."),
            RiskRecommendation(priority="preventiva",
                action="Reforçar aceiros e faixas de contenção",
                rationale="Ampliar barreiras físicas para limitar propagação em caso de ignição."),
            RiskRecommendation(priority="preventiva",
                action="Alertar equipes e definir rotas de evacuação",
                rationale="Garantir prontidão operacional e segurança das pessoas na área."),
        ] + base
    if level == "alto":
        return [
            RiskRecommendation(priority="urgente",
                action="Suspender operações de risco de ignição",
                rationale="Interromper atividades que possam provocar faíscas ou ignição acidental."),
            RiskRecommendation(priority="urgente",
                action="Mobilizar brigada de incêndio",
                rationale="Deixar equipe de combate em standby para resposta imediata."),
            RiskRecommendation(priority="imediata",
                action="Comunicar autoridades competentes (IBAMA, Defesa Civil)",
                rationale="Notificar órgãos responsáveis para coordenação de resposta preventiva."),
            RiskRecommendation(priority="preventiva",
                action="Verificar sistema de comunicação de emergência",
                rationale="Garantir meios de comunicação entre equipes em caso de ocorrência."),
        ]
    # crítico
    return [
        RiskRecommendation(priority="imediata",
            action="Paralisar todas as operações na área",
            rationale="Eliminar qualquer fonte potencial de ignição — risco extremo de propagação rápida."),
        RiskRecommendation(priority="imediata",
            action="Evacuar pessoal não essencial",
            rationale="Proteger vidas imediatamente — condições de propagação são extremas."),
        RiskRecommendation(priority="imediata",
            action="Acionar Defesa Civil e Corpo de Bombeiros",
            rationale="Situação requer resposta institucional coordenada e recursos de combate profissional."),
        RiskRecommendation(priority="urgente",
            action="Ativar plano de contingência",
            rationale="Executar protocolo de emergência documentado para situações críticas."),
    ]


# ---------------------------------------------------------------------------
# ML model loader
# ---------------------------------------------------------------------------

def load_ml_model():
    """Load the trained classifier if available. Returns None otherwise."""
    if not _ML_AVAILABLE or not MODEL_PATH.exists():
        return None
    try:
        artifact = joblib.load(MODEL_PATH)
        return artifact
    except Exception:
        return None


def predict_with_ml_model(artifact: dict, data: RiskInput) -> tuple[int, float] | tuple[None, None]:
    """
    Predict risk using the trained classifier.
    Returns (score, confidence) or (None, None) on failure.
    """
    try:
        model   = artifact["model"]
        X       = input_to_array(data)
        proba   = model.predict_proba(X)[0]   # shape: (4,)
        cls_idx = int(np.argmax(proba))

        # Derive a smooth score using weighted midpoints
        midpoints = np.array([12, 37, 62, 87])
        score = int(round(float(np.dot(proba, midpoints))))
        score = max(0, min(100, score))

        # Confidence = probability of the predicted class
        confidence = float(proba[cls_idx])
        return score, confidence
    except Exception:
        return None, None


# ---------------------------------------------------------------------------
# Confidence estimate (rule engine)
# ---------------------------------------------------------------------------

def _calculate_confidence(data: RiskInput) -> float:
    quality_map = {"excellent": 0.95, "good": 0.85, "regular": 0.70, "poor": 0.55}
    return quality_map.get(data.data_quality, 0.75)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def analyze_risk(data: RiskInput, is_simulated: bool = False) -> RiskOutput:
    """
    Run risk analysis. Uses the supervised ML classifier if available;
    falls back to the transparent rule engine otherwise.
    """
    artifact = load_ml_model()
    factors  = explain_factors(data)

    if artifact is not None:
        score, confidence = predict_with_ml_model(artifact, data)
        if score is not None and confidence is not None:
            level        = classify_risk(score)
            model_type   = "supervised-ml"
            version      = artifact.get("version", ML_MODEL_VERSION)
            dataset_type = "synthetic"
        else:
            # ML inference failed — fall back to rule engine
            score        = calculate_rule_score(data)
            level        = classify_risk(score)
            confidence   = _calculate_confidence(data)
            model_type   = "transparent-rule-engine"
            version      = MODEL_VERSION
            dataset_type = "rule-based"
    else:
        score        = calculate_rule_score(data)
        level        = classify_risk(score)
        confidence   = _calculate_confidence(data)
        model_type   = "transparent-rule-engine"
        version      = MODEL_VERSION
        dataset_type = "rule-based"

    recommendations = generate_recommendations(level)

    return RiskOutput(
        score=score,
        level=level,
        confidence=confidence,
        factors=factors,
        recommendations=recommendations,
        model_type=model_type,
        model_version=version,
        dataset_type=dataset_type,
        is_simulated=is_simulated,
        calculated_at=datetime.now(timezone.utc).isoformat(),
    )
