"""
Feature engineering para o serviço de análise de risco de incêndio.

Converte os campos de entrada (RiskInput) em vetores numéricos
compatíveis com o pipeline Scikit-learn.
"""

from __future__ import annotations
import numpy as np
from schemas import RiskInput

# Mapeamentos categóricos consistentes com risk_model.py
VEG_MAP: dict[str, int] = {"very_dry": 0, "dry": 1, "moderate": 2, "humid": 3}
QUALITY_MAP: dict[str, int] = {"poor": 0, "regular": 1, "good": 2, "excellent": 3}

# Índice das features — usado para garantir consistência entre treino e inferência
FEATURE_NAMES = [
    "temperature",
    "humidity",
    "wind_speed",
    "recent_rainfall",
    "vegetation_num",
    "nearby_hotspot",
    "hotspot_distance",
    "historical_occurrences",
    "data_quality_num",
]


def extract_features(data: RiskInput) -> dict[str, float]:
    """Converte RiskInput em dicionário de features numéricas."""
    return {
        "temperature": float(data.temperature),
        "humidity": float(data.humidity),
        "wind_speed": float(data.wind_speed),
        "recent_rainfall": float(data.recent_rainfall),
        "vegetation_num": float(VEG_MAP.get(data.vegetation_condition, 2)),
        "nearby_hotspot": 1.0 if data.nearby_hotspot else 0.0,
        "hotspot_distance": float(data.hotspot_distance) if data.hotspot_distance is not None else 999.0,
        "historical_occurrences": float(data.historical_occurrences),
        "data_quality_num": float(QUALITY_MAP.get(data.data_quality, 2)),
    }


def features_to_array(features: dict[str, float]) -> np.ndarray:
    """Converte dicionário de features em array numpy na ordem correta."""
    return np.array([[features[name] for name in FEATURE_NAMES]])


def input_to_array(data: RiskInput) -> np.ndarray:
    """Atalho: RiskInput -> array numpy pronto para o modelo."""
    return features_to_array(extract_features(data))
