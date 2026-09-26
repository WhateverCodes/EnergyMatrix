"""Dataset registry: Kaggle plants (if files present), the SYNTHETIC fallback, and uploads."""
from __future__ import annotations

import logging
from pathlib import Path

from app.config import KAGGLE_DIR, PROCESSED_DIR
from app.datasets.base import DatasetAdapter
from app.datasets.csv_generic import UploadedCsvAdapter
from app.datasets.solar_kaggle import SolarKaggleAdapter
from app.datasets.synthetic_clearsky import SyntheticClearSkyAdapter
from app.errors import ApiError

log = logging.getLogger("gridtwin.datasets")

MISSING_MSG = (
    "Kaggle solar files not found in data/raw/solar_kaggle/. Using the SYNTHETIC clear-sky profile. "
    "Place Plant_1_Generation_Data.csv, Plant_1_Weather_Sensor_Data.csv, Plant_2_Generation_Data.csv, "
    "Plant_2_Weather_Sensor_Data.csv there to use real data."
)

_static: dict[str, DatasetAdapter] | None = None


def _build_static(kaggle_dir: Path = KAGGLE_DIR) -> dict[str, DatasetAdapter]:
    out: dict[str, DatasetAdapter] = {}
    for plant in (1, 2):
        if SolarKaggleAdapter.files_present(kaggle_dir, plant):
            a = SolarKaggleAdapter(plant, kaggle_dir)
            a.fill_meta()
            out[a.meta.id] = a
    if not out:
        log.warning(MISSING_MSG)
        print(f"[gridtwin] WARNING: {MISSING_MSG}")
    s = SyntheticClearSkyAdapter()
    s.fill_meta()
    out[s.meta.id] = s
    return out


def all_datasets() -> dict[str, DatasetAdapter]:
    global _static
    if _static is None:
        _static = _build_static()
    out = dict(_static)
    if PROCESSED_DIR.exists():
        for p in sorted(PROCESSED_DIR.glob("upload_*.meta.json")):
            a = UploadedCsvAdapter(p)
            out[a.meta.id] = a
    return out


def get_dataset(dataset_id: str) -> DatasetAdapter:
    ds = all_datasets()
    if dataset_id not in ds:
        raise ApiError("DATASET_NOT_FOUND", f"Unknown dataset '{dataset_id}'", 404, {"available": sorted(ds)})
    return ds[dataset_id]


def default_solar_dataset_id() -> str:
    ds = all_datasets()
    return "kaggle_plant1" if "kaggle_plant1" in ds else "synthetic_clearsky"


def real_data_available() -> bool:
    return "kaggle_plant1" in all_datasets()
