"""Independent evaluation of every corrective-action candidate.

For each candidate: copy baseline inputs (deep-copied net) -> action.setup -> full QSTS with the
action's levers -> constraint check at every step -> metrics -> feasibility -> penalty J.
The cached template network is never mutated (asserted in tests).
"""
from __future__ import annotations

import atexit
import copy
import dataclasses
import hashlib
import json
import os
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor

from app.config import ObjectiveWeights
from app.explain import templates
from app.optimization import infeasibility
from app.optimization.actions.base import Action
from app.optimization.actions.combined import all_candidates
from app.optimization.objective import rank
from app.schemas.scenario import ScenarioConfig
from app.simulation.mapping import ScenarioInputs, build_inputs
from app.simulation.metrics import compute_metrics
from app.simulation.qsts import QSTSResult, run_qsts

HARD_ORDER = ["NON_CONVERGENCE", "ISLANDED_BUS", "OVERVOLTAGE", "UNDERVOLTAGE", "LINE_OVERLOAD", "TRAFO_OVERLOAD", "REVERSE_FLOW"]

_CACHE: "OrderedDict[str, dict]" = OrderedDict()
_CACHE_MAX = 24

# Candidates are independent simulations, so they run in a persistent process pool.
# GRIDTWIN_WORKERS=1 forces sequential evaluation (identical results, deterministic either way).
_POOL: ProcessPoolExecutor | None = None


def _workers() -> int:
    return max(1, int(os.environ.get("GRIDTWIN_WORKERS", str(min(8, os.cpu_count() or 1)))))


def _pool() -> ProcessPoolExecutor | None:
    global _POOL
    if _workers() <= 1:
        return None
    if _POOL is None:
        _POOL = ProcessPoolExecutor(max_workers=_workers())
        atexit.register(_POOL.shutdown, wait=False, cancel_futures=True)
    return _POOL


def _warm() -> int:
    """Import pandapower and JIT-compile the solver inside a worker."""
    from app.simulation.network_factory import new_net
    from app.simulation.powerflow import run_pf
    run_pf(new_net())
    return os.getpid()


def warm_pool() -> None:
    """Spawn workers and pay the import/JIT cost up front (called at API startup)."""
    pool = _pool()
    if pool is not None:
        list(pool.map(_warm, range(_workers())))
    else:
        _warm()


def _simulate_in_worker(cfg_json: str, key: str):
    cfg = ScenarioConfig.model_validate_json(cfg_json)
    inp = build_inputs(cfg)
    action = next(a for a in all_candidates() if a.key == key)
    cand, res, _ = simulate_candidate(inp, action)
    return cand, res


def clone_inputs(inp: ScenarioInputs) -> ScenarioInputs:
    return dataclasses.replace(inp, net=copy.deepcopy(inp.net))


def config_key(cfg: ScenarioConfig) -> str:
    d = cfg.model_dump(exclude={"weights", "name"})
    return hashlib.sha1(json.dumps(d, sort_keys=True, default=str).encode()).hexdigest()[:16]


def binding_violation(rec) -> dict | None:
    hard = [v for v in rec.violations if v["hard"]]
    if not hard:
        return None

    def score(v):
        if v["type"] in ("NON_CONVERGENCE", "ISLANDED_BUS"):
            return 1e9
        if v["type"] in ("OVERVOLTAGE", "UNDERVOLTAGE"):
            return abs(v["value"] - v["limit"]) * 100
        return abs(v["value"] - v["limit"]) / 10
    return max(hard, key=score)


def failure_analysis(res: QSTSResult, inp: ScenarioInputs) -> dict:
    first = res.first_failing_step()
    if first is None:
        return {}
    b = binding_violation(first)
    why: list[str] = []
    for r in res.records:
        for n in r.notes:
            if n not in why:
                why.append(n)
    if inp.battery is not None:
        smax = 100 * inp.battery.soc_max
        sat = next((r for r in res.records if r.soc_pct is not None and r.soc_pct >= smax - 1e-3), None)
        if sat is not None:
            why.insert(0, f"battery SOC reached {smax:.0f}% at {sat.label}")
    failing = [r.label for r in res.records if r.status != "SAFE"]
    return {
        "first_failing_step": first.label,
        "failing_steps": failing,
        "binding_constraint": None if b is None else {
            "type": b["type"], "element": b["element"], "id": b["id"], "name": b["name"],
            "value": b["value"], "limit": b["limit"]},
        "why": _condense(why),
    }


def _condense(notes: list[str], limit: int = 6) -> list[str]:
    """Collapse per-step notes like '... at 11:45' into one line per note kind with its step range."""
    groups: "OrderedDict[str, list[str]]" = OrderedDict()
    for n in notes:
        if " at " in n and n.rsplit(" at ", 1)[1][:2].isdigit():
            head, tail = n.rsplit(" at ", 1)
            step = tail.split(",")[0].split(" ")[0]
            rest = tail[len(step):]
            groups.setdefault(head + "{}" + rest, []).append(step)
        else:
            groups.setdefault(n, [])
    out = []
    for pattern, steps in groups.items():
        if steps:
            span = steps[0] if len(steps) == 1 else f"{steps[0]}–{steps[-1]} ({len(steps)} steps)"
            out.append(pattern.format(" at " + span) if "{}" in pattern else pattern)
        else:
            out.append(pattern)
    return out[:limit]


def simulate_candidate(inp: ScenarioInputs, action: Action) -> tuple[dict, QSTSResult | None, ScenarioInputs | None]:
    ok, why = action.available(inp)
    base = {"key": action.key, "name": action.name, "available": ok}
    if not ok:
        base.update({"feasible": False, "unavailable_reason": why, "metrics": None, "status": "UNAVAILABLE"})
        return base, None, None
    work = clone_inputs(inp)
    effect = action.setup(work)
    res = run_qsts(work, action.step_levers(work))
    m = compute_metrics(res, switch_ops=effect.params.get("switch_ops", 0))
    feasible = res.summary["status"] == "SAFE"
    worst = max((abs(v["value"] - v["limit"]) for v in res.summary["violations"]
                 if v["hard"] and isinstance(v["value"], float) and v["value"] == v["value"]), default=0.0)
    base.update({
        "feasible": feasible,
        "status": "FEASIBLE" if feasible else res.summary["status"],
        "metrics": m,
        "worst_excess": round(worst, 5),
        "params": {k: v for k, v in effect.params.items() if k != "configs"},
        "switching_detail": effect.params.get("configs"),
        "notes": effect.notes,
        "violations": res.summary["violations"],
        "failure": None if feasible else failure_analysis(res, work),
    })
    return base, res, work


def evaluate(cfg: ScenarioConfig, weights: ObjectiveWeights | None = None, use_cache: bool = True) -> dict:
    w = weights or cfg.weights
    key = config_key(cfg)
    if use_cache and key in _CACHE:
        cached = _CACHE[key]
        _CACHE.move_to_end(key)
        return _finalize(cached, w)

    inp = build_inputs(cfg)
    results: dict[str, QSTSResult] = {}
    candidates: list[dict] = []
    baseline, bres, _ = simulate_candidate(inp, all_candidates()[0])
    results["none"] = bres
    candidates.append(baseline)
    if not baseline["feasible"]:
        actions = all_candidates()[1:]
        pool = _pool()
        if pool is not None:
            cfg_json = cfg.model_dump_json()
            futures = [pool.submit(_simulate_in_worker, cfg_json, a.key) for a in actions]
            outs = [f.result() for f in futures]
        else:
            outs = [simulate_candidate(inp, a)[:2] for a in actions]
        for action, (cand, res) in zip(actions, outs):
            candidates.append(cand)
            if res is not None:
                results[action.key] = res
    entry = {"key": key, "config": cfg, "inputs": inp, "candidates": candidates, "results": results}
    entry["infeasibility"] = None
    if not baseline["feasible"] and not any(c["feasible"] for c in candidates if c["key"] != "none"):
        entry["infeasibility"] = infeasibility.report(inp, candidates, results)
    _CACHE[key] = entry
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return _finalize(entry, w)


def _finalize(entry: dict, w: ObjectiveWeights) -> dict:
    cands = [dict(c) for c in entry["candidates"]]
    baseline = next(c for c in cands if c["key"] == "none")
    ordered = rank(cands, w)
    if baseline["feasible"]:
        status, rec = "NO_ACTION_NEEDED", None
    else:
        feas = [c for c in ordered if c["feasible"] and c["key"] != "none"]
        rec = feas[0] if feas else None
        status = "FEASIBLE" if rec else "NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS"
    for c in ordered:
        c["recommended"] = rec is not None and c["key"] == rec["key"]
        c["explanation"] = templates.candidate_line(c, baseline)
    explanation = templates.overall(status, baseline, rec, ordered, entry["infeasibility"], entry["config"].constraints)
    return {
        "evaluation_id": entry["key"],
        "status": status,
        "recommended": None if rec is None else rec["key"],
        "baseline_status": baseline["status"],
        "candidates": ordered,
        "infeasibility": entry["infeasibility"],
        "explanation": explanation,
        "weights": w.model_dump(),
        "constraints": entry["config"].constraints.model_dump(),
        "honesty": entry["inputs"].honesty,
    }


def cached_entry(evaluation_id: str) -> dict | None:
    return _CACHE.get(evaluation_id)
