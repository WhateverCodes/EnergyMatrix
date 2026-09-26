"""Generic CSV upload with explicit column mapping.

The user names the timestamp column, the value column, the unit (W/kW/MW) and the source type
(solar or load). We validate, report missing values and gaps, resample to 15 min, and store a
normalized CSV under data/processed/ plus a .meta.json sidecar. Errors are reported, never raised
to the client as stack traces.
"""
from __future__ import annotations

import io
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from app.config import PROCESSED_DIR
from app.datasets.base import NORMALIZED_COLUMNS, DatasetAdapter, DatasetMeta
from app.datasets.solar_kaggle import fill_gaps

UNIT_TO_KW = {"W": 0.001, "kW": 1.0, "MW": 1000.0}


@dataclass
class ColumnMapping:
    timestamp_col: str
    value_col: str
    unit: str = "kW"
    source_type: str = "solar"  # "solar" | "load"
    name: str = "Uploaded dataset"
    location: str = "Unknown"


@dataclass
class ValidationReport:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    rows_in: int = 0
    rows_out: int = 0
    missing_values: int = 0
    gaps_interpolated: int = 0
    long_gap_steps: int = 0
    coverage_start: str | None = None
    coverage_end: str | None = None
    detected_resolution_min: float | None = None
    dataset_id: str | None = None

    def to_dict(self) -> dict:
        return dict(self.__dict__)


def to_kw(values: pd.Series, unit: str) -> pd.Series:
    if unit not in UNIT_TO_KW:
        raise ValueError(f"unit must be one of {sorted(UNIT_TO_KW)}")
    return values.astype(float) * UNIT_TO_KW[unit]


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s[:40] or "dataset"


def parse_upload(content: bytes, mapping: ColumnMapping, out_dir: Path = PROCESSED_DIR) -> tuple[ValidationReport, pd.DataFrame | None]:
    rep = ValidationReport(ok=False)
    try:
        raw = pd.read_csv(io.BytesIO(content))
    except Exception as exc:  # malformed CSV of any kind
        rep.errors.append(f"could not read CSV: {type(exc).__name__}: {exc}")
        return rep, None
    rep.rows_in = int(len(raw))
    for col in (mapping.timestamp_col, mapping.value_col):
        if col not in raw.columns:
            rep.errors.append(f"column '{col}' not found; available: {list(raw.columns)}")
    if mapping.unit not in UNIT_TO_KW:
        rep.errors.append(f"unit must be one of {sorted(UNIT_TO_KW)}")
    if mapping.source_type not in ("solar", "load"):
        rep.errors.append("source_type must be 'solar' or 'load'")
    if rep.errors:
        return rep, None

    ts = pd.to_datetime(raw[mapping.timestamp_col], errors="coerce")
    bad_ts = int(ts.isna().sum())
    if bad_ts:
        rep.warnings.append(f"{bad_ts} rows with unparseable timestamps dropped")
    vals = pd.to_numeric(raw[mapping.value_col], errors="coerce")
    rep.missing_values = int(vals.isna().sum())
    if rep.missing_values:
        rep.warnings.append(f"{rep.missing_values} missing/non-numeric values")
    s = pd.Series(to_kw(vals, mapping.unit).to_numpy(), index=ts).loc[ts.notna().to_numpy()]
    s = s[~s.index.duplicated(keep="first")].sort_index()
    if len(s) < 2:
        rep.errors.append("need at least 2 valid timestamped rows")
        return rep, None
    rep.detected_resolution_min = float(pd.Series(s.index).diff().median().total_seconds() / 60.0)
    if rep.detected_resolution_min > 60:
        rep.warnings.append(f"coarse resolution ({rep.detected_resolution_min:.0f} min) — upsampled to 15 min by interpolation")

    q = s.resample("15min").mean()
    filled, interp, long = fill_gaps(q)
    if rep.detected_resolution_min > 15:
        filled = q.interpolate(limit_area="inside")
        interp = q.isna() & filled.notna()
        long = filled.isna()
    rep.gaps_interpolated = int(interp.sum())
    rep.long_gap_steps = int(long.sum())
    if rep.long_gap_steps:
        rep.warnings.append(f"{rep.long_gap_steps} steps in gaps > 1 h left flagged 'long_gap'")
    if (filled.dropna() < 0).any() and mapping.source_type == "solar":
        rep.warnings.append("negative generation values clipped to 0")
        filled = filled.clip(lower=0)

    cap = float(np.nanpercentile(filled.to_numpy(dtype=float), 99.5)) if filled.notna().any() else 0.0
    if cap <= 0:
        rep.errors.append("all values are zero or missing")
        return rep, None
    flags = pd.Series("ok", index=filled.index)
    flags[interp] = "interpolated"
    flags[long] = "long_gap"
    dataset_id = f"upload_{slugify(mapping.name)}"
    df = pd.DataFrame({
        "timestamp": filled.index,
        "dataset_id": dataset_id,
        "location": mapping.location,
        "source_type": mapping.source_type,
        "generation_kw": filled.to_numpy(),
        "generation_pu": (filled / cap).clip(0, 1).to_numpy(),
        "irradiation": np.nan,
        "ambient_temp": np.nan,
        "module_temp": np.nan,
        "quality_flag": flags.to_numpy(),
    })[NORMALIZED_COLUMNS]
    rep.rows_out = int(len(df))
    rep.coverage_start = df["timestamp"].min().isoformat()
    rep.coverage_end = df["timestamp"].max().isoformat()
    rep.dataset_id = dataset_id
    rep.ok = True

    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_dir / f"{dataset_id}.csv", index=False)
    meta = DatasetMeta(
        id=dataset_id, name=mapping.name, source_type=mapping.source_type, location=mapping.location,
        is_real=True, source="User upload", description=f"Uploaded CSV ({mapping.value_col} in {mapping.unit})",
        label=f"Uploaded data ({mapping.name}) — user-supplied, not verified",
        coverage_start=rep.coverage_start, coverage_end=rep.coverage_end, records=rep.rows_out,
        variables=[mapping.value_col], capacity_kw=cap,
    )
    (out_dir / f"{dataset_id}.meta.json").write_text(json.dumps(meta.to_dict(), indent=2))
    return rep, df


class UploadedCsvAdapter(DatasetAdapter):
    def __init__(self, meta_path: Path):
        d = json.loads(meta_path.read_text())
        self.meta = DatasetMeta(**d)
        self.csv_path = meta_path.with_name(f"{self.meta.id}.csv")

    def load(self) -> pd.DataFrame:
        df = pd.read_csv(self.csv_path, parse_dates=["timestamp"])
        df["quality_flag"] = df["quality_flag"].fillna("ok")
        return df

    def fill_meta(self) -> None:
        return None
