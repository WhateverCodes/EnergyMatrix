"""Config, networks, datasets, load profiles, scenario building and library."""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, File, Form, UploadFile

from app.api.serialize import clean
from app.config import DEFAULT_CONSTRAINTS, DEFAULT_WEIGHTS
from app.datasets.csv_generic import ColumnMapping, parse_upload
from app.datasets.registry import all_datasets, default_solar_dataset_id, get_dataset, real_data_available
from app.db.models import DatasetRow, session
from app.errors import ApiError
from app.load_profiles import profiles
from app.scenarios.library import get_scenario, list_scenarios
from app.schemas.scenario import ScenarioConfig
from app.simulation.mapping import build_inputs, scenario_summary
from app.simulation.network_factory import NETWORK_ID, NETWORK_LABEL, network_summary

router = APIRouter(prefix="/api")

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


@router.get("/config/constraints")
def get_constraints() -> dict:
    return {
        "constraints": DEFAULT_CONSTRAINTS.model_dump(),
        "weights": DEFAULT_WEIGHTS.model_dump(),
        "severity_thresholds": {"voltage_pu": [0.01, 0.03], "loading_pct": [10, 25]},
        "default_dataset": default_solar_dataset_id(),
        "real_data_available": real_data_available(),
    }


@router.get("/networks")
def list_networks() -> list[dict]:
    return [{"id": NETWORK_ID, "label": NETWORK_LABEL}]


@router.get("/networks/{network_id}")
def get_network(network_id: str) -> dict:
    if network_id != NETWORK_ID:
        raise ApiError("NETWORK_NOT_FOUND", f"Unknown network '{network_id}'", 404, {"available": [NETWORK_ID]})
    return clean(network_summary())


@router.get("/datasets")
def list_datasets() -> list[dict]:
    out = []
    for ds in all_datasets().values():
        m = ds.meta.to_dict()
        m["available_dates"] = ds.available_dates() if ds.meta.source_type == "solar" else []
        out.append(m)
    return clean(out)


@router.get("/datasets/{dataset_id}/series")
def dataset_series(dataset_id: str, start: str | None = None, end: str | None = None) -> dict:
    ds = get_dataset(dataset_id)
    try:
        s = pd.Timestamp(start) if start else None
        e = pd.Timestamp(end) if end else None
    except ValueError as exc:
        raise ApiError("BAD_TIMESTAMP", str(exc)) from exc
    df = ds.series(s, e)
    if len(df) > 5000:
        raise ApiError("RANGE_TOO_LARGE", "Request at most 5000 points (≈52 days at 15 min)", details={"points": len(df)})
    return clean({
        "dataset": ds.meta.to_dict(),
        "timestamps": [t.isoformat() for t in df["timestamp"]],
        "generation_kw": df["generation_kw"].tolist(),
        "generation_pu": df["generation_pu"].tolist(),
        "irradiation": df["irradiation"].tolist(),
        "quality_flag": df["quality_flag"].tolist(),
    })


@router.post("/datasets/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    timestamp_col: str = Form(...),
    value_col: str = Form(...),
    unit: str = Form("kW"),
    source_type: str = Form("solar"),
    name: str = Form("Uploaded dataset"),
    location: str = Form("Unknown"),
) -> dict:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise ApiError("FILE_TOO_LARGE", "Upload limit is 20 MB", 413)
    rep, _ = parse_upload(content, ColumnMapping(timestamp_col, value_col, unit, source_type, name, location))
    if rep.ok:
        with session() as s:
            ds = get_dataset(rep.dataset_id)
            m = ds.meta
            s.merge(DatasetRow(id=m.id, name=m.name, source_type=m.source_type, is_real=m.is_real, source=m.source,
                               file_path=str(getattr(ds, "csv_path", "")), coverage_start=m.coverage_start,
                               coverage_end=m.coverage_end, resolution_min=15, variables=m.variables))
            s.commit()
    return clean({"report": rep.to_dict()})


@router.get("/load-profiles")
def list_profiles() -> list[dict]:
    return profiles.catalogue()


@router.get("/load-profiles/{profile_type}/series")
def profile_series(profile_type: str, date: str = "2020-05-25", scale: float = 1.0) -> dict:
    if profile_type not in profiles.PROFILES:
        raise ApiError("UNKNOWN_PROFILE", f"Unknown profile '{profile_type}'", 404, {"available": sorted(profiles.PROFILES)})
    try:
        df = profiles.day_series(profile_type, date, scale)
    except ValueError as exc:
        raise ApiError("BAD_DATE", str(exc)) from exc
    return {"profile": profile_type, "label": "Synthetic consumer scenario",
            "timestamps": [t.isoformat() for t in df["timestamp"]], "demand_kw": df["demand_kw"].round(3).tolist()}


@router.post("/scenarios/build")
def build_scenario(cfg: ScenarioConfig) -> dict:
    return clean(scenario_summary(build_inputs(cfg)))


@router.get("/scenarios/library")
def scenario_library() -> list[dict]:
    return list_scenarios()


@router.get("/scenarios/library/{scenario_id}")
def scenario_detail(scenario_id: str) -> dict:
    return get_scenario(scenario_id)
