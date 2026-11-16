"""
ARTEMIS AI — Avaliação do Modelo Treinado

Carrega o modelo salvo em models/risk_classifier.joblib e re-avalia
no conjunto de teste gerado com a mesma semente aleatória do treinamento.

Uso:
    python evaluate_model.py

AVISO: Dataset sintético. Métricas demonstram apenas viabilidade técnica.
"""

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    classification_report, confusion_matrix,
)
from sklearn.model_selection import train_test_split
import joblib

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

CLASS_NAMES = ["baixo", "moderado", "alto", "critico"]


def load_model():
    model_path = ROOT / "models" / "risk_classifier.joblib"
    if not model_path.exists():
        print(f"[ERRO] Modelo não encontrado: {model_path}")
        print("Execute primeiro: python train_model.py")
        sys.exit(1)
    artifact = joblib.load(model_path)
    return artifact["model"], artifact["version"]


def load_dataset():
    """Recarrega o dataset de teste com a mesma semente usada no treinamento."""
    from train_model import generate_synthetic_dataset
    X, y = generate_synthetic_dataset(n_samples=2000, seed=42)
    _, X_test, _, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    return X_test, y_test


def evaluate():
    print("=" * 65)
    print("ARTEMIS AI — Avaliação do Classificador de Risco de Incêndio")
    print("Dataset: SINTÉTICO | Não representa validação operacional real")
    print("=" * 65)

    print("\n[1/3] Carregando modelo…")
    model, version = load_model()
    print(f"    Versão: {version}")

    print("\n[2/3] Carregando conjunto de teste…")
    X_test, y_test = load_dataset()
    print(f"    Amostras de teste: {len(X_test)}")

    print("\n[3/3] Avaliando…")
    y_pred = model.predict(X_test)

    acc          = accuracy_score(y_test, y_pred)
    prec_macro   = precision_score(y_test, y_pred, average="macro",    zero_division=0)
    rec_macro    = recall_score(y_test, y_pred,    average="macro",    zero_division=0)
    f1_macro     = f1_score(y_test, y_pred,        average="macro",    zero_division=0)
    prec_w       = precision_score(y_test, y_pred, average="weighted", zero_division=0)
    rec_w        = recall_score(y_test, y_pred,    average="weighted", zero_division=0)
    f1_w         = f1_score(y_test, y_pred,        average="weighted", zero_division=0)
    cm           = confusion_matrix(y_test, y_pred, labels=[0, 1, 2, 3])

    print(f"\n    Accuracy:             {acc:.4f}")
    print(f"    Precision (macro):    {prec_macro:.4f}")
    print(f"    Recall (macro):       {rec_macro:.4f}")
    print(f"    F1-score (macro):     {f1_macro:.4f}")
    print(f"    Precision (weighted): {prec_w:.4f}")
    print(f"    Recall (weighted):    {rec_w:.4f}")
    print(f"    F1-score (weighted):  {f1_w:.4f}")

    print("\n    Relatório por classe:\n")
    print(classification_report(y_test, y_pred, target_names=CLASS_NAMES, zero_division=0))

    print("    Matriz de confusão:")
    header = "         " + "  ".join(f"{n:>8}" for n in CLASS_NAMES)
    print(header)
    for i, row in enumerate(cm):
        row_str = "  ".join(f"{v:>8}" for v in row)
        print(f"    {CLASS_NAMES[i]:>8}  {row_str}")

    # Carregar limitações do metrics.json se disponível
    metrics_path = ROOT / "results" / "metrics.json"
    if metrics_path.exists():
        with open(metrics_path, encoding="utf-8") as f:
            saved = json.load(f)
        print(f"\n    Modelo treinado em: {saved.get('trained_at', 'N/A')}")

    print("\n" + "=" * 65)
    print("AVISO: Métricas iniciais demonstram apenas viabilidade técnica")
    print("em ambiente controlado com dataset sintético.")
    print("Validação operacional prevista para a Prova de Valor (60 dias).")
    print("=" * 65)


if __name__ == "__main__":
    evaluate()
