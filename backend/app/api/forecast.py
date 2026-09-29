"""Forecast backtest and predictive operation."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.serialize import clean
from app.datasets.registry import default_solar_dataset_id, get_dataset
from app.errors import ApiError
from app.forecasting.backtest import backtest_series, run_backtest
from app.forecasting.predictive import run_predictive
from app.scenarios.library import get_scenario
from app.schemas.scenario import ScenarioConfig

router = APIRouter(prefix="/api/forecast")


class PredictiveRequest(BaseModel):
    config: Optional[ScenarioConfig] = None
    scenario_id: Optional[str] = Field(None, description="Use a library scenario (S7/S8) with its predictive settings")
    t0: Optional[str] = None
    horizon_steps: Optional[int] = Field(None, ge=1, le=8)
    model: Optional[str] = None
    plan_on: Optional[str] = None
    demand_error_pct: float = Field(0.0, ge=-50, le=50)


@router.get("/backtest")
def backtest(dataset: Optional[str] = None, date: Optional[str] = None, horizon: int = 4) -> dict:
    ds = dataset or default_solar_dataset_id()
    meta = get_dataset(ds).meta
    if meta.source_type != "solar":
        raise ApiError("NOT_SOLAR", "Backtest is defined for generation datasets")
    if not 1 <= horizon <= 8:
        raise ApiError("BAD_HORIZON", "horizon must be 1..8 steps")
    out = run_backtest(ds)
    out["series"] = backtest_series(ds, date, horizon)
    out["dataset"] = {"id": meta.id, "name": meta.name, "is_real": meta.is_real, "label": meta.label}
    return clean(out)


@router.post("/predictive")
def predictive(req: PredictiveRequest) -> dict:
    defaults = {"t0": "12:00", "horizon_steps": 8, "model": "hgb", "plan_on": "p50"}
    if req.scenario_id:
        sc = get_scenario(req.scenario_id)
        cfg = ScenarioConfig.model_validate(sc["config"])
        defaults |= sc.get("predictive", {})
    elif req.config is not None:
        cfg = req.config
    else:
        raise ApiError("MISSING_SCENARIO", "Provide config or scenario_id")
    p = {k: getattr(req, k) if getattr(req, k) is not None else defaults[k] for k in defaults}
    return clean(run_predictive(cfg, p["t0"], p["horizon_steps"], p["model"], p["plan_on"], req.demand_error_pct)
                 | {"scenario_id": req.scenario_id, "config": cfg.model_dump()})
