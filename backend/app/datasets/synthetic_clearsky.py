"""SYNTHETIC clear-sky generation profile — clearly labelled fallback, never presented as real.

Deterministic bell curve between sunrise 06:00 and sunset 18:45 (typical May–June in India),
with optional deterministic cloud dips from a seed. Same date range as the Kaggle data.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from app.datasets.base import NORMALIZED_COLUMNS, DatasetAdapter, DatasetMeta

SUNRISE_H = 6.0
SUNSET_H = 18.75


def clear_sky_pu(hours: np.ndarray) -> np.ndarray:
    x = (hours - SUNRISE_H) / (SUNSET_H - SUNRISE_H)
    out = np.where((x > 0) & (x < 1), np.sin(np.pi * np.clip(x, 0, 1)) ** 1.5, 0.0)
    return out


class SyntheticClearSkyAdapter(DatasetAdapter):
    def __init__(self, start: str = "2020-05-15", days: int = 34, cloud_seed: int | None = 7):
        self.start = start
        self.days = days
        self.cloud_seed = cloud_seed
        self.meta = DatasetMeta(
            id="synthetic_clearsky",
            name="SYNTHETIC clear-sky PV profile",
            source_type="solar",
            location="Synthetic (no location)",
            is_real=False,
            source="Generated: sin^1.5 bell 06:00–18:45 with deterministic cloud dips",
            description="Fallback used when the Kaggle files are absent. NOT real data.",
            label="SYNTHETIC generation profile — not measured data",
            variables=["generation_pu (synthetic)", "irradiation (synthetic, = pu x 1.0 kW/m2)"],
        )

    def load(self) -> pd.DataFrame:
        return _build(self.start, self.days, self.cloud_seed).copy()

    def fill_meta(self) -> None:
        df = self.load()
        self.meta.coverage_start = df["timestamp"].min().isoformat()
        self.meta.coverage_end = df["timestamp"].max().isoformat()
        self.meta.records = int(len(df))
        self.meta.capacity_kw = 1000.0


@lru_cache(maxsize=4)
def _build(start: str, days: int, cloud_seed: int | None) -> pd.DataFrame:
    grid = pd.date_range(start, periods=days * 96, freq="15min")
    hours = (grid.hour + grid.minute / 60.0).to_numpy(dtype=float)
    pu = clear_sky_pu(hours)
    if cloud_seed is not None:
        rng = np.random.default_rng(cloud_seed)
        day_idx = np.arange(len(grid)) // 96
        for d in range(days):
            if rng.random() < 0.4:  # cloudy day: one dip
                centre = rng.uniform(9.5, 15.5)
                width = rng.uniform(0.3, 1.2)
                depth = rng.uniform(0.3, 0.8)
                m = day_idx == d
                pu[m] *= 1.0 - depth * np.exp(-0.5 * ((hours[m] - centre) / width) ** 2)
    df = pd.DataFrame({
        "timestamp": grid,
        "dataset_id": "synthetic_clearsky",
        "location": "Synthetic",
        "source_type": "solar",
        "generation_kw": pu * 1000.0,
        "generation_pu": pu,
        "irradiation": pu * 1.0,
        "ambient_temp": 25.0 + 8.0 * pu,
        "module_temp": 25.0 + 30.0 * pu,
        "quality_flag": "ok",
    })[NORMALIZED_COLUMNS]
    return df
