"""Dataset adapter contract and normalized generation schema."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import pandas as pd

NORMALIZED_COLUMNS = [
    "timestamp", "dataset_id", "location", "source_type", "generation_kw", "generation_pu",
    "irradiation", "ambient_temp", "module_temp", "quality_flag",
]

QUALITY_FLAGS = {"ok", "interpolated", "missing_inverters", "night_zero", "long_gap"}


@dataclass
class DatasetMeta:
    id: str
    name: str
    source_type: str  # "solar" | "load"
    location: str
    is_real: bool
    source: str
    description: str
    resolution_min: int = 15
    label: str = ""
    coverage_start: str | None = None
    coverage_end: str | None = None
    records: int = 0
    variables: list[str] = field(default_factory=list)
    capacity_kw: float | None = None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return dict(self.__dict__)


class DatasetAdapter(ABC):
    """Every dataset is exposed as a normalized 15-min frame (NORMALIZED_COLUMNS)."""

    meta: DatasetMeta

    @abstractmethod
    def load(self) -> pd.DataFrame:
        """Return the full normalized frame, timestamp-sorted, on a regular 15-min grid."""

    def series(self, start: pd.Timestamp | None = None, end: pd.Timestamp | None = None) -> pd.DataFrame:
        df = self.load()
        if start is not None:
            df = df[df["timestamp"] >= start]
        if end is not None:
            df = df[df["timestamp"] <= end]
        return df.reset_index(drop=True)

    def available_dates(self) -> list[str]:
        df = self.load()
        good = df[df["quality_flag"] != "long_gap"]
        return sorted({t.strftime("%Y-%m-%d") for t in good["timestamp"]})


def validate_normalized(df: pd.DataFrame) -> list[str]:
    """Return a list of schema problems (empty list = valid)."""
    problems = []
    missing = [c for c in NORMALIZED_COLUMNS if c not in df.columns]
    if missing:
        problems.append(f"missing columns: {missing}")
        return problems
    if not df["timestamp"].is_monotonic_increasing:
        problems.append("timestamps not sorted")
    if df["timestamp"].duplicated().any():
        problems.append("duplicate timestamps")
    steps = df["timestamp"].diff().dropna().unique()
    if len(steps) > 1 or (len(steps) == 1 and steps[0] != pd.Timedelta(minutes=15)):
        problems.append("grid is not a regular 15-min series")
    bad_flags = set(df["quality_flag"].unique()) - QUALITY_FLAGS
    if bad_flags:
        problems.append(f"unknown quality flags {bad_flags}")
    return problems
