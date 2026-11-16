"""
ARTEMIS AI — Script de Treinamento do Classificador de Risco de Incêndio

AVISO: Este script usa dataset SINTÉTICO gerado a partir do motor de regras.
As métricas obtidas demonstram apenas viabilidade técnica em ambiente controlado.
Elas NÃO representam desempenho operacional real e serão validadas com dados
representativos durante a Prova de Valor (60 dias).

Dataset: sintético — gerado programaticamente
Modelo: RandomForestClassifier (4 classes de risco)
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    classification_report, confusion_matrix,
)
import joblib

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from schemas import RiskInput
from risk_model import calculate_rule_score
from feature_engineering import FEATURE_NAMES, VEG_MAP, QUALITY_MAP

# Mapeamento de score -> classe
CLASS_NAMES = ["baixo", "moderado", "alto", "critico"]


def score_to_class(score: int) -> int:
    if score <= 24:  return 0  # baixo
    if score <= 49:  return 1  # moderado
    if score <= 74:  return 2  # alto
    return 3                    # crítico


def generate_synthetic_dataset(n_samples: int = 2000, seed: int = 42) -> tuple:
    """
    Gera dataset sintético usando o motor de regras como gerador de rótulos.
    Utiliza amostragem estratificada para garantir representatividade das quatro classes.

    AVISO: Dataset sintético para demonstração do pipeline de ML.
    Não representa condições operacionais reais.
    """
    rng = np.random.default_rng(seed)
    veg_options = ["very_dry", "dry", "moderate", "humid"]
    quality_options = ["poor", "regular", "good", "excellent"]

    # Parâmetros por faixa de classe para amostragem estratificada
    # Garante ~25% por classe para treino equilibrado
    class_params = {
        0: dict(temp=(15, 26), hum=(60, 95), wind=(0, 12), rain=(10, 50), veg=["humid", "moderate"], hs=False),
        1: dict(temp=(27, 33), hum=(40, 62), wind=(10, 22), rain=(3, 12), veg=["moderate", "dry"], hs=False),
        2: dict(temp=(33, 38), hum=(22, 42), wind=(18, 32), rain=(0, 5), veg=["dry", "very_dry"], hs=False),
        3: dict(temp=(37, 42), hum=(10, 25), wind=(28, 60), rain=(0, 2), veg=["very_dry"], hs=True),
    }

    per_class = n_samples // 4
    X, y = [], []

    for label, params in class_params.items():
        count = 0
        attempts = 0
        max_attempts = per_class * 20  # evita loop infinito
        while count < per_class and attempts < max_attempts:
            attempts += 1
            temp  = float(rng.uniform(*params["temp"]))
            hum   = float(rng.uniform(*params["hum"]))
            wind  = float(rng.uniform(*params["wind"]))
            rain  = float(rng.uniform(*params["rain"]))
            veg   = str(rng.choice(params["veg"]))
            hs    = bool(params["hs"]) or bool(rng.random() < 0.15)
            dist  = float(rng.uniform(1, 8)) if hs else None
            hist  = int(rng.integers(0 if label < 2 else 2, 4 if label < 2 else 9))
            qual  = str(rng.choice(quality_options))

            inp = RiskInput(
                temperature=temp, humidity=hum, wind_speed=wind,
                recent_rainfall=rain, vegetation_condition=veg,  # type: ignore[arg-type]
                nearby_hotspot=hs, hotspot_distance=dist,
                historical_occurrences=hist, data_quality=qual,  # type: ignore[arg-type]
            )
            actual_score = calculate_rule_score(inp)
            actual_label = score_to_class(actual_score)

            if actual_label == label:
                X.append([
                    temp, hum, wind, rain,
                    VEG_MAP.get(veg, 2),
                    1 if hs else 0,
                    dist if dist is not None else 999.0,
                    hist,
                    QUALITY_MAP.get(qual, 2),
                ])
                y.append(label)
                count += 1

        # Complementa com amostras aleatórias se necessário
        if count < per_class:
            print(f"    [aviso] Classe '{CLASS_NAMES[label]}': {count}/{per_class} amostras geradas")

    return np.array(X), np.array(y)


def train_and_save():
    print("=" * 65)
    print("ARTEMIS AI — Treinamento do Classificador de Risco de Incêndio")
    print("Dataset: SINTÉTICO | Não representa validação operacional real")
    print("=" * 65)

    # ── 1. Dataset ────────────────────────────────────────────────────────
    print("\n[1/5] Gerando dataset sintético (2000 amostras)…")
    X, y = generate_synthetic_dataset(n_samples=2000, seed=42)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    class_counts = {CLASS_NAMES[i]: int((y == i).sum()) for i in range(4)}
    print(f"    Distribuição de classes: {class_counts}")
    print(f"    Treino: {len(X_train)} | Teste: {len(X_test)}")

    # ── 2. Treinamento ───────────────────────────────────────────────────
    print("\n[2/5] Treinando RandomForestClassifier…")
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=10,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)
    print("    Treinamento concluído.")

    # ── 3. Avaliação ─────────────────────────────────────────────────────
    print("\n[3/5] Avaliando métricas no conjunto de teste…")
    y_pred = model.predict(X_test)

    acc   = float(accuracy_score(y_test, y_pred))
    prec_macro  = float(precision_score(y_test, y_pred, average="macro",    zero_division=0))
    rec_macro   = float(recall_score(y_test, y_pred,    average="macro",    zero_division=0))
    f1_macro    = float(f1_score(y_test, y_pred,        average="macro",    zero_division=0))
    prec_weighted = float(precision_score(y_test, y_pred, average="weighted", zero_division=0))
    rec_weighted  = float(recall_score(y_test, y_pred,    average="weighted", zero_division=0))
    f1_weighted   = float(f1_score(y_test, y_pred,        average="weighted", zero_division=0))

    cm = confusion_matrix(y_test, y_pred, labels=[0, 1, 2, 3])

    print(f"\n    Accuracy:          {acc:.4f}")
    print(f"    Precision (macro): {prec_macro:.4f}")
    print(f"    Recall (macro):    {rec_macro:.4f}")
    print(f"    F1-score (macro):  {f1_macro:.4f}")
    print(f"\n    Precision (weighted): {prec_weighted:.4f}")
    print(f"    Recall (weighted):    {rec_weighted:.4f}")
    print(f"    F1-score (weighted):  {f1_weighted:.4f}")
    print(f"\n{classification_report(y_test, y_pred, target_names=CLASS_NAMES, zero_division=0)}")

    # ── 4. Confusion matrix ──────────────────────────────────────────────
    print("[4/5] Salvando artefatos…")
    results_dir = ROOT / "results"
    results_dir.mkdir(exist_ok=True)
    models_dir  = ROOT / "models"
    models_dir.mkdir(exist_ok=True)

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(7, 6))
        im = ax.imshow(cm, interpolation="nearest", cmap="Blues")
        plt.colorbar(im, ax=ax)
        ax.set(
            xticks=range(4), yticks=range(4),
            xticklabels=CLASS_NAMES, yticklabels=CLASS_NAMES,
            ylabel="Rótulo real", xlabel="Predição do modelo",
            title="Matriz de Confusão — ARTEMIS AI Risk Classifier\n(Dataset sintético · não operacional)",
        )
        thresh = cm.max() / 2.0
        for i in range(4):
            for j in range(4):
                ax.text(j, i, format(cm[i, j], "d"),
                        ha="center", va="center",
                        color="white" if cm[i, j] > thresh else "black")
        plt.tight_layout()
        fig.savefig(results_dir / "confusion_matrix.png", dpi=120)
        plt.close(fig)
        print("    confusion_matrix.png salvo.")
    except ImportError:
        print("    [AVISO] matplotlib não disponível — confusion_matrix.png não gerado.")

    # ── 5. Métricas JSON + modelo ────────────────────────────────────────
    model_version = "1.0.0-sklearn-rf"
    trained_at    = datetime.now(timezone.utc).isoformat()

    metrics = {
        "model_version": model_version,
        "trained_at": trained_at,
        "dataset": {
            "type": "synthetic",
            "origin": "rule-engine-labels",
            "n_samples": len(X),
            "n_train": len(X_train),
            "n_test": len(X_test),
            "class_distribution": class_counts,
            "features": FEATURE_NAMES,
            "classes": CLASS_NAMES,
            "warning": (
                "Dataset sintético gerado a partir do motor de regras. "
                "Métricas demonstram apenas viabilidade técnica em ambiente controlado. "
                "Validação com dados reais prevista para a Prova de Valor."
            ),
        },
        "model": {
            "algorithm": "RandomForestClassifier",
            "n_estimators": 100,
            "max_depth": 10,
            "class_weight": "balanced",
        },
        "metrics": {
            "accuracy": acc,
            "precision_macro": prec_macro,
            "recall_macro": rec_macro,
            "f1_macro": f1_macro,
            "precision_weighted": prec_weighted,
            "recall_weighted": rec_weighted,
            "f1_weighted": f1_weighted,
            "confusion_matrix": cm.tolist(),
            "class_names": CLASS_NAMES,
        },
        "limitations": [
            "Treinado com dataset sintético — não representa condições operacionais reais",
            "Rótulos derivados do motor de regras (possível viés circular)",
            "Sem dados geoespaciais reais ou séries temporais",
            "Calibração e validação com dados reais previstas para a Prova de Valor",
            "Não declare este modelo como IA validada ou operacional",
        ],
    }

    with open(results_dir / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    print("    metrics.json salvo.")

    model_path = models_dir / "risk_classifier.joblib"
    joblib.dump({"model": model, "version": model_version, "features": FEATURE_NAMES}, model_path)
    print(f"    Modelo salvo: {model_path}")

    print("\n" + "=" * 65)
    print("Treinamento concluído.")
    print(f"Versão: {model_version}  |  Treinado em: {trained_at}")
    print("AVISO: Métricas iniciais demonstram viabilidade técnica em")
    print("ambiente controlado. Serão validadas durante a Prova de Valor.")
    print("=" * 65)


if __name__ == "__main__":
    train_and_save()
