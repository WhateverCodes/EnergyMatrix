"""Lexicographic objective (docs/optimization.md).

1. Feasibility first: every step converges and satisfies all hard constraints.
2. Among feasible candidates minimise
     J = w_curt*E_curtailed_MWh + w_batt*E_battery_throughput_MWh + w_sw*N_switch_ops
         + w_loss*E_losses_MWh + w_q*E_reactive_MVArh
3. Infeasible candidates are ranked after all feasible ones by (violation steps, worst excess).
"""
from __future__ import annotations

from app.config import ObjectiveWeights


def penalty(metrics: dict, w: ObjectiveWeights) -> dict:
    terms = {
        "curtailment": w.w_curt * metrics["curtailed_mwh"],
        "battery": w.w_batt * metrics["battery_throughput_mwh"],
        "switching": w.w_sw * metrics["switch_ops"],
        "losses": w.w_loss * metrics["losses_mwh"],
        "reactive": w.w_q * metrics["reactive_mvarh"],
    }
    terms = {k: round(v, 5) for k, v in terms.items()}
    return {"J": round(sum(terms.values()), 5), "breakdown": terms}


def rank(candidates: list[dict], w: ObjectiveWeights) -> list[dict]:
    """Recompute J with the given weights and sort. Works on stored metrics (no re-simulation)."""
    for c in candidates:
        if c.get("available", True) and c.get("metrics"):
            p = penalty(c["metrics"], w)
            c["J"], c["penalty_breakdown"] = p["J"], p["breakdown"]
        else:
            c["J"], c["penalty_breakdown"] = None, None

    def key(c: dict):
        if not c.get("available", True):
            return (3, 0, 0.0)
        if c["feasible"]:
            return (0, 0, c["J"])
        return (1, c["metrics"]["n_violation_steps"], c.get("worst_excess") or 0.0)

    ordered = sorted(candidates, key=key)
    for i, c in enumerate(ordered):
        c["rank"] = i + 1
    return ordered
