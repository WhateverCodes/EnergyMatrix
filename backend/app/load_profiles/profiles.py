"""Eight deterministic SYNTHETIC consumer profiles ("Synthetic consumer scenario").

Each profile is 24 hourly shape anchors s(h) in [0, 1], linearly interpolated to 15 min
(wrapping 23:00 -> 00:00). Demand in kW:

    P(t) = (base_kw + (peak_kw - base_kw) * s(t)) * scale * (weekend_factor on Sat/Sun)

Optional `noise_seed` adds deterministic multiplicative noise (sigma 3 %); off by default.
These are NOT measured data.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Profile:
    key: str
    name: str
    base_kw: float
    peak_kw: float
    weekend_factor: float
    anchors: tuple[float, ...]  # 24 hourly shape values, index = hour
    description: str


PROFILES: dict[str, Profile] = {p.key: p for p in [
    Profile("bungalow", "Bungalow", 1.5, 8.0, 1.10,
            (.15, .12, .10, .10, .10, .15, .35, .55, .50, .35, .30, .30, .35, .35, .30, .30, .35, .50, .80, 1.0, .95, .85, .55, .30),
            "Single household: morning bump 6–8, low day, strong evening peak 18–21."),
    Profile("residential_society", "Residential Society", 150.0, 800.0, 1.05,
            (.25, .20, .18, .18, .20, .25, .40, .55, .60, .50, .45, .45, .45, .45, .42, .42, .48, .60, .85, 1.0, 1.0, .95, .80, .50),
            "Apartment complex: morning rise 6–9, moderate day, strong peak 18–22."),
    Profile("neighborhood", "Neighborhood", 400.0, 2000.0, 1.05,
            (.30, .25, .22, .22, .24, .30, .42, .55, .58, .52, .48, .48, .50, .50, .48, .48, .52, .62, .85, 1.0, .98, .90, .72, .48),
            "Mixed residential area: smoother aggregate of many homes, evening peak."),
    Profile("small_factory", "Small Factory", 50.0, 600.0, 0.30,
            (.05, .05, .05, .05, .05, .05, .10, .40, .85, 1.0, 1.0, 1.0, .95, .85, 1.0, 1.0, 1.0, .95, .40, .15, .08, .05, .05, .05),
            "Single-shift plant: plateau 9–18 with lunch dip at 13, low night; weekend factor 0.3."),
    Profile("school", "School", 20.0, 250.0, 0.15,
            (.05, .05, .05, .05, .05, .05, .10, .50, 1.0, 1.0, 1.0, 1.0, .90, 1.0, .95, .60, .20, .10, .08, .08, .05, .05, .05, .05),
            "Day school: occupied 8–15, near-idle otherwise; weekends almost off."),
    Profile("hospital", "Hospital", 600.0, 1000.0, 1.00,
            (.70, .68, .66, .66, .68, .72, .78, .85, .92, .98, 1.0, 1.0, 1.0, 1.0, .98, .96, .92, .90, .88, .86, .82, .78, .75, .72),
            "24/7 facility: flat high base with a mild daytime bump."),
    Profile("commercial_building", "Commercial Building", 100.0, 900.0, 0.70,
            (.15, .12, .12, .12, .12, .15, .20, .35, .60, .80, .88, .92, .95, 1.0, 1.0, .98, .95, .92, .88, .80, .70, .50, .30, .20),
            "Retail/mall: opens 9, peak through afternoon, closes ~21."),
    Profile("office", "Office", 60.0, 700.0, 0.25,
            (.08, .08, .08, .08, .08, .08, .12, .35, .80, 1.0, 1.0, 1.0, .92, 1.0, 1.0, .98, .90, .70, .35, .18, .12, .10, .08, .08),
            "Office block: 9–18 occupancy, HVAC-driven plateau; weekends low."),
]}


def shape(key: str, timestamps: pd.DatetimeIndex | pd.Series) -> np.ndarray:
    """Interpolated shape s(t) in [0, 1] at the given timestamps."""
    p = PROFILES[key]
    ts = pd.DatetimeIndex(timestamps)
    h = ts.hour.to_numpy() + ts.minute.to_numpy() / 60.0
    anchors = np.array(p.anchors + (p.anchors[0],))
    return np.interp(h, np.arange(25), anchors)


def demand_kw(key: str, timestamps, scale: float = 1.0, noise_seed: int | None = None) -> np.ndarray:
    p = PROFILES[key]
    ts = pd.DatetimeIndex(timestamps)
    s = shape(key, ts)
    kw = (p.base_kw + (p.peak_kw - p.base_kw) * s) * scale
    weekend = ts.dayofweek.to_numpy() >= 5
    kw = np.where(weekend, kw * p.weekend_factor, kw)
    if noise_seed is not None:
        rng = np.random.default_rng(noise_seed)
        kw = kw * rng.normal(1.0, 0.03, size=len(kw))
    return kw


def normalized(key: str, timestamps) -> np.ndarray:
    """Demand relative to the profile's peak_kw (used for background CIGRE loads)."""
    return demand_kw(key, timestamps) / PROFILES[key].peak_kw


def day_series(key: str, date: str, scale: float = 1.0) -> pd.DataFrame:
    ts = pd.date_range(pd.Timestamp(date), periods=96, freq="15min")
    return pd.DataFrame({"timestamp": ts, "demand_kw": demand_kw(key, ts, scale), "shape": shape(key, ts)})


def catalogue() -> list[dict]:
    return [
        {"key": p.key, "name": p.name, "base_kw": p.base_kw, "peak_kw": p.peak_kw, "weekend_factor": p.weekend_factor,
         "description": p.description, "label": "Synthetic consumer scenario", "hourly_shape": list(p.anchors)}
        for p in PROFILES.values()
    ]
