"""Predictive operation: forecast -> twin on forecast -> plan -> replay the plan on ACTUAL data.

At issue time t0:
 1. Forecast generation_pu for the next N steps (P10/P50/P90). Features use only data observed up to t0
    (including any cloud event that has already happened).
 2. Run the twin (QSTS) on the P50 and P90 forecasts -> predicted violations with timestamps.
 3. Evaluate corrective actions on the forecast chosen for planning (plan_on = p50 or p90).
 4. Freeze the recommended plan: switch configuration + per-step battery power, curtailment fraction and
    inverter reactive power.
 5. Replay that FIXED plan on actual data (with the actual cloud event) -> PLAN_HELD or
    PLAN_FAILED_ON_ACTUALS with the failing steps.
Demand forecast = the synthetic schedule x (1 + demand_error_pct/100) — not an ML forecast (the consumer
profiles are deterministic, so ML metrics on them would be meaningless).
The ML model is trained on every day of the dataset EXCEPT the scenario date (leave-one-day-out).
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from app.datasets.registry import default_solar_dataset_id, get_dataset
from app.errors import ApiError
from app.forecasting.features import make_frame
from app.forecasting.models import MODELS, QuantileModel, fit_hgb, predict
from app.optimization.evaluator import cached_entry, config_key, evaluate
from app.schemas.scenario import ScenarioConfig
from app.simulation.mapping import build_inputs, cloud_factor
from app.simulation.metrics import compute_metrics
from app.simulation.qsts import StepControl, run_qsts
from app.simulation.topology import apply_switch_states

HISTORY_STEPS = 8


@lru_cache(maxsize=8)
def _model_excluding(dataset_id: str, date: str) -> QuantileModel:
    df = get_dataset(dataset_id).load()
    frame = make_frame(df, range(1, 9))
    keep = (frame["target_time"].dt.strftime("%Y-%m-%d") != date) & (frame["issue"].dt.strftime("%Y-%m-%d") != date)
    return fit_hgb(frame[keep])


def observed_frame(cfg: ScenarioConfig) -> pd.DataFrame:
    """Dataset with the scenario's cloud event applied to the scenario day (what the plant actually saw)."""
    ds_id = cfg.dataset_id or default_solar_dataset_id()
    df = get_dataset(ds_id).load()
    if cfg.cloud_event is not None:
        day = df["timestamp"].dt.strftime("%Y-%m-%d") == cfg.date
        f = cloud_factor(pd.DatetimeIndex(df.loc[day, "timestamp"]), cfg.cloud_event)
        df.loc[day, "generation_pu"] = df.loc[day, "generation_pu"].to_numpy() * f
        df.loc[day, "irradiation"] = df.loc[day, "irradiation"].to_numpy() * f
    return df


class ScheduleLever:
    """Replays a frozen plan: same controls every step regardless of what actually happens."""

    always = True
    key = "schedule"

    def __init__(self, battery: list[float], curtail: list[float], q_each: list[list[float]]):
        self.battery, self.curtail, self.q = battery, curtail, q_each

    def step(self, sc, ctrl: StepControl, pf):
        k = sc.k
        ctrl.battery_p_mw = self.battery[k]
        ctrl.curtail_frac = self.curtail[k]
        if self.q[k]:
            ctrl.pv_q_mvar = np.asarray(self.q[k], dtype=float)
        return pf


def _viol_summary(res) -> dict:
    return {"status": res.summary["status"], "violating_steps": [r.label for r in res.records if r.status != "SAFE"],
            "violations": res.summary["violations"]}


def run_predictive(cfg: ScenarioConfig, t0: str, horizon_steps: int = 8, model: str = "hgb", plan_on: str = "p50",
                   demand_error_pct: float = 0.0) -> dict:
    if model not in MODELS:
        raise ApiError("UNKNOWN_MODEL", f"model must be one of {MODELS}")
    if plan_on not in ("p50", "p90"):
        raise ApiError("BAD_PLAN_ON", "plan_on must be p50 or p90")
    if not 1 <= horizon_steps <= 8:
        raise ApiError("BAD_HORIZON", "horizon_steps must be 1..8 (model trained for up to 2 h)")
    ds_id = cfg.dataset_id or default_solar_dataset_id()
    t_issue = pd.Timestamp(f"{cfg.date} {t0}")
    hz = pd.date_range(t_issue + pd.Timedelta(minutes=15), periods=horizon_steps, freq="15min")
    if hz[-1].date() != t_issue.date():
        raise ApiError("BAD_T0", "forecast horizon must stay within the scenario day")

    obs = observed_frame(cfg)
    frame = make_frame(obs[(obs["timestamp"] >= t_issue - pd.Timedelta(days=1, hours=2)) & (obs["timestamp"] <= t_issue)],
                       range(1, horizon_steps + 1))
    rows = frame[frame["issue"] == t_issue].sort_values("h")
    if len(rows) != horizon_steps or rows[["g_lag1", "g_day"]].isna().any().any():
        raise ApiError("INSUFFICIENT_HISTORY", "need the previous day and last hour of data before t0",
                       details={"t0": t0, "date": cfg.date})
    qm = _model_excluding(ds_id, cfg.date) if model == "hgb" else None
    fc = predict(model, rows, qm)
    fc = {k: np.clip(v, 0.0, 1.05) for k, v in fc.items()}

    start, end = hz[0].strftime("%H:%M"), hz[-1].strftime("%H:%M")
    cfg_actual = cfg.model_copy(update={"start": start, "end": end, "gen_pu_override": None, "gen_label": None})
    actual_inp = build_inputs(cfg_actual)

    def fc_cfg(q: str) -> ScenarioConfig:
        return cfg.model_copy(update={
            "start": start, "end": end, "cloud_event": None,
            "gen_pu_override": [float(x) for x in fc[q]], "gen_label": f"FORECAST ({model}, {q.upper()})",
            "demand_scale": cfg.demand_scale * (1.0 + demand_error_pct / 100.0),
            "name": f"{cfg.name} — forecast {q.upper()}",
        })

    predicted = {q: run_qsts(build_inputs(fc_cfg(q))) for q in ("p50", "p90")}
    plan_cfg = fc_cfg(plan_on)
    ev = evaluate(plan_cfg)
    entry = cached_entry(config_key(plan_cfg))
    if ev["status"] == "NO_ACTION_NEEDED":
        plan_key = "none"
    elif ev["recommended"]:
        plan_key = ev["recommended"]
    else:
        plan_key = "all_levers" if "all_levers" in entry["results"] else "none"
    plan_res = entry["results"][plan_key]
    plan = {
        "candidate": plan_key,
        "planning_status": ev["status"],
        "switch_states": plan_res.switch_states,
        "battery_p_mw": [r.battery_p_mw for r in plan_res.records],
        "curtail_pct": [r.curtail_pct for r in plan_res.records],
        "pv_q_mvar": [r.pv_q_mvar for r in plan_res.records],
        "explanation": ev["explanation"],
    }

    apply_switch_states(actual_inp.net, plan_res.switch_states)
    lever = ScheduleLever(plan["battery_p_mw"], [c / 100.0 for c in plan["curtail_pct"]], [r.pv_q_each for r in plan_res.records])
    replay = run_qsts(actual_inp, [lever])
    actual_baseline = run_qsts(build_inputs(cfg_actual))
    failing = [r.label for r in replay.records if r.status != "SAFE"]
    outcome = "PLAN_HELD" if not failing else "PLAN_FAILED_ON_ACTUALS"

    hist = obs[(obs["timestamp"] > t_issue - pd.Timedelta(minutes=15 * HISTORY_STEPS)) & (obs["timestamp"] <= t_issue)]
    labels = [t.strftime("%H:%M") for t in hz]
    first_fail = next((r for r in replay.records if r.status != "SAFE"), None)
    why = None
    if first_fail is not None:
        k = first_fail.k
        worst = max((v for v in first_fail.violations if v["hard"]),
                    key=lambda v: abs((v["value"] or 0) - (v["limit"] or 0)), default=None)
        left = "a violation"
        if worst is not None:
            left = f"{worst['type']} at {worst['name']}"
            if worst["value"] is not None:
                left += f" = {worst['value']:.3f} (limit {worst['limit']:.3f})"
        why = (f"At {first_fail.label} actual PV was {actual_inp.generation_pu[k]:.3f} pu vs forecast {plan_on.upper()} "
               f"{fc[plan_on][k]:.3f} pu; the frozen plan ({plan_key}) left {left}.")
    return {
        "t0": t0, "horizon_labels": labels, "model": model, "plan_on": plan_on, "dataset_id": ds_id,
        "demand_forecast": f"synthetic schedule x {1 + demand_error_pct / 100:.2f} (injected error {demand_error_pct:+.1f}%) — not ML",
        "forecast": {"p10": fc["p10"].round(4).tolist(), "p50": fc["p50"].round(4).tolist(), "p90": fc["p90"].round(4).tolist()},
        "actual_pu": actual_inp.generation_pu.round(4).tolist(),
        "history": {"labels": [t.strftime("%H:%M") for t in hist["timestamp"]], "pu": hist["generation_pu"].round(4).tolist()},
        "predicted": {q: _viol_summary(r) | {"metrics": compute_metrics(r)} for q, r in predicted.items()},
        "plan": plan,
        "replay": _viol_summary(replay) | {"metrics": compute_metrics(replay), "outcome": outcome, "failing_steps": failing,
                                           "steps": [{"label": r.label, "status": r.status, "max_v": r.max_v, "max_line": r.max_line,
                                                      "battery_p_mw": r.battery_p_mw, "curtail_pct": r.curtail_pct} for r in replay.records]},
        "actual_without_plan": _viol_summary(actual_baseline),
        "outcome": outcome,
        "why": why,
        "honesty": actual_inp.honesty | {"forecast": f"FORECAST ({model}) — model output, not measurement"},
        "model_training": "leave-one-day-out: trained on all dataset days except the scenario date" if model == "hgb" else "baseline (no training)",
    }
