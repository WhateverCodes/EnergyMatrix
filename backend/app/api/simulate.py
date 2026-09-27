"""Simulation, corrective actions, hosting capacity, and saved-scenario history."""
from __future__ import annotations

import dataclasses
import logging
import time

import numpy as np
from fastapi import APIRouter

from app.api.serialize import clean, qsts_payload
from app.db.models import ActionEvaluationRow, SavedScenarioRow, ScenarioRow, SimulationRunRow, session
from app.errors import ApiError
from app.optimization.actions.battery import BatteryLever
from app.optimization.actions.curtailment import CurtailmentLever
from app.optimization.evaluator import cached_entry, clone_inputs, config_key, evaluate
from app.schemas.requests import ApplyRequest, EvaluateRequest, SaveScenarioRequest, SnapshotRequest
from app.schemas.scenario import ScenarioConfig
from app.simulation.hosting_capacity import hosting_capacity
from app.simulation.mapping import build_inputs, generation_profile, scenario_summary, window_timestamps
from app.simulation.metrics import compute_metrics
from app.simulation.network_factory import network_summary
from app.simulation.qsts import run_qsts

log = logging.getLogger("gridtwin.api")
router = APIRouter(prefix="/api")

SNAPSHOT_LATENCIES_MS: list[float] = []


def _baseline(cfg: ScenarioConfig) -> dict:
    inp = build_inputs(cfg)
    res = run_qsts(clone_inputs(inp))
    m = compute_metrics(res)
    out = qsts_payload(res, m)
    out["scenario"] = clean(scenario_summary(inp))
    out["honesty"] = inp.honesty
    out["battery"] = None if inp.battery is None else clean(dataclasses.asdict(inp.battery))
    out["config_key"] = config_key(cfg)
    return out


@router.post("/simulate/run")
def simulate_run(cfg: ScenarioConfig) -> dict:
    out = _baseline(cfg)
    with session() as s:
        s.add(ScenarioRow(config_key=out["config_key"], name=cfg.name, config=cfg.model_dump()))
        row = SimulationRunRow(config_key=out["config_key"], status=out["status"], metrics=out["metrics"],
                               summary=out["summary"])
        s.add(row)
        s.commit()
        out["run_id"] = row.id
    out["network"] = clean(network_summary())
    return out


@router.post("/simulate/snapshot")
def simulate_snapshot(req: SnapshotRequest) -> dict:
    t0 = time.perf_counter()
    cfg = req.config.model_copy(deep=True)
    cfg.pv_scale = cfg.pv_scale * req.pv_pct / 100.0
    cfg.demand_scale = cfg.demand_scale * req.demand_pct / 100.0
    if req.consumer_scale is not None:
        cfg.consumer_scale = req.consumer_scale
    if req.battery_available is not None:
        cfg.battery.enabled = req.battery_available
    if req.soc_pct is not None:
        cfg.battery.soc_init_pct = min(max(req.soc_pct, cfg.battery.soc_min_pct), cfg.battery.soc_max_pct)
    if req.curtailment_cap_pct is not None:
        cfg.constraints.max_curtailment_pct = req.curtailment_cap_pct
    if req.v_max is not None:
        cfg.constraints.v_max = req.v_max
    ts = window_timestamps(cfg.date, cfg.start, cfg.end)
    labels = [x.strftime("%H:%M") for x in ts]
    if req.time is None:
        gen_pu, _ = generation_profile(cfg, ts)  # default step = max-PV step of the window
        t = labels[int(np.argmax(gen_pu))]
    elif req.time in labels:
        t = req.time
    else:
        raise ApiError("BAD_TIME", f"time {req.time} is not a step of the window", details={"steps": labels})
    inp = build_inputs(cfg.model_copy(update={"start": t, "end": t}))  # private net copy
    base = run_qsts(inp)
    rec = base.records[0]
    m = compute_metrics(base)
    preview = None
    if req.include_preview and rec.status != "SAFE":
        # Single-step heal preview (battery first, curtail residual) — the full evaluation verifies the window.
        # run_qsts resets every injection at the start of the step, so the same private net can be reused.
        heal = run_qsts(inp, [BatteryLever(), CurtailmentLever()])
        h = heal.records[0]
        preview = {
            "status": h.status, "battery_p_mw": h.battery_p_mw, "curtail_pct": h.curtail_pct,
            "required_curtail_pct": h.required_curtail_pct, "max_v": h.max_v, "max_line": h.max_line,
            "notes": h.notes, "label": "single-step preview (battery then capped curtailment) — run full evaluation to verify the window",
        }
    elapsed = (time.perf_counter() - t0) * 1000.0
    if not req.include_preview:
        SNAPSHOT_LATENCIES_MS.append(elapsed)  # slider path latency (target < 150 ms)
    log.info("snapshot %.1f ms (status %s)", elapsed, rec.status)
    head = [rec.line_p_from[k] for k in base.head_line_pos] if rec.line_p_from else []
    return clean({
        "time": t, "steps": labels, "status": rec.status, "step": dataclasses.asdict(rec),
        "kpis": {
            "max_v": rec.max_v, "min_v": rec.min_v, "max_line_pct": rec.max_line, "max_trafo_pct": rec.max_trafo,
            "losses_mw": rec.losses_mw, "losses_pct": m["losses_pct"], "pv_available_mw": rec.pv_avail_mw,
            "pv_dispatched_mw": rec.pv_dispatched_mw, "renewable_utilization_pct": m["renewable_utilization_pct"],
            "curtailed_mw": rec.curtailed_mw, "import_mw": max(rec.ext_grid_p or 0.0, 0.0),
            "export_mw": max(-(rec.ext_grid_p or 0.0), 0.0),
            "feeder_reverse_flow_mw": max([0.0] + [-p for p in head]),
            "load_mw": rec.load_mw,
        },
        "violations": [v for v in rec.violations if v["hard"] or v["severity"] in ("WARNING", "INFO")],
        "preview": preview,
        "honesty": inp.honesty,
        "latency_ms": round(elapsed, 1),
    })


@router.get("/simulate/latency")
def snapshot_latency() -> dict:
    xs = sorted(SNAPSHOT_LATENCIES_MS)
    if not xs:
        return {"n": 0}
    return {"n": len(xs), "p50_ms": round(xs[len(xs) // 2], 1), "p95_ms": round(xs[int(0.95 * (len(xs) - 1))], 1),
            "max_ms": round(xs[-1], 1)}


@router.post("/actions/evaluate")
def actions_evaluate(req: EvaluateRequest) -> dict:
    out = clean(evaluate(req.config, req.weights))
    with session() as s:
        s.add(ActionEvaluationRow(evaluation_id=out["evaluation_id"], status=out["status"], recommended=out["recommended"],
                                  candidates=[{k: c.get(k) for k in ("key", "feasible", "J", "rank")} for c in out["candidates"]]))
        s.commit()
    return out


@router.post("/actions/apply")
def actions_apply(req: ApplyRequest) -> dict:
    key = config_key(req.config)
    if cached_entry(key) is None:
        evaluate(req.config)
    entry = cached_entry(key)
    res = entry["results"].get(req.candidate_key)
    cand = next((c for c in entry["candidates"] if c["key"] == req.candidate_key), None)
    if cand is None:
        raise ApiError("UNKNOWN_CANDIDATE", f"No candidate '{req.candidate_key}'", 404,
                       {"available": [c["key"] for c in entry["candidates"]]})
    if res is None:
        raise ApiError("CANDIDATE_NOT_SIMULATED", f"Candidate '{req.candidate_key}' was not simulated: "
                       f"{cand.get('unavailable_reason') or 'baseline already safe'}", 409)
    base = entry["results"]["none"]
    bm = compute_metrics(base)
    am = cand["metrics"]
    deltas = {k: (None if bm.get(k) is None or am.get(k) is None else round(am[k] - bm[k], 5))
              for k in ("max_v", "min_v", "max_line_pct", "max_trafo_pct", "losses_mwh", "curtailed_mwh",
                        "renewable_utilization_pct", "n_violation_steps", "peak_feeder_reverse_flow_mw")}
    return clean({
        "candidate": cand, "before": qsts_payload(base, bm), "after": qsts_payload(res, am), "deltas": deltas,
        "verified": cand["feasible"],
        "verification": ("re-simulated over all steps: every step within limits" if cand["feasible"]
                         else "re-simulated over all steps: violations remain (see failure analysis)"),
    })


@router.post("/hosting-capacity")
def post_hosting(cfg: ScenarioConfig) -> dict:
    return clean(hosting_capacity(cfg))


@router.get("/hosting-capacity")
def get_hosting(network: str = "cigre_mv", date: str = "2020-05-25", start: str = "10:00", end: str = "15:00",
                pv_multiplier: float = 20.0) -> dict:
    if network != "cigre_mv":
        raise ApiError("NETWORK_NOT_FOUND", f"Unknown network '{network}'", 404)
    return clean(hosting_capacity(ScenarioConfig(date=date, start=start, end=end, pv_multiplier=pv_multiplier)))


def _saved_dict(r: SavedScenarioRow, full: bool = False) -> dict:
    d = {"id": r.id, "name": r.name, "labels": r.labels, "selected_intervention": r.selected_intervention,
         "feasibility": r.feasibility, "created_at": r.created_at.isoformat(timespec="seconds"),
         "baseline_metrics": (r.baseline_result or {}).get("metrics"),
         "final_metrics": (r.final_result or {}).get("metrics") if r.final_result else None}
    if full:
        d.update({"config": r.config, "baseline_result": r.baseline_result, "final_result": r.final_result})
    return d


@router.post("/history")
def save_scenario(req: SaveScenarioRequest) -> dict:
    ev = evaluate(req.config)
    key = config_key(req.config)
    entry = cached_entry(key)
    base_res = entry["results"]["none"]
    baseline = {"status": base_res.summary["status"], "metrics": compute_metrics(base_res),
                "violations": base_res.summary["violations"]}
    chosen = req.selected_intervention or ev["recommended"]
    final = None
    if chosen and chosen in entry["results"]:
        cand = next(c for c in ev["candidates"] if c["key"] == chosen)
        final = {"candidate": chosen, "feasible": cand["feasible"], "metrics": cand["metrics"],
                 "explanation": cand.get("explanation")}
    feas = ev["status"]
    with session() as s:
        row = SavedScenarioRow(name=req.name, labels=clean(entry["inputs"].honesty), config=req.config.model_dump(),
                               baseline_result=clean(baseline), selected_intervention=chosen,
                               final_result=clean(final) if final else None, feasibility=feas)
        s.add(row)
        s.commit()
        return clean(_saved_dict(row, full=True) | {"explanation": ev["explanation"], "infeasibility": ev["infeasibility"]})


@router.get("/history")
def list_history() -> list[dict]:
    with session() as s:
        rows = s.query(SavedScenarioRow).order_by(SavedScenarioRow.id.desc()).all()
        return clean([_saved_dict(r) for r in rows])


@router.get("/history/compare")
def compare_history(a: int, b: int) -> dict:
    with session() as s:
        ra, rb = s.get(SavedScenarioRow, a), s.get(SavedScenarioRow, b)
        if ra is None or rb is None:
            raise ApiError("NOT_FOUND", "Saved scenario not found", 404, {"a": ra is not None, "b": rb is not None})
        da, db = _saved_dict(ra, True), _saved_dict(rb, True)
    keys = ["max_v", "min_v", "max_line_pct", "max_trafo_pct", "curtailed_mwh", "renewable_utilization_pct",
            "battery_throughput_mwh", "losses_mwh", "n_violation_steps"]

    def pick(d):
        return (d.get("final_metrics") or d.get("baseline_metrics") or {})
    rows = [{"metric": k, "a": pick(da).get(k), "b": pick(db).get(k)} for k in keys]
    return clean({"a": da, "b": db, "rows": rows})


@router.get("/history/{saved_id}")
def get_history(saved_id: int) -> dict:
    with session() as s:
        r = s.get(SavedScenarioRow, saved_id)
        if r is None:
            raise ApiError("NOT_FOUND", f"Saved scenario {saved_id} not found", 404)
        return clean(_saved_dict(r, full=True))
