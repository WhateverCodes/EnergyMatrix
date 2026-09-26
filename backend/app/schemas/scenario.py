from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.config import Constraints, ObjectiveWeights


class BatteryConfig(BaseModel):
    enabled: bool = True
    bus: int = 11
    p_max_mw: float = Field(2.0, ge=0)
    e_max_mwh: float = Field(4.0, gt=0)
    soc_init_pct: float = Field(50.0, ge=0, le=100)
    soc_min_pct: float = Field(10.0, ge=0, le=100)
    soc_max_pct: float = Field(90.0, ge=0, le=100)
    eta_rt: float = Field(0.92, gt=0, le=1)


class CloudEvent(BaseModel):
    """Applied to ACTUAL generation only (the forecast does not know about it)."""

    start: str = "12:00"
    duration_min: int = Field(60, ge=15)
    depth: float = Field(0.7, ge=0, le=1, description="Fraction of PV output lost at the dip centre")


class ScenarioConfig(BaseModel):
    name: str = "Custom scenario"
    dataset_id: Optional[str] = None
    date: str = "2020-05-25"
    start: str = "10:00"
    end: str = "15:00"
    # generation
    pv_multiplier: float = Field(1.0, ge=0, description="Scales CIGRE nominal PV ratings")
    rooftop_cluster_mw: float = Field(0.0, ge=0)
    rooftop_cluster_bus: int = 11
    pv_scale: float = Field(1.0, ge=0, description="Solar ±% (1.0 = as measured)")
    cloud_event: Optional[CloudEvent] = None
    # consumption
    consumer_profile: str = "residential_society"
    target_bus: int = 11
    consumer_scale: float = Field(1.0, ge=0)
    demand_scale: float = Field(1.0, ge=0, description="Scales all demand (background + consumer)")
    noise_seed: Optional[int] = None
    # network
    battery: BatteryConfig = BatteryConfig()
    switch_states: Optional[dict[str, bool]] = None
    lines_out_of_service: list[int] = []
    constraints: Constraints = Constraints()
    weights: ObjectiveWeights = ObjectiveWeights()

    @field_validator("start", "end")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        h, m = v.split(":")
        if not (0 <= int(h) <= 23 and int(m) in (0, 15, 30, 45)):
            raise ValueError("time must be HH:MM on a 15-min boundary")
        return f"{int(h):02d}:{int(m):02d}"
