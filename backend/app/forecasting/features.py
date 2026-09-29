"""Direct multi-horizon features for generation_pu forecasting.

A forecast is issued at time t (last observation) for target t + h, h = 1..H steps (15 min).
One sample per (t, h). Features use only information available at t:

  tod_sin, tod_cos   time of day of the TARGET (sin/cos of 24 h cycle)
  h                  horizon in steps
  g_lag1             g(t)          last observed generation_pu
  g_lag2             g(t-1)
  g_lag4             g(t-3)        one hour of history
  g_day              g(t+h-96)     same time of day, previous day (the 96-step lag of the target)
  irr_lag1           irradiation(t)
  mtemp_lag1         module temperature(t)

This is the brief's lag set (1, 2, 4, 96 steps) expressed relative to the issue time, which avoids
recursive error build-up across the horizon.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

FEATURES = ["tod_sin", "tod_cos", "h", "g_lag1", "g_lag2", "g_lag4", "g_day", "irr_lag1", "mtemp_lag1"]


def make_frame(df: pd.DataFrame, horizons: range) -> pd.DataFrame:
    """df: normalized dataset frame (regular 15-min grid). Returns one row per (issue time, horizon)."""
    d = df.set_index("timestamp")
    g = d["generation_pu"]
    irr = d["irradiation"].fillna(0.0)
    mt = d["module_temp"].ffill()
    bad = d["quality_flag"].eq("long_gap")
    rows = []
    for h in horizons:
        target = g.shift(-h)
        tt = d.index + pd.Timedelta(minutes=15 * h)
        frac = (tt.hour + tt.minute / 60.0) / 24.0
        rows.append(pd.DataFrame({
            "issue": d.index, "target_time": tt, "h": h,
            "tod_sin": np.sin(2 * np.pi * frac), "tod_cos": np.cos(2 * np.pi * frac),
            "g_lag1": g.values, "g_lag2": g.shift(1).values, "g_lag3": g.shift(2).values, "g_lag4": g.shift(3).values,
            "g_day": g.shift(96 - h).values, "irr_lag1": irr.values, "mtemp_lag1": mt.values,
            "y": target.values,
            "target_bad": bad.shift(-h, fill_value=True).values | bad.values,
            "target_irr": irr.shift(-h).values,
        }))
    out = pd.concat(rows, ignore_index=True)
    return out


def daylight_mask(frame: pd.DataFrame) -> np.ndarray:
    """Daylight = measured irradiation > 0 at the target step. MAPE is undefined at night (actual = 0),
    so all error metrics are computed on daylight steps only."""
    return (frame["target_irr"].fillna(0) > 0).to_numpy()
