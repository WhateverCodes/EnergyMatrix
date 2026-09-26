"""Turn simulation objects into strict-JSON-safe structures (NaN/inf -> None, numpy -> Python)."""
from __future__ import annotations

import dataclasses
import math
from typing import Any

import numpy as np
from pydantic import BaseModel


def clean(obj: Any) -> Any:
    if obj is None or isinstance(obj, (bool, str, int)):
        return obj
    if isinstance(obj, float):
        return None if math.isnan(obj) or math.isinf(obj) else obj
    if isinstance(obj, (np.floating,)):
        return clean(float(obj))
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return [clean(x) for x in obj.tolist()]
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [clean(x) for x in obj]
    if isinstance(obj, BaseModel):
        return clean(obj.model_dump())
    if dataclasses.is_dataclass(obj):
        return clean(dataclasses.asdict(obj))
    return str(obj)


def qsts_payload(res, metrics: dict) -> dict:
    return clean({
        "status": res.summary["status"],
        "summary": res.summary,
        "metrics": metrics,
        "switch_states": res.switch_states,
        "steps": [dataclasses.asdict(r) for r in res.records],
    })
