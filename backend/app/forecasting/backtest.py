"""Time-ordered backtest (never shuffled).

Split: first TRAIN_FRACTION of days train, remaining days test. Metrics on DAYLIGHT target steps only
(irradiation > 0; MAPE is undefined when actual = 0), excluding targets in long data gaps:
  MAE, RMSE (in pu of plant capacity), nMAE = MAE / mean(actual daylight), P10–P90 coverage (hgb).
Limitation: ~34 days of data, one season, one plant — metrics are indicative, not bankable.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from app.datasets.registry import get_dataset
from app.forecasting.features import daylight_mask, make_frame
from app.forecasting.models import MODELS, QuantileModel, fit_hgb, predict

TRAIN_FRACTION = 0.7
MAX_H = 8


def _metrics(y: np.ndarray, p: np.ndarray) -> dict:
    ok = ~np.isnan(y) & ~np.isnan(p)
    y, p = y[ok], p[ok]
    if len(y) == 0:
        return {"mae": None, "rmse": None, "nmae_pct": None, "n": 0}
    mae = float(np.mean(np.abs(p - y)))
    return {"mae": round(mae, 4), "rmse": round(float(np.sqrt(np.mean((p - y) ** 2))), 4),
            "nmae_pct": round(100 * mae / float(np.mean(y)), 2), "n": int(len(y))}


@lru_cache(maxsize=4)
def split_and_fit(dataset_id: str) -> tuple[pd.DataFrame, pd.DataFrame, QuantileModel, str]:
    df = get_dataset(dataset_id).load()
    days = sorted(df["timestamp"].dt.normalize().unique())
    cut = days[int(len(days) * TRAIN_FRACTION)]
    frame = make_frame(df, range(1, MAX_H + 1))
    train = frame[frame["target_time"] < cut]
    test = frame[(frame["issue"] >= cut)]
    return train, test, fit_hgb(train), pd.Timestamp(cut).strftime("%Y-%m-%d")


def run_backtest(dataset_id: str) -> dict:
    train, test, qm, cut = split_and_fit(dataset_id)
    test = test[~test["target_bad"] & test["y"].notna()]
    day = daylight_mask(test)
    tday = test[day]
    y = tday["y"].to_numpy(dtype=float)
    results = {}
    preds = {}
    for name in MODELS:
        pr = predict(name, tday, qm)
        preds[name] = pr
        m = _metrics(y, pr["p50"])
        m["by_horizon"] = {int(h): _metrics(y[tday["h"].to_numpy() == h], pr["p50"][tday["h"].to_numpy() == h])["mae"]
                           for h in sorted(tday["h"].unique())}
        if name == "hgb":
            inside = (y >= pr["p10"]) & (y <= pr["p90"])
            m["p10_p90_coverage_pct"] = round(100 * float(np.mean(inside)), 1)
        results[name] = m
    best_baseline = min(("persistence_day", "persistence_last", "rolling_mean"), key=lambda k: results[k]["mae"])
    ml_beats = results["hgb"]["mae"] < results[best_baseline]["mae"]
    return {
        "dataset_id": dataset_id,
        "split": {"train_until": cut, "method": f"time-ordered, first {int(TRAIN_FRACTION * 100)}% of days train",
                  "train_samples": int(len(train)), "test_daylight_samples": int(len(tday))},
        "horizons_steps": list(range(1, MAX_H + 1)),
        "metrics": results,
        "best_baseline": best_baseline,
        "ml_beats_best_baseline": bool(ml_beats),
        "verdict": (f"HistGradientBoosting P50 MAE {results['hgb']['mae']:.4f} vs best baseline ({best_baseline}) "
                    f"{results[best_baseline]['mae']:.4f} pu: " +
                    ("ML is better on this test period." if ml_beats else "ML does NOT beat the baseline on this test period.")),
        "notes": [
            "Metrics on daylight target steps only (irradiation > 0); MAPE is undefined at night.",
            "Errors are in per-unit of plant capacity (0.01 pu = 1% of capacity).",
            "~34 days, single plant, single season: indicative only.",
        ],
    }


def backtest_series(dataset_id: str, date: str | None, horizon: int) -> dict:
    """Actual vs baselines vs ML (P10–P90) for one test day at a fixed horizon, for charting."""
    _, test, qm, cut = split_and_fit(dataset_id)
    days = sorted(test["target_time"].dt.strftime("%Y-%m-%d").unique())
    date = date if date in days else days[len(days) // 2]
    f = test[(test["h"] == horizon) & (test["target_time"].dt.strftime("%Y-%m-%d") == date)].sort_values("target_time")
    out = {"date": date, "horizon_steps": horizon, "available_dates": days,
           "timestamps": [t.strftime("%H:%M") for t in f["target_time"]], "actual": f["y"].round(4).tolist()}
    for name in ("persistence_day", "persistence_last", "hgb"):
        pr = predict(name, f, qm)
        out[name] = pr["p50"].round(4).tolist()
        if name == "hgb":
            out["hgb_p10"] = pr["p10"].round(4).tolist()
            out["hgb_p90"] = pr["p90"].round(4).tolist()
    return out
