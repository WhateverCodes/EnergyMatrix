"""Global settings, default network constraints and objective weights.

Limits live here (backend) and are served at GET /api/config/constraints.
Every request may override them; the defaults below are the documented baseline.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
KAGGLE_DIR = RAW_DIR / "solar_kaggle"
PROCESSED_DIR = DATA_DIR / "processed"
SCENARIO_DIR = REPO_ROOT / "simulation" / "scenarios"
CALIBRATION_FILE = REPO_ROOT / "simulation" / "calibration.json"
DB_PATH = BACKEND_DIR / "gridtwin.db"

STEP_MINUTES = 15
STEP_HOURS = STEP_MINUTES / 60.0

# Load reactive power: fixed power factor 0.95 lagging for every load (documented in docs/simulation.md).
LOAD_POWER_FACTOR = 0.95
# PV inverter apparent-power rating relative to PV active rating (common 10 % oversizing).
INVERTER_S_OVERSIZE = 1.10


class Constraints(BaseModel):
    """Operating limits checked at every timestep."""

    v_min: float = Field(0.95, description="Minimum bus voltage, pu")
    v_max: float = Field(1.05, description="Maximum bus voltage, pu")
    line_loading_max: float = Field(100.0, description="Max line loading, % of thermal rating")
    trafo_loading_max: float = Field(100.0, description="Max transformer loading, % of rating")
    reverse_flow_limit_mw: Optional[float] = Field(
        None, description="If set, reverse flow above this (MW, per transformer) is a VIOLATION; else INFO only"
    )
    loss_pct_max: float = Field(8.0, description="Losses above this % of load are a WARNING")
    max_curtailment_pct: float = Field(20.0, description="Max PV curtailment per timestep, % of available")
    min_inverter_pf: float = Field(0.90, description="Minimum PV inverter power factor for reactive support")


class ObjectiveWeights(BaseModel):
    """Weights of the penalty J applied among feasible candidates (docs/optimization.md)."""

    w_curt: float = 10.0  # per MWh curtailed
    w_batt: float = 1.0  # per MWh battery throughput
    w_sw: float = 2.0  # per switch operation
    w_loss: float = 1.0  # per MWh losses
    w_q: float = 0.2  # per MVArh reactive support


DEFAULT_CONSTRAINTS = Constraints()
DEFAULT_WEIGHTS = ObjectiveWeights()

# Severity thresholds, by how far a value exceeds its limit.
# Voltage (pu beyond limit): LOW < 0.01 <= MEDIUM < 0.03 <= HIGH
# Loading (percentage points beyond limit): LOW < 10 <= MEDIUM < 25 <= HIGH
SEVERITY_VOLTAGE_PU = (0.01, 0.03)
SEVERITY_LOADING_PCT = (10.0, 25.0)
