"""A2 — Feeder reconfiguration. One switch configuration for the whole window.

All 2^7 combinations of the switchable switches are enumerated. Configs that island a bus or
create a loop (meshed) are rejected with that reason. Each remaining radial config is screened
with real power flows at the baseline's violated steps (up to the 4 worst); the config with the
most screened steps safe, then least residual excess, then fewest switch operations wins.
The evaluator then runs the full QSTS on the chosen config.
"""
from __future__ import annotations

import numpy as np

from app.config import Constraints
from app.optimization.actions.base import Action, ActionEffect
from app.simulation.constraints import NetMeta, check_step, excess, hard_violations
from app.simulation.mapping import ScenarioInputs
from app.simulation.powerflow import PowerFlowRunner
from app.simulation.topology import apply_switch_states, current_states, enumerate_configs

MAX_SCREEN_STEPS = 4


def set_step_injections(inp: ScenarioInputs, k: int) -> None:
    net = inp.net
    net.load.loc[inp.load_idx, "p_mw"] = inp.load_p[k]
    net.load.loc[inp.load_idx, "q_mvar"] = inp.load_q[k]
    net.sgen.loc[inp.pv_idx, "p_mw"] = inp.pv_avail[k]
    net.sgen.loc[inp.pv_idx, "q_mvar"] = 0.0
    if inp.battery is not None:
        net.storage.at[inp.battery.storage_idx, "p_mw"] = 0.0


def screen_steps(inp: ScenarioInputs, c: Constraints, max_steps: int = MAX_SCREEN_STEPS) -> list[int]:
    """Baseline-violated steps ranked by severity (worst first)."""
    meta = NetMeta.from_net(inp.net)
    runner = PowerFlowRunner(inp.net)
    scored = []
    for k in range(inp.n_steps):
        set_step_injections(inp, k)
        pf = runner.run()
        if hard_violations(check_step(pf, meta, c)):
            e = excess(pf, meta, c)
            scored.append((max(e.values()), k))
    scored.sort(reverse=True)
    return [k for _, k in scored[:max_steps]]


class SwitchingAction(Action):
    key = "switching"
    name = "Feeder reconfiguration"

    def __init__(self, require_radial: bool = True):
        self.levers = []
        self.require_radial = require_radial

    def setup(self, inp: ScenarioInputs) -> ActionEffect:
        c = inp.config.constraints
        net = inp.net
        default = current_states(net)
        steps = screen_steps(inp, c)
        configs = enumerate_configs(net, self.require_radial)
        rejected = {"islanding": 0, "meshed": 0}
        screened = []
        meta = NetMeta.from_net(net)
        for cfg in configs:
            if cfg.reason:
                rejected[cfg.reason.split(":")[0]] += 1
                continue
            apply_switch_states(net, cfg.states)
            runner = PowerFlowRunner(net)
            n_ok, worst = 0, -np.inf
            for k in steps:
                set_step_injections(inp, k)
                pf = runner.run()
                if not hard_violations(check_step(pf, meta, c)):
                    n_ok += 1
                worst = max(worst, max(excess(pf, meta, c).values()) if pf.converged else np.inf)
            screened.append({"states": cfg.states, "switch_ops": cfg.switch_ops, "screen_steps_ok": n_ok,
                             "screen_steps": len(steps), "worst_excess": None if not np.isfinite(worst) else round(float(worst), 5)})
        screened.sort(key=lambda s: (-s["screen_steps_ok"], s["worst_excess"] if s["worst_excess"] is not None else 1e9, s["switch_ops"]))
        best = screened[0] if screened else {"states": default, "switch_ops": 0}
        apply_switch_states(net, best["states"])
        for s in screened:
            if s is best:
                s["result"] = "selected"
            elif s["screen_steps_ok"] < len(steps):
                s["result"] = "constraint fail at screened steps"
            else:
                s["result"] = "passes screening, not selected (worse margin / more switch ops)"
        changed = {k: v for k, v in best["states"].items() if v != default[k]}
        notes = [f"{len(configs)} configurations enumerated: {rejected['islanding']} rejected (islanding), "
                 f"{rejected['meshed']} rejected (meshed), {len(screened)} radial screened at {len(steps)} worst steps"]
        if not changed:
            notes.append("no radial reconfiguration improves on the default configuration")
        else:
            notes.append("switch changes: " + ", ".join(f"{k} {'close' if v else 'open'}" for k, v in changed.items()))
        return ActionEffect(
            params={"switch_states": best["states"], "changed": changed, "switch_ops": best["switch_ops"],
                    "screened_steps": [inp.labels[k] for k in steps], "configs": screened[:17], "rejected_counts": rejected},
            notes=notes,
        )
