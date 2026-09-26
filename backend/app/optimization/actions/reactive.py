"""A3 — Reactive support from PV inverters (volt-var style, per step).

Capability of each inverter: |Q| <= min( sqrt(S_rated^2 - P^2), P * tan(acos(pf_min)) ).
Overvoltage -> absorb Q; undervoltage -> inject Q. The minimum common fraction of capability that
clears the VOLTAGE violation is found by bisection. Reactive power does not relieve thermal
overload (it adds current), so overload-only steps are left untouched and noted.

Physics: dV ≈ (R·P + X·Q) / V. On feeder 1's overhead lines R/X ≈ 0.7, so one MVAr moves voltage
about 1/0.7 ≈ 1.4x as much as one MW; on feeder 2's cables R/X ≈ 1.4 and Q is weaker than P. The
binding limits are inverter headroom (small at full PV output) and the extra current Q adds, which
worsens thermal overload.
"""
from __future__ import annotations

import numpy as np

from app.optimization.actions.base import Action, bisect_min
from app.simulation.mapping import ScenarioInputs
from app.simulation.powerflow import PFResult
from app.simulation.qsts import StepContext, StepControl, q_capability


class ReactiveLever:
    key = "reactive"

    def step(self, sc: StepContext, ctrl: StepControl, pf: PFResult) -> PFResult:
        if not pf.converged:
            return pf
        e = sc.excess(pf)
        if e["over_v"] > 0:
            sign, crit = -1.0, "over_v"
        elif e["under_v"] > 0:
            sign, crit = 1.0, "under_v"
        else:
            if e["line"] > 0 or e["trafo"] > 0:
                ctrl.notes.append(f"reactive support cannot relieve thermal overload at {sc.label}")
            return pf
        p = sc.pv_avail * (1.0 - ctrl.curtail_frac)
        cap = q_capability(p, sc.inp.pv_s_mva, sc.c.min_inverter_pf)
        if cap.sum() <= 1e-6:
            ctrl.notes.append(f"no reactive capability at {sc.label} (PV output ~0)")
            return pf
        ctrl.lever_log.append("reactive")

        def ok(f: float) -> bool:
            ctrl.pv_q_mvar = sign * f * cap
            r = sc.eval(ctrl)
            return r.converged and sc.excess(r)[crit] <= 0

        f = bisect_min(0.0, 1.0, ok)
        if f is None:
            ctrl.pv_q_mvar = sign * cap
            r = sc.eval(ctrl)
            v = r.bus_vm[sc.meta.mv_mask]
            vv = float(np.nanmax(v)) if sign < 0 else float(np.nanmin(v))
            ctrl.notes.append(f"reactive capability saturated ({cap.sum():.2f} MVAr) at {sc.label}, V still {vv:.3f} pu")
            return r
        ctrl.pv_q_mvar = sign * f * cap
        return sc.eval(ctrl)


class ReactiveAction(Action):
    key = "reactive"
    name = "Reactive support"

    def __init__(self):
        self.levers = [ReactiveLever()]

    def available(self, inp: ScenarioInputs):
        if inp.pv_rating_mw.sum() <= 0:
            return False, "no PV inverters in scenario"
        return True, None
