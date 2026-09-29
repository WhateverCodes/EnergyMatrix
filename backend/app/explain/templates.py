"""Deterministic explanations built only from result fields. No number appears here that is not in
the evaluation result."""
from __future__ import annotations


def _f(x, nd=3, unit=""):
    if x is None:
        return "n/a"
    return f"{x:.{nd}f}{unit}"


def candidate_line(c: dict, baseline: dict) -> str:
    if not c.get("available", True):
        return f"{c['name']}: not evaluated — {c.get('unavailable_reason')}."
    m, b = c["metrics"], baseline["metrics"]
    if c["key"] == "none":
        return (f"Baseline: max V {_f(m['max_v'])} pu, min V {_f(m['min_v'])} pu, peak line {_f(m['max_line_pct'], 1)}%, "
                f"{m['n_violation_steps']} of {m['n_steps']} steps violate limits.")
    if c["feasible"]:
        return (f"{c['name']}: feasible at all {m['n_steps']} steps — max V {_f(b['max_v'])}→{_f(m['max_v'])} pu, "
                f"peak line {_f(b['max_line_pct'], 1)}→{_f(m['max_line_pct'], 1)}%, curtailed {_f(m['curtailed_mwh'], 2)} MWh, "
                f"battery {_f(m['battery_throughput_mwh'], 2)} MWh, J = {_f(c['J'], 2)}.")
    f = c.get("failure") or {}
    bc = f.get("binding_constraint") or {}
    why = "; ".join(f.get("why", [])[:2])
    bind = (f"{bc.get('type')} at {bc.get('name')} ({_f(bc.get('value'), 3)} vs limit {_f(bc.get('limit'), 3)})"
            if bc.get("value") == bc.get("value") and bc else (bc.get("type") or "constraint"))
    return (f"{c['name']}: infeasible — {m['n_violation_steps']} of {m['n_steps']} steps still violate, first at "
            f"{f.get('first_failing_step')}: {bind}" + (f". {why}." if why else "."))


def overall(status: str, baseline: dict, rec: dict | None, ordered: list[dict], infeas: dict | None, constraints) -> str:
    b = baseline["metrics"]
    if status == "NO_ACTION_NEEDED":
        return (f"The baseline stays within every limit over all {b['n_steps']} steps (max V {_f(b['max_v'])} pu, "
                f"min V {_f(b['min_v'])} pu, peak line loading {_f(b['max_line_pct'], 1)}%, transformer "
                f"{_f(b['max_trafo_pct'], 1)}%). No corrective action is needed; all available PV is used.")
    if rec is not None:
        m = rec["metrics"]
        n_feas = sum(1 for c in ordered if c["feasible"] and c["key"] != "none")
        curt = (f"{_f(m['curtailed_mwh'], 2)} MWh curtailed ({_f(m['curtailed_pct'], 1)}% of available PV)"
                if m["curtailed_mwh"] > 0 else "no curtailment")
        extra = []
        if m["battery_throughput_mwh"] > 0:
            extra.append(f"{_f(m['battery_throughput_mwh'], 2)} MWh battery throughput (SOC peak {_f(m['soc_max_pct'], 1)}%)")
        if m["switch_ops"]:
            extra.append(f"{m['switch_ops']} switch operations")
        if m["reactive_mvarh"] > 0:
            extra.append(f"{_f(m['reactive_mvarh'], 2)} MVArh reactive support")
        return (f"{rec['name']} was selected: max voltage {_f(b['max_v'])} → {_f(m['max_v'])} pu, peak line loading "
                f"{_f(b['max_line_pct'], 1)}% → {_f(m['max_line_pct'], 1)}%, with {curt}"
                + (", " + ", ".join(extra) if extra else "")
                + f" (J = {_f(rec['J'], 2)}, lowest of {n_feas} feasible option{'s' if n_feas != 1 else ''}). "
                f"Renewable utilization {_f(m['renewable_utilization_pct'], 1)}%.")
    mi = (infeas or {}).get("minimum_intervention", {})
    evaluated = [c for c in ordered if c["key"] != "none" and c.get("available")]
    closest = min(evaluated, key=lambda c: c["metrics"]["n_violation_steps"]) if evaluated else None
    parts = [f"NO FEASIBLE SOLUTION UNDER CURRENT CONSTRAINTS: all {len(evaluated)} available candidates were simulated "
             f"over every step and each still violates limits."]
    if closest:
        cm = closest["metrics"]
        parts.append(f"Closest: {closest['name']} with {cm['n_violation_steps']} of {cm['n_steps']} steps violating.")
    if mi.get("required_curtailment_pct") is not None:
        parts.append(f"Minimum intervention outside limits: {_f(mi['required_curtailment_pct'], 1)}% curtailment at "
                     f"{mi.get('required_curtailment_step')} versus the {_f(mi.get('cap_pct'), 0)}% cap (reported, not applied).")
    lr = mi.get("load_reduction")
    if lr and lr.get("mw") is not None:
        parts.append(f"Minimum load reduction outside limits: {_f(lr['mw'], 3)} MW of {lr['scope']} at {lr['step']} "
                     f"(reported, not applied); curtailment does not help an undervoltage.")
    return " ".join(parts)
