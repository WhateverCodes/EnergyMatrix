from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from app.config import ObjectiveWeights
from app.schemas.scenario import ScenarioConfig


class EvaluateRequest(BaseModel):
    config: ScenarioConfig
    weights: Optional[ObjectiveWeights] = None


class ApplyRequest(BaseModel):
    config: ScenarioConfig
    candidate_key: str


class SnapshotRequest(BaseModel):
    """Single-step power flow for the Live Lab. Every slider maps to a real model input."""

    config: ScenarioConfig
    time: Optional[str] = Field(None, description="HH:MM inside the window; default = max-PV step")
    pv_pct: float = Field(100.0, ge=0, le=400, description="Solar output, % of scenario value")
    demand_pct: float = Field(100.0, ge=0, le=300, description="All demand, % of scenario value")
    consumer_scale: Optional[float] = Field(None, ge=0, le=20)
    battery_available: Optional[bool] = None
    soc_pct: Optional[float] = Field(None, ge=0, le=100)
    curtailment_cap_pct: Optional[float] = Field(None, ge=0, le=100)
    v_max: Optional[float] = Field(None, ge=1.0, le=1.2)
    include_preview: bool = Field(False, description="Also run the single-step heal preview (slower, ~0.5 s)")


class SaveScenarioRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    config: ScenarioConfig
    selected_intervention: Optional[str] = None


class HostingRequest(BaseModel):
    config: ScenarioConfig
