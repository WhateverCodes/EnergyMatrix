"""Kaggle "Solar Power Generation Data" (two plants in India, 15 May – 17 Jun 2020, 15-min).

Findings from inspecting the files (docs/datasets.md):
- Plant 1 generation DATE_TIME is "DD-MM-YYYY HH:MM"; the other three files use "YYYY-MM-DD HH:MM:SS".
  Times are local plant time (IST); parsed as naive timestamps.
- Plant 1 DC_POWER is ~10.2x AC_POWER (a scale/unit inconsistency in the source); Plant 2 DC/AC ~1.02.
  We therefore use AC_POWER only.
- 22 inverters (SOURCE_KEY) per plant. Some timestamps have fewer rows (Plant 2: 840 timestamps with 18).
  Plant total = mean AC per reporting inverter x 22, flagged "missing_inverters".
- Gaps <= 1 h interpolated ("interpolated"); longer gaps flagged "long_gap" (excluded from metrics) unless
  irradiation is 0, in which case generation is 0 ("night_zero").
- generation_pu = plant AC / plant capacity; capacity = 99.5th percentile of plant AC (documented estimate).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from app.config import KAGGLE_DIR
from app.datasets.base import NORMALIZED_COLUMNS, DatasetAdapter, DatasetMeta

DATE_FORMATS = ["%d-%m-%Y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"]
MAX_INTERP_STEPS = 4  # 1 h at 15-min resolution
CAPACITY_PERCENTILE = 99.5
LABEL = "Real plant generation shape (Kaggle, India) — scaled to feeder PV capacity"


def detect_datetime_format(values: pd.Series) -> str:
    """Return the first format that parses a sample of the column without error."""
    sample = values.dropna().astype(str).head(200)
    for fmt in DATE_FORMATS:
        try:
            pd.to_datetime(sample, format=fmt)
            return fmt
        except (ValueError, TypeError):
            continue
    raise ValueError(f"Unrecognized DATE_TIME format, e.g. {sample.iloc[0]!r}")


def parse_datetime(values: pd.Series) -> pd.Series:
    return pd.to_datetime(values.astype(str), format=detect_datetime_format(values))


def aggregate_inverters(gen: pd.DataFrame) -> pd.DataFrame:
    """Sum AC across inverters per timestamp, correcting for non-reporting inverters."""
    n_total = gen["SOURCE_KEY"].nunique()
    g = gen.groupby("timestamp").agg(ac_sum_kw=("AC_POWER", "sum"), inverters=("SOURCE_KEY", "nunique"))
    g["ac_kw"] = g["ac_sum_kw"] / g["inverters"] * n_total
    g["missing_inverters"] = g["inverters"] < n_total
    g.attrs["n_inverters"] = n_total
    return g


def fill_gaps(series: pd.Series, max_steps: int = MAX_INTERP_STEPS) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Linear interpolation for NaN runs of length <= max_steps. Returns (filled, interpolated_mask, long_gap_mask)."""
    isna = series.isna()
    run_id = (isna != isna.shift()).cumsum()
    run_len = isna.groupby(run_id).transform("sum")
    short = isna & (run_len <= max_steps)
    long = isna & (run_len > max_steps)
    interp = series.interpolate(method="linear", limit_area="inside")
    filled = series.copy()
    filled[short] = interp[short]
    return filled, short & filled.notna(), long | (short & filled.isna())


class SolarKaggleAdapter(DatasetAdapter):
    def __init__(self, plant: int, directory: Path = KAGGLE_DIR):
        self.plant = plant
        self.dir = directory
        self.gen_path = directory / f"Plant_{plant}_Generation_Data.csv"
        self.weather_path = directory / f"Plant_{plant}_Weather_Sensor_Data.csv"
        self.meta = DatasetMeta(
            id=f"kaggle_plant{plant}",
            name=f"Kaggle Solar Plant {plant}",
            source_type="solar",
            location="India (plant ID %s)" % ("4135001" if plant == 1 else "4136001"),
            is_real=True,
            source="Kaggle: 'Solar Power Generation Data' (anikannal), 2 plants in India",
            description="Inverter-level AC power + plant weather sensor, 15-min, 34 days May–June 2020.",
            label=LABEL,
        )

    @staticmethod
    def files_present(directory: Path = KAGGLE_DIR, plant: int = 1) -> bool:
        return (directory / f"Plant_{plant}_Generation_Data.csv").exists() and (
            directory / f"Plant_{plant}_Weather_Sensor_Data.csv").exists()

    def load(self) -> pd.DataFrame:
        return _load_cached(str(self.gen_path), str(self.weather_path), self.meta.id).copy()

    def fill_meta(self) -> None:
        df = self.load()
        self.meta.coverage_start = df["timestamp"].min().isoformat()
        self.meta.coverage_end = df["timestamp"].max().isoformat()
        self.meta.records = int(len(df))
        self.meta.variables = ["AC_POWER (aggregated)", "IRRADIATION", "AMBIENT_TEMPERATURE", "MODULE_TEMPERATURE"]
        self.meta.capacity_kw = float(df.attrs.get("capacity_kw", np.nan))
        counts = df["quality_flag"].value_counts().to_dict()
        self.meta.notes = [
            "AC_POWER used (Plant 1 DC_POWER is ~10x AC — source inconsistency).",
            f"Capacity estimate = {CAPACITY_PERCENTILE}th percentile of plant AC = {self.meta.capacity_kw:.0f} kW.",
            f"Quality flags: {counts}",
        ]


@lru_cache(maxsize=4)
def _load_cached(gen_path: str, weather_path: str, dataset_id: str) -> pd.DataFrame:
    gen = pd.read_csv(gen_path)
    gen["timestamp"] = parse_datetime(gen["DATE_TIME"])
    agg = aggregate_inverters(gen)

    w = pd.read_csv(weather_path)
    w["timestamp"] = parse_datetime(w["DATE_TIME"])
    w = w.groupby("timestamp")[["IRRADIATION", "AMBIENT_TEMPERATURE", "MODULE_TEMPERATURE"]].mean()

    start = min(agg.index.min(), w.index.min()).floor("D")
    end = max(agg.index.max(), w.index.max()).ceil("D") - pd.Timedelta(minutes=15)
    grid = pd.date_range(start, end, freq="15min")

    ac = agg["ac_kw"].reindex(grid)
    miss_inv = agg["missing_inverters"].astype("boolean").reindex(grid).fillna(False).astype(bool)
    irr, _, _ = fill_gaps(w["IRRADIATION"].reindex(grid))
    amb, _, _ = fill_gaps(w["AMBIENT_TEMPERATURE"].reindex(grid))
    mod, _, _ = fill_gaps(w["MODULE_TEMPERATURE"].reindex(grid))

    ac_filled, interp_mask, long_mask = fill_gaps(ac)
    night = irr.fillna(-1).eq(0.0)
    night_fill = ac_filled.isna() & night
    ac_filled[night_fill] = 0.0
    long_mask = long_mask & ~night_fill

    flags = pd.Series("ok", index=grid)
    flags[miss_inv] = "missing_inverters"
    flags[interp_mask] = "interpolated"
    flags[night_fill] = "night_zero"
    flags[long_mask] = "long_gap"

    capacity = float(np.nanpercentile(ac_filled.to_numpy(), CAPACITY_PERCENTILE))
    pu = (ac_filled / capacity).clip(lower=0.0, upper=1.0)

    df = pd.DataFrame({
        "timestamp": grid,
        "dataset_id": dataset_id,
        "location": "India",
        "source_type": "solar",
        "generation_kw": ac_filled.to_numpy(),
        "generation_pu": pu.to_numpy(),
        "irradiation": irr.to_numpy(),
        "ambient_temp": amb.to_numpy(),
        "module_temp": mod.to_numpy(),
        "quality_flag": flags.to_numpy(),
    })[NORMALIZED_COLUMNS]
    df.attrs["capacity_kw"] = capacity
    df.attrs["n_inverters"] = agg.attrs["n_inverters"]
    return df
