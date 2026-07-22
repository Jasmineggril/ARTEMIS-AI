"""
Script de treinamento demonstrativo com dataset sintético.

AVISO: Este script usa dados SINTÉTICOS gerados artificialmente.
As métricas obtidas NÃO são representativas do desempenho operacional real.
O modelo supervisionado calibrado será treinado com dados representativos
durante a Prova de Valor.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

# Ensure we're running from the correct directory
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import joblib

from schemas import RiskInput
from risk_model import calculate_rule_score


def generate_synthetic_dataset(n_samples: int = 1000, seed: int = 42) -> tuple:
    """Generate a synthetic dataset using the rule engine as ground truth."""
    rng = np.random.default_rng(seed)

    X, y = [], []
    veg_options = ["very_dry", "dry", "moderate", "humid"]
    quality_options = ["poor", "regular", "good", "excellent"]
    veg_num = {"very_dry": 0, "dry": 1, "moderate": 2, "humid": 3}

    for _ in range(n_samples):
        temp = float(rng.uniform(15, 45))
        hum = float(rng.uniform(10, 95))
        wind = float(rng.uniform(0, 60))
        rain = float(rng.uniform(0, 50))
        veg = rng.choice(veg_options)
        hotspot = bool(rng.choice([True, False]))
        dist = float(rng.uniform(1, 50)) if hotspot else None
        hist = int(rng.integers(0, 8))
        quality = rng.choice(quality_options)

        inp = RiskInput(
            temperature=temp, humidity=hum, wind_speed=wind,
            recent_rainfall=rain, vegetation_condition=veg,
            nearby_hotspot=hotspot, hotspot_distance=dist,
            historical_occurrences=hist, data_quality=quality,
        )
        score = calculate_rule_score(inp)

        X.append([temp, hum, wind, rain, veg_num[veg],
                  1 if hotspot else 0, dist if dist else 999, hist])
        y.append(score)

    return np.array(X), np.array(y)


def train_and_save():
    print("=" * 60)
    print("CERES AI — Treinamento de Modelo Demonstrativo")
    print("AVISO: Dataset sintético. Não representa desempenho real.")
    print("=" * 60)

    print("\n[1/4] Gerando dataset sintético (1000 amostras)...")
    X, y = generate_synthetic_dataset(n_samples=1000)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    print("[2/4] Treinando RandomForestRegressor...")
    model = RandomForestRegressor(n_estimators=50, max_depth=8, random_state=42)
    model.fit(X_train, y_train)

    print("[3/4] Avaliando métricas...")
    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)

    # Classify and compute accuracy
    def to_level(s):
        if s >= 75: return 3
        if s >= 50: return 2
        if s >= 25: return 1
        return 0

    y_test_cls = np.array([to_level(s) for s in y_test])
    y_pred_cls = np.array([to_level(s) for s in y_pred])
    accuracy = float(np.mean(y_test_cls == y_pred_cls))

    print(f"   MAE: {mae:.2f} | R²: {r2:.4f} | Acurácia de nível: {accuracy:.2%}")

    print("[4/4] Salvando modelo e métricas...")
    models_dir = ROOT / "models"
    results_dir = ROOT / "results"
    models_dir.mkdir(exist_ok=True)
    results_dir.mkdir(exist_ok=True)

    model_path = models_dir / "risk_model.joblib"
    joblib.dump(model, model_path)

    metrics = {
        "dataset_type": "synthetic_demo",
        "model_name": "RandomForestRegressor",
        "n_estimators": 50,
        "max_depth": 8,
        "n_samples": 1000,
        "test_size": 0.2,
        "mae": round(mae, 4),
        "r2": round(r2, 4),
        "level_accuracy": round(accuracy, 4),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "warning": (
            "Metrics obtained with synthetic demonstration data and not "
            "representative of operational performance. A supervised model "
            "will be trained with representative data during Proof of Value."
        ),
    }

    metrics_path = results_dir / "metrics.json"
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Modelo salvo em: {model_path}")
    print(f"✅ Métricas salvas em: {metrics_path}")
    print("\n⚠️  AVISO: Este modelo usa dados sintéticos. Não declare como ML operacional validado.")
    return metrics


if __name__ == "__main__":
    train_and_save()
