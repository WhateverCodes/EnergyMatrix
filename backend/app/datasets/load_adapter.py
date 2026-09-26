"""LoadDatasetAdapter — normalizes a real measured load series so it can be forecast with the
same ML pipeline as generation (app/forecasting). No real load dataset ships with this project;
the consumer profiles are synthetic (app/load_profiles). This adapter is exercised by tests and by
CSV uploads with source_type="load".
"""
from __future__ import annotations

import pandas as pd

from app.datasets.base import DatasetAdapter


class LoadDatasetAdapter:
    """Wraps any DatasetAdapter whose source_type == 'load' and exposes load_kw / load_pu."""

    def __init__(self, inner: DatasetAdapter):
        if inner.meta.source_type != "load":
            raise ValueError(f"dataset {inner.meta.id} is not a load dataset")
        self.inner = inner
        self.meta = inner.meta

    def load(self) -> pd.DataFrame:
        df = self.inner.load()
        return pd.DataFrame({
            "timestamp": df["timestamp"],
            "dataset_id": df["dataset_id"],
            "load_kw": df["generation_kw"],
            "load_pu": df["generation_pu"],
            "quality_flag": df["quality_flag"],
        })

    def as_forecast_frame(self) -> pd.DataFrame:
        """Same column names as generation so forecasting.features can consume it directly."""
        df = self.inner.load().copy()
        return df
