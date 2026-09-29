"""Scenario library: reproducible JSON files in simulation/scenarios/ (S1–S8).

Each file holds a ScenarioConfig plus metadata (title, description, expected outcome class,
parameter rationale relative to simulation/calibration.json). Expected outcome classes are asserted
by tests/acceptance — results are always computed, never stored.
"""
from __future__ import annotations

import json
from functools import lru_cache

from app.config import SCENARIO_DIR
from app.errors import ApiError
from app.schemas.scenario import ScenarioConfig


@lru_cache(maxsize=1)
def _load_all() -> dict[str, dict]:
    out = {}
    for p in sorted(SCENARIO_DIR.glob("S*.json")):
        d = json.loads(p.read_text())
        ScenarioConfig.model_validate(d["config"])  # fail fast on a malformed file
        out[d["id"]] = d
    return out


def _normalized(d: dict) -> dict:
    """Scenario with its config expanded to a full ScenarioConfig (all defaults filled in)."""
    return {**d, "config": ScenarioConfig.model_validate(d["config"]).model_dump()}


def list_scenarios() -> list[dict]:
    return [_normalized(d) for d in sorted(_load_all().values(), key=lambda d: int(d["id"][1:]))]


def get_scenario(sid: str) -> dict:
    d = _load_all().get(sid.upper())
    if d is None:
        raise ApiError("SCENARIO_NOT_FOUND", f"Unknown scenario '{sid}'", 404, {"available": sorted(_load_all())})
    return _normalized(d)


def scenario_config(sid: str) -> ScenarioConfig:
    return ScenarioConfig.model_validate(get_scenario(sid)["config"])
