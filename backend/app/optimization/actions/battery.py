"""A1 — Battery. Per violated step, charge only as much as needed to clear a surplus problem
(overvoltage / export overload), or discharge only as much as needed for a deficit problem
(undervoltage / import overload). Minimum power found by bisection within p_max and SOC headroom.
If even the maximum available power is not enough, the battery gives its maximum and the step is
left for later levers (or fails). SOC saturation is reported."""
from __future__ import annotations

from app.optimization.actions.base import Action, bisect_min, deficit_problem, surplus_problem
from app.simulation.mapping import ScenarioInputs
from app.simulation.powerflow import PFResult
from app.simulation.qsts import StepContext, StepControl, battery_limits


class BatteryLever:
    key = "battery"

    def step(self, sc: StepContext, ctrl: StepControl, pf: PFResult) -> PFResult:
        bp = sc.bp
        if bp is None or sc.soc is None or not pf.converged:
            return pf
        ch_max, dis_max = battery_limits(bp, sc.soc)
        base = ctrl.battery_p_mw
        if surplus_problem(sc, pf):
            direction, limit, word = 1.0, ch_max, "charge"
        elif deficit_problem(sc, pf):
            direction, limit, word = -1.0, dis_max, "discharge"
        else:
            return pf
        if limit <= 1e-6:
            bound = f"{100 * (bp.soc_max if direction > 0 else bp.soc_min):.0f}%"
            ctrl.notes.append(f"battery SOC at {bound} limit at {sc.label}: cannot {word}")
            return pf
        ctrl.lever_log.append("battery")

        def ok(p: float) -> bool:
            ctrl.battery_p_mw = base + direction * p
            return sc.ok(sc.eval(ctrl))

        p = bisect_min(0.0, limit, ok)
        if p is None:
            ctrl.battery_p_mw = base + direction * limit
            what = "headroom" if limit < bp.p_max_mw - 1e-6 else "power rating"
            ctrl.notes.append(f"battery at full {word} {limit:.2f} MW ({what}) at {sc.label}, violation remains")
        else:
            ctrl.battery_p_mw = base + direction * p
        return sc.eval(ctrl)


class BatteryAction(Action):
    key = "battery"
    name = "Battery"

    def __init__(self):
        self.levers = [BatteryLever()]

    def available(self, inp: ScenarioInputs):
        if inp.battery is None:
            return False, "battery unavailable (disabled in this scenario)"
        return True, None
