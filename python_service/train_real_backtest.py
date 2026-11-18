"""
EXPERIMENTAL — training/validation pipeline on REAL outcomes (not used in production).

Input: the cases produced by scripts/backtest-risk.ts (real INPE, Open-Meteo,
Sisfogo and IBGE data; label = INPE detection within 10 km in the next 7 days).

Temporal split with a gap, so no label window of the training set overlaps
the test set (no leakage):
    train: dates <= TRAIN_END            (labels end TRAIN_END + 7 days)
    test : dates >= TEST_START (> TRAIN_END + 7 days)

Compares, on the SAME test set:
    - the transparent rule engine score (no training);
    - a logistic regression on the same inputs (standardised).
Reports ROC AUC, precision/recall/F1 at the rule engine's "moderado ou mais"
alert rate (same number of alerts, fair comparison), and Brier score.

    python train_real_backtest.py ../docs/artemis/evidencias/2026-11-18/backtest-motor.json out.json
"""
import json
import sys
from datetime import date, timedelta

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, precision_score, recall_score, f1_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

TRAIN_END = date(2026, 9, 22)
TEST_START = TRAIN_END + timedelta(days=8)

FEATURES = ["temperature", "humidity", "wind", "rain72", "hotspot_near", "hotspot_inv_km", "history"]


def features(c):
    km = c["hotspotKm"]
    return [c["temperature"], c["humidity"], c["wind"], c["rain72"], 1.0 if km is not None else 0.0,
            (1.0 / (1.0 + km)) if km is not None else 0.0, float(c["history"])]


def at_rate(scores, y, rate):
    """Binary prediction flagging the top `rate` share of cases."""
    k = max(1, int(round(rate * len(scores))))
    thr = np.sort(scores)[::-1][k - 1]
    pred = scores >= thr
    return {"alerts": int(pred.sum()), "precision": round(float(precision_score(y, pred, zero_division=0)), 3),
            "recall": round(float(recall_score(y, pred)), 3), "f1": round(float(f1_score(y, pred)), 3)}


def main(src, out):
    cases = json.load(open(src, encoding="utf-8"))["cases"]
    tr = [c for c in cases if date.fromisoformat(c["date"]) <= TRAIN_END]
    te = [c for c in cases if date.fromisoformat(c["date"]) >= TEST_START]
    Xtr, ytr = np.array([features(c) for c in tr]), np.array([c["event"] for c in tr], dtype=int)
    Xte, yte = np.array([features(c) for c in te]), np.array([c["event"] for c in te], dtype=int)

    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
    model.fit(Xtr, ytr)
    p = model.predict_proba(Xte)[:, 1]
    rules = np.array([c["score"] for c in te], dtype=float)
    rate = float(np.mean([c["level"] != "baixo" for c in te]))

    coef = model.named_steps["logisticregression"].coef_[0]
    report = {
        "experimental": True,
        "warning": "Experimento de uma única temporada (ago–nov 2026), pontos em centros de municípios; NÃO substitui o motor de regras e não está em produção.",
        "split": {"train_dates_until": TRAIN_END.isoformat(), "test_dates_from": TEST_START.isoformat(),
                  "n_train": len(tr), "n_test": len(te), "prevalence_train": round(float(ytr.mean()), 3), "prevalence_test": round(float(yte.mean()), 3)},
        "test": {
            "rules_engine": {"roc_auc": round(float(roc_auc_score(yte, rules)), 3), **at_rate(rules + np.random.default_rng(0).uniform(0, 1e-6, len(rules)), yte, rate)},
            "logistic_regression": {"roc_auc": round(float(roc_auc_score(yte, p)), 3), "brier": round(float(brier_score_loss(yte, p)), 4), **at_rate(p, yte, rate)},
            "alert_rate_used": round(rate, 3),
        },
        "standardised_coefficients": {f: round(float(w), 3) for f, w in zip(FEATURES, coef)},
    }
    json.dump(report, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
