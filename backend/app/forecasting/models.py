"""Generation forecasting models.

Baselines (no training):
  persistence_day   g(t+h-96)   same time previous day
  persistence_last  g(t)        last observed value
  rolling_mean      mean of the last 4 observations (1 h)
ML:
  hgb               HistGradientBoostingRegressor with loss="quantile", alpha = 0.1 / 0.5 / 0.9
                    -> P10 / P50 / P90 (scikit-learn; no OpenMP-dependent libraries)
Baselines return the same value for P10/P50/P90 (point forecasts).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from app.forecasting.features import FEATURES

MODELS = ["persistence_day", "persistence_last", "rolling_mean", "hgb"]
QUANTILES = {"p10": 0.1, "p50": 0.5, "p90": 0.9}


def baseline(name: str, frame: pd.DataFrame) -> np.ndarray:
    if name == "persistence_day":
        return frame["g_day"].to_numpy(dtype=float)
    if name == "persistence_last":
        return frame["g_lag1"].to_numpy(dtype=float)
    if name == "rolling_mean":
        return frame[["g_lag1", "g_lag2", "g_lag3", "g_lag4"]].mean(axis=1).to_numpy(dtype=float)
    raise ValueError(name)


@dataclass
class QuantileModel:
    models: dict[str, HistGradientBoostingRegressor]

    def predict(self, frame: pd.DataFrame) -> dict[str, np.ndarray]:
        X = frame[FEATURES].to_numpy(dtype=float)
        out = {k: np.clip(m.predict(X), 0.0, 1.05) for k, m in self.models.items()}
        # enforce non-crossing quantiles
        out["p10"] = np.minimum(out["p10"], out["p50"])
        out["p90"] = np.maximum(out["p90"], out["p50"])
        night = frame["tod_cos"].to_numpy() > np.cos(2 * np.pi * 5.5 / 24)  # before ~05:30 / after ~18:30
        for k in out:
            out[k] = np.where(night & (frame["g_day"].fillna(0).to_numpy() <= 0.0), 0.0, out[k])
        return out


def fit_hgb(train: pd.DataFrame, seed: int = 0) -> QuantileModel:
    t = train.dropna(subset=["y"] + FEATURES)
    t = t[~t["target_bad"]]
    X = t[FEATURES].to_numpy(dtype=float)
    y = t["y"].to_numpy(dtype=float)
    models = {}
    for k, a in QUANTILES.items():
        m = HistGradientBoostingRegressor(loss="quantile", quantile=a, max_iter=250, learning_rate=0.06,
                                          max_leaf_nodes=31, min_samples_leaf=40, random_state=seed)
        m.fit(X, y)
        models[k] = m
    return QuantileModel(models)


def predict(name: str, frame: pd.DataFrame, qm: QuantileModel | None = None) -> dict[str, np.ndarray]:
    if name == "hgb":
        if qm is None:
            raise ValueError("hgb needs a fitted QuantileModel")
        return qm.predict(frame)
    p = np.clip(baseline(name, frame), 0.0, 1.05)
    return {"p10": p, "p50": p, "p90": p}
