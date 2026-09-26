"""Quasi-static time-series (QSTS) engine.

Loops AC power flow over 15-min steps in order, carrying battery state of charge between steps.

Per step:
  1. set load P/Q and available PV for the step (no control),
  2. if a policy (ordered list of levers) is given, each lever may adjust the StepControl
     (battery power, PV reactive power, PV curtailment) — every candidate control is checked
     with a real power flow,
  3. the final control is applied (battery power clamped to SOC/power limits) and PF is run,
  4. the constraint engine checks the result; SOC is updated with charge/discharge efficiency.

SOC dynamics (dt = 0.25 h, E = energy capacity, p > 0 charging):
  charging:     SOC[k+1] = SOC[k] + p * eta_c * dt / E
  discharging:  SOC[k+1] = SOC[k] + p / eta_d * dt / E        (p < 0)
  eta_c = eta_d = sqrt(eta_roundtrip);  SOC kept in [soc_min, soc_max].
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

from app.config import STEP_HOURS, Constraints
from app.simulation.constraints import NetMeta, StepViolation, check_step, excess, hard_violations, summarize
from app.simulation.mapping import BatteryParams, ScenarioInputs
from app.simulation.powerflow import PFResult, PowerFlowRunner
from app.simulation.topology import current_states


@dataclass
class StepControl:
    battery_p_mw: float = 0.0  # >0 charging
    pv_q_mvar: np.ndarray | None = None  # requested per PV sgen, <0 absorbing
    pv_q_effective: np.ndarray | None = None  # after clipping to inverter capability (what was applied)
    curtail_frac: float = 0.0  # uniform fraction of available PV removed
    required_curtail_frac: float | None = None  # min fraction needed (may exceed cap)
    notes: list[str] = field(default_factory=list)
    lever_log: list[str] = field(default_factory=list)


class Lever(Protocol):
    key: str

    def step(self, sc: "StepContext", ctrl: StepControl, pf: PFResult) -> PFResult: ...


def q_capability(p_mw: np.ndarray, s_mva: np.ndarray, min_pf: float) -> np.ndarray:
    """Inverter reactive limit: |Q| <= min(sqrt(S^2 - P^2), P * tan(acos(pf_min)))."""
    circle = np.sqrt(np.clip(s_mva ** 2 - p_mw ** 2, 0.0, None))
    pf_limit = np.abs(p_mw) * math.tan(math.acos(min_pf))
    return np.minimum(circle, pf_limit)


def battery_limits(bp: BatteryParams, soc: float) -> tuple[float, float]:
    """(max charge MW, max discharge MW) available this step given SOC headroom and p_max."""
    ch = max(0.0, min(bp.p_max_mw, (bp.soc_max - soc) * bp.e_max_mwh / (bp.eta_c * STEP_HOURS)))
    dis = max(0.0, min(bp.p_max_mw, (soc - bp.soc_min) * bp.e_max_mwh * bp.eta_d / STEP_HOURS))
    return ch, dis


def next_soc(bp: BatteryParams, soc: float, p: float) -> float:
    if p >= 0:
        s = soc + p * bp.eta_c * STEP_HOURS / bp.e_max_mwh
    else:
        s = soc + p / bp.eta_d * STEP_HOURS / bp.e_max_mwh
    return float(min(bp.soc_max, max(bp.soc_min, s)))


class StepContext:
    """Everything a lever needs to evaluate controls at one timestep."""

    def __init__(self, k: int, inp: ScenarioInputs, runner: PowerFlowRunner, meta: NetMeta, c: Constraints, soc: float | None):
        self.k = k
        self.label = inp.labels[k]
        self.inp = inp
        self.net = inp.net
        self.runner = runner
        self.meta = meta
        self.c = c
        self.soc = soc
        self.pv_avail = inp.pv_avail[k]
        self.bp = inp.battery
        self.n_pf = 0

    def clamp_battery(self, p: float) -> float:
        if self.bp is None or self.soc is None:
            return 0.0
        ch, dis = battery_limits(self.bp, self.soc)
        return float(min(ch, max(-dis, p)))

    def apply(self, ctrl: StepControl) -> None:
        net = self.net
        pv_p = self.pv_avail * (1.0 - ctrl.curtail_frac)
        net.sgen.loc[self.inp.pv_idx, "p_mw"] = pv_p
        if ctrl.pv_q_mvar is not None:
            cap = q_capability(pv_p, self.inp.pv_s_mva, self.c.min_inverter_pf)
            q = np.clip(ctrl.pv_q_mvar, -cap, cap)  # never exceed inverter capability at this P
        else:
            q = np.zeros(len(self.inp.pv_idx))
        ctrl.pv_q_effective = q
        net.sgen.loc[self.inp.pv_idx, "q_mvar"] = q
        if self.bp is not None:
            ctrl.battery_p_mw = self.clamp_battery(ctrl.battery_p_mw)
            net.storage.at[self.bp.storage_idx, "p_mw"] = ctrl.battery_p_mw

    def eval(self, ctrl: StepControl) -> PFResult:
        self.apply(ctrl)
        self.n_pf += 1
        return self.runner.run()

    def ok(self, pf: PFResult) -> bool:
        return not hard_violations(check_step(pf, self.meta, self.c))

    def excess(self, pf: PFResult) -> dict[str, float]:
        return excess(pf, self.meta, self.c)


@dataclass
class StepRecord:
    k: int
    label: str
    timestamp: str
    converged: bool
    status: str
    bus_vm: list[float]
    line_loading: list[float]
    line_p_from: list[float]
    trafo_loading: list[float]
    trafo_p_hv: list[float]
    max_v: float
    min_v: float
    max_line: float
    max_trafo: float
    losses_mw: float
    ext_grid_p: float
    load_mw: float
    pv_avail_mw: float
    pv_dispatched_mw: float
    curtailed_mw: float
    curtail_pct: float
    required_curtail_pct: float | None
    pv_q_mvar: float
    battery_p_mw: float
    soc_pct: float | None
    violations: list[dict]
    notes: list[str]
    levers_used: list[str]


@dataclass
class QSTSResult:
    records: list[StepRecord]
    summary: dict
    switch_states: dict[str, bool]
    per_step_violations: list[list[StepViolation]]
    n_powerflows: int
    head_line_pos: list[int] = field(default_factory=list)

    @property
    def feasible(self) -> bool:
        return self.summary["status"] == "SAFE"

    def first_failing_step(self) -> StepRecord | None:
        for r in self.records:
            if r.status != "SAFE":
                return r
        return None


def _nanround(x: float, nd: int) -> float | None:
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), nd)


def run_qsts(inp: ScenarioInputs, levers: list[Lever] | None = None, soc_init: float | None = None,
             constraints: Constraints | None = None) -> QSTSResult:
    """Run the full window. `inp.net` must already carry the window-level topology (switch states)."""
    c = constraints or inp.config.constraints
    net = inp.net
    meta = NetMeta.from_net(net)
    runner = PowerFlowRunner(net)
    levers = levers or []
    bp = inp.battery
    soc = (soc_init if soc_init is not None else bp.soc_init) if bp is not None else None
    records: list[StepRecord] = []
    per_step: list[list[StepViolation]] = []
    total_pf = 0
    for k in range(inp.n_steps):
        net.load.loc[inp.load_idx, "p_mw"] = inp.load_p[k]
        net.load.loc[inp.load_idx, "q_mvar"] = inp.load_q[k]
        sc = StepContext(k, inp, runner, meta, c, soc)
        ctrl = StepControl()
        scheduled = [lv for lv in levers if getattr(lv, "always", False)]
        corrective = [lv for lv in levers if not getattr(lv, "always", False)]
        for lever in scheduled:  # fixed schedules (e.g. a replayed plan) act every step
            lever.step(sc, ctrl, None)
        pf = sc.eval(ctrl)
        if corrective and not sc.ok(pf):
            for lever in corrective:  # corrective levers act only on violated steps, in order
                pf = lever.step(sc, ctrl, pf)
                if sc.ok(pf):
                    break
            pf = sc.eval(ctrl)  # final, authoritative PF with the chosen control
        vs = check_step(pf, meta, c)
        total_pf += sc.n_pf
        per_step.append(vs)
        pv_avail = float(sc.pv_avail.sum())
        pv_disp = pv_avail * (1.0 - ctrl.curtail_frac)
        soc_after = next_soc(bp, soc, ctrl.battery_p_mw) if bp is not None else None
        hard = hard_violations(vs)
        status = "NON_CONVERGENCE" if not pf.converged else ("VIOLATION" if hard else "SAFE")
        mv = meta.mv_mask
        vm_mv = pf.bus_vm[mv] if pf.converged else np.array([np.nan])
        records.append(StepRecord(
            k=k, label=inp.labels[k], timestamp=inp.timestamps[k].isoformat(), converged=pf.converged, status=status,
            bus_vm=[_nanround(v, 5) for v in pf.bus_vm] if pf.converged else [],
            line_loading=[round(float(v), 3) for v in pf.line_loading] if pf.converged else [],
            line_p_from=[round(float(v), 4) for v in pf.line_p_from] if pf.converged else [],
            trafo_loading=[round(float(v), 3) for v in pf.trafo_loading] if pf.converged else [],
            trafo_p_hv=[round(float(v), 4) for v in pf.trafo_p_hv] if pf.converged else [],
            max_v=_nanround(np.nanmax(vm_mv), 5) if pf.converged else None,
            min_v=_nanround(np.nanmin(vm_mv), 5) if pf.converged else None,
            max_line=round(float(pf.line_loading.max()), 3) if pf.converged else None,
            max_trafo=round(float(pf.trafo_loading.max()), 3) if pf.converged else None,
            losses_mw=_nanround(pf.losses_mw, 5), ext_grid_p=_nanround(pf.ext_grid_p, 4),
            load_mw=round(float(inp.load_p[k].sum()), 4),
            pv_avail_mw=round(pv_avail, 5), pv_dispatched_mw=round(pv_disp, 5),
            curtailed_mw=round(pv_avail - pv_disp, 5), curtail_pct=round(100.0 * ctrl.curtail_frac, 3),
            required_curtail_pct=None if ctrl.required_curtail_frac is None else round(100.0 * ctrl.required_curtail_frac, 3),
            pv_q_mvar=round(float(np.sum(ctrl.pv_q_effective)) if ctrl.pv_q_effective is not None else 0.0, 5),
            battery_p_mw=round(ctrl.battery_p_mw, 5),
            soc_pct=None if soc_after is None else round(100.0 * soc_after, 3),
            violations=[v.__dict__ for v in vs], notes=list(ctrl.notes), levers_used=list(ctrl.lever_log),
        ))
        soc = soc_after
    return QSTSResult(records=records, summary=summarize(inp.labels, per_step), switch_states=current_states(net),
                      per_step_violations=per_step, n_powerflows=total_pf, head_line_pos=meta.head_line_pos)
