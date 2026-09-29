"""A4 — Limited curtailment. Uniform proportional reduction of all PV sgens.

Per violated step: bisection over [0, 1] finds the minimum fraction that restores feasibility
(this REQUIRED value is always recorded). Applied fraction = min(required, cap). If required > cap
the step fails and the required value is still reported. Curtailment cannot fix undervoltage or
import-direction overload, which is reported as N/A.
"""
from __future__ import annotations

from app.optimization.actions.base import Action, bisect_min, surplus_problem
from app.simulation.mapping import ScenarioInputs
from app.simulation.powerflow import PFResult
from app.simulation.qsts import StepContext, StepControl


class CurtailmentLever:
    key = "curtailment"

    def step(self, sc: StepContext, ctrl: StepControl, pf: PFResult) -> PFResult:
        if not pf.converged:
            return pf
        if not surplus_problem(sc, pf):
            ctrl.notes.append(f"curtailment N/A at {sc.label}: violation is not caused by surplus generation")
            return pf
        cap = sc.c.max_curtailment_pct / 100.0
        base = ctrl.curtail_frac

        def ok(f: float) -> bool:
            ctrl.curtail_frac = f
            return sc.ok(sc.eval(ctrl))

        req = bisect_min(base, 1.0, ok)
        if ctrl.pv_q_mvar is not None:
            # Absorbed Q adds line current. If releasing it lets less curtailment suffice, release it.
            q_saved = ctrl.pv_q_mvar
            ctrl.pv_q_mvar = None
            req_no_q = bisect_min(base, 1.0, ok)
            if req_no_q is not None and (req is None or req_no_q < req - 1e-6):
                req = req_no_q
                ctrl.notes.append(f"reactive support released at {sc.label}: it added line current")
            else:
                ctrl.pv_q_mvar = q_saved
        ctrl.lever_log.append("curtailment")
        if req is None:
            ctrl.required_curtail_frac = 1.0
            ctrl.curtail_frac = max(base, cap)
            ctrl.notes.append(f"even 100% curtailment does not clear the violation at {sc.label}")
        elif req <= cap + 1e-9:
            ctrl.required_curtail_frac = req
            ctrl.curtail_frac = req
        else:
            ctrl.required_curtail_frac = req
            ctrl.curtail_frac = cap
            ctrl.notes.append(f"required curtailment {100 * req:.1f}% exceeds {sc.c.max_curtailment_pct:.0f}% cap at {sc.label}")
        return sc.eval(ctrl)


class CurtailmentAction(Action):
    key = "curtailment"
    name = "Limited curtailment"

    def __init__(self):
        self.levers = [CurtailmentLever()]

    def available(self, inp: ScenarioInputs):
        if inp.pv_rating_mw.sum() <= 0:
            return False, "no PV to curtail"
        return True, None
