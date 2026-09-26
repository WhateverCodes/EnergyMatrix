"""'Why each failed' + minimum required intervention OUTSIDE current limits (reported, never applied).

- Surplus problems (overvoltage / export overload): required curtailment %, from the curtailment
  lever's bisection over [0, 100 %] (standalone and residual after all other levers).
- Deficit problems (undervoltage / import overload): required load reduction in MW, by bisection on a
  uniform reduction of the feeder loads (the aggregated substation loads at buses 1 and 12 are
  included only if feeder loads alone cannot fix the step). Computed on the baseline network.
"""
from __future__ import annotations

import copy

import numpy as np

from app.optimization.actions.base import bisect_min
from app.simulation.constraints import NetMeta, check_step, hard_violations
from app.simulation.mapping import ScenarioInputs
from app.simulation.powerflow import PowerFlowRunner
from app.simulation.qsts import QSTSResult

SURPLUS_TYPES = {"OVERVOLTAGE", "REVERSE_FLOW"}
DEFICIT_TYPES = {"UNDERVOLTAGE"}


def _problem_kind(baseline_res: QSTSResult) -> str:
    kinds = set()
    for r in baseline_res.records:
        for v in r.violations:
            if not v["hard"]:
                continue
            if v["type"] in SURPLUS_TYPES:
                kinds.add("surplus")
            elif v["type"] in DEFICIT_TYPES:
                kinds.add("deficit")
            elif v["type"] in ("LINE_OVERLOAD", "TRAFO_OVERLOAD"):
                exporting = r.line_p_from and min(r.line_p_from[k] for k in baseline_res.head_line_pos) < 0
                kinds.add("surplus" if exporting else "deficit")
    if kinds == {"surplus"}:
        return "surplus"
    if kinds == {"deficit"}:
        return "deficit"
    return "mixed" if kinds else "none"


def required_load_reduction(inp: ScenarioInputs, res: QSTSResult) -> dict:
    net = copy.deepcopy(inp.net)
    meta = NetMeta.from_net(net)
    runner = PowerFlowRunner(net)
    c = inp.config.constraints
    feeder = ~np.isin(net.load.loc[inp.load_idx, "bus"].to_numpy(), [1, 12])
    worst = {"mw": 0.0, "step": None, "scope": None}
    for r in res.records:
        if r.status == "SAFE":
            continue
        k = r.k
        net.sgen.loc[inp.pv_idx, "p_mw"] = inp.pv_avail[k]
        net.sgen.loc[inp.pv_idx, "q_mvar"] = 0.0
        if inp.battery is not None:
            net.storage.at[inp.battery.storage_idx, "p_mw"] = 0.0
        for scope, mask in (("feeder loads", feeder), ("all loads incl. substation aggregate", np.ones_like(feeder))):
            def ok(f: float, mask=mask) -> bool:
                p = inp.load_p[k] * np.where(mask, 1.0 - f, 1.0)
                net.load.loc[inp.load_idx, "p_mw"] = p
                net.load.loc[inp.load_idx, "q_mvar"] = inp.load_q[k] * np.where(mask, 1.0 - f, 1.0)
                return not hard_violations(check_step(runner.run(), meta, c))
            f = bisect_min(0.0, 1.0, ok)
            if f is not None:
                mw = float((inp.load_p[k] * mask).sum() * f)
                if mw > worst["mw"]:
                    worst = {"mw": round(mw, 4), "fraction_pct": round(100 * f, 2), "step": r.label, "scope": scope}
                break
        else:
            worst = {"mw": None, "step": r.label, "scope": "not fixable by load reduction alone"}
            break
    return worst


def report(inp: ScenarioInputs, candidates: list[dict], results: dict[str, QSTSResult]) -> dict:
    cap = inp.config.constraints.max_curtailment_pct
    kind = _problem_kind(results["none"])
    per_candidate = []
    for c in candidates:
        if c["key"] == "none":
            continue
        if not c["available"]:
            per_candidate.append({"key": c["key"], "name": c["name"], "available": False, "why": [c["unavailable_reason"]]})
            continue
        f = c.get("failure") or {}
        per_candidate.append({"key": c["key"], "name": c["name"], "available": True,
                              "first_failing_step": f.get("first_failing_step"),
                              "n_failing_steps": len(f.get("failing_steps", [])),
                              "binding_constraint": f.get("binding_constraint"), "why": f.get("why", [])})
    minimum: dict = {"problem_kind": kind, "applied": False,
                     "note": "Reported only — interventions outside the configured limits are never applied."}
    if kind in ("surplus", "mixed"):
        out = {}
        for key in ("curtailment", "all_levers", "battery_curtail"):
            c = next((x for x in candidates if x["key"] == key and x.get("metrics")), None)
            if c and c["metrics"].get("max_required_curtail_pct") is not None:
                req = c["metrics"]["max_required_curtail_pct"]
                step = next((r.label for r in results[key].records if r.required_curtail_pct == req), None)
                out[key] = {"required_pct": req, "step": step, "cap_pct": cap, "fixable": req < 100.0}
        minimum["curtailment"] = out
        if out:
            best_key = min(out, key=lambda k: out[k]["required_pct"])
            minimum["required_curtailment_pct"] = out[best_key]["required_pct"]
            minimum["required_curtailment_step"] = out[best_key]["step"]
            minimum["required_curtailment_with"] = best_key
            minimum["cap_pct"] = cap
    if kind in ("deficit", "mixed"):
        minimum["load_reduction"] = required_load_reduction(inp, results["none"])
        minimum["curtailment_applicable"] = kind == "mixed"
    return {"status": "NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS", "candidates": per_candidate, "minimum_intervention": minimum}
