"""Calibration sweep → simulation/calibration.json.

Sweeps the distributed PV penetration multiplier on the calibration window and records, from real
simulations:
  - first_violation_mult: lowest multiplier whose baseline QSTS violates a hard limit
  - battery_alone_limit_mult: highest multiplier at which the Battery candidate alone is feasible
  - curtail_cap_exceeded_mult: lowest multiplier at which curtailment alone needs > cap somewhere
  - all_levers_infeasible_mult (no battery): lowest multiplier at which no candidate is feasible
Also picks a clear day and a cloudy day from the dataset. Scenario parameters in
simulation/scenarios/*.json are set relative to these thresholds.

Run: make calibrate   (≈ 1–3 minutes)
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

import numpy as np  # noqa: E402

from app.config import CALIBRATION_FILE  # noqa: E402
from app.datasets.registry import default_solar_dataset_id, get_dataset  # noqa: E402
from app.optimization.actions.battery import BatteryAction  # noqa: E402
from app.optimization.actions.curtailment import CurtailmentAction  # noqa: E402
from app.optimization.evaluator import evaluate, simulate_candidate  # noqa: E402
from app.schemas.scenario import BatteryConfig, ScenarioConfig  # noqa: E402
from app.simulation.hosting_capacity import hosting_capacity  # noqa: E402
from app.simulation.mapping import build_inputs  # noqa: E402
from app.simulation.qsts import run_qsts  # noqa: E402

WINDOW = ("10:00", "15:00")
BATTERY = BatteryConfig(enabled=True, bus=11, p_max_mw=2.0, e_max_mwh=4.0, soc_init_pct=20.0)
NO_BATT = BatteryConfig(enabled=False)


def pick_days(ds_id: str) -> dict:
    df = get_dataset(ds_id).load()
    df["date"] = df["timestamp"].dt.strftime("%Y-%m-%d")
    mid = df[(df["timestamp"].dt.hour >= 9) & (df["timestamp"].dt.hour < 16)]
    bad = set(df.loc[df["quality_flag"] == "long_gap", "date"])
    stats = []
    for d, g in mid.groupby("date"):
        if d in bad or len(g) < 28:
            continue
        pu = g["generation_pu"].to_numpy()
        stats.append({"date": d, "energy": float(pu.sum()), "roughness": float(np.abs(np.diff(pu)).sum()), "peak": float(pu.max())})
    clear = max(stats, key=lambda s: s["energy"] - 3.0 * s["roughness"])
    cloudy = max(stats, key=lambda s: s["roughness"])
    return {"clear_day": clear, "cloudy_day": cloudy, "n_days_considered": len(stats)}


def cfg(date: str, mult: float, battery: BatteryConfig) -> ScenarioConfig:
    return ScenarioConfig(date=date, start=WINDOW[0], end=WINDOW[1], pv_multiplier=mult, battery=battery)


def main() -> None:
    t0 = time.time()
    ds_id = default_solar_dataset_id()
    days = pick_days(ds_id)
    date = days["clear_day"]["date"]
    print(f"dataset={ds_id} clear day={date} cloudy day={days['cloudy_day']['date']}")

    sweep = []
    first_violation = None
    for mult in range(20, 92, 2):
        res = run_qsts(build_inputs(cfg(date, mult, NO_BATT)))
        viol = res.summary["status"] != "SAFE"
        maxv = max(r.max_v for r in res.records)
        maxl = max(r.max_line for r in res.records)
        sweep.append({"mult": mult, "installed_pv_mw": round(0.21 * mult, 3), "baseline_status": res.summary["status"],
                      "max_v": maxv, "max_line_pct": maxl,
                      "types": sorted({v["type"] for v in res.summary["violations"]})})
        if viol and first_violation is None:
            first_violation = mult
    print(f"first violation at mult={first_violation}")

    battery_limit = None
    curtail_exceeded = None
    req = None
    for mult in range(first_violation, 92, 2):
        inp = build_inputs(cfg(date, mult, BATTERY))
        if battery_limit is None or battery_limit == mult - 2:
            cand, _, _ = simulate_candidate(inp, BatteryAction())
            if cand["feasible"]:
                battery_limit = mult
        if curtail_exceeded is None:
            cand, _, _ = simulate_candidate(build_inputs(cfg(date, mult, NO_BATT)), CurtailmentAction())
            if not cand["feasible"]:
                curtail_exceeded = mult
                req = cand["metrics"]["max_required_curtail_pct"]
        if curtail_exceeded is not None and battery_limit is not None and mult > battery_limit + 2:
            break
    print(f"battery alone feasible up to mult={battery_limit}; curtailment alone exceeds cap from mult={curtail_exceeded} (req {req}%)")

    infeasible_from = None
    for mult in range(curtail_exceeded or 90, 92, 4):
        r = evaluate(cfg(date, mult, NO_BATT), use_cache=False)
        if r["status"] == "NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS":
            infeasible_from = mult
            break
    print(f"no candidate feasible (battery unavailable) from mult={infeasible_from}")

    hc = hosting_capacity(cfg(date, 20, NO_BATT))
    out = {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "dataset_id": ds_id,
        "window": list(WINDOW),
        "calibration_day": date,
        "days": days,
        "battery_for_battery_threshold": BATTERY.model_dump(),
        "pv_mult_unit_mw": 0.21,
        "thresholds": {
            "first_violation_mult": first_violation,
            "battery_alone_limit_mult": battery_limit,
            "curtail_cap_exceeded_mult": curtail_exceeded,
            "all_levers_infeasible_mult_no_battery": infeasible_from,
        },
        "sweep": sweep,
        "hosting_capacity_at_mult_20": hc,
        "runtime_s": round(time.time() - t0, 1),
    }
    Path(CALIBRATION_FILE).write_text(json.dumps(out, indent=2))
    print(f"wrote {CALIBRATION_FILE} in {out['runtime_s']} s")


if __name__ == "__main__":
    main()
