"""Constraint engine: turns power-flow results into structured violations.

Hard constraints (decide feasibility): UNDERVOLTAGE, OVERVOLTAGE, LINE_OVERLOAD,
TRAFO_OVERLOAD, NON_CONVERGENCE, ISLANDED_BUS, and REVERSE_FLOW only when a
reverse-flow limit is configured. Otherwise REVERSE_FLOW is INFO and
EXCESSIVE_LOSSES is a WARNING.

Voltage limits are checked on the 20 kV feeder buses; bus 0 is the 110 kV slack.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandapower as pp

from app.config import SEVERITY_LOADING_PCT, SEVERITY_VOLTAGE_PU, Constraints
from app.simulation.powerflow import PFResult

HARD_TYPES = {"UNDERVOLTAGE", "OVERVOLTAGE", "LINE_OVERLOAD", "TRAFO_OVERLOAD", "NON_CONVERGENCE", "ISLANDED_BUS"}


@dataclass
class NetMeta:
    """Static names/indices of one working net, captured once per simulation."""

    bus_ids: list[int]
    bus_names: list[str]
    mv_mask: np.ndarray
    line_ids: list[int]
    line_names: list[str]
    trafo_ids: list[int]
    trafo_names: list[str]
    supplied_bus_mask: np.ndarray = field(default_factory=lambda: np.array([]))  # buses with load or generation

    @classmethod
    def from_net(cls, net: pp.pandapowerNet) -> "NetMeta":
        bus_ids = [int(i) for i in net.bus.index]
        loaded = set(net.load["bus"].astype(int)) | set(net.sgen["bus"].astype(int))
        return cls(
            bus_ids=bus_ids,
            bus_names=[str(n) for n in net.bus["name"]],
            mv_mask=(net.bus["vn_kv"].to_numpy() < 100.0) & net.bus["in_service"].to_numpy(dtype=bool),
            line_ids=[int(i) for i in net.line.index],
            line_names=[str(n) for n in net.line["name"]],
            trafo_ids=[int(i) for i in net.trafo.index],
            trafo_names=[str(n) for n in net.trafo["name"]],
            supplied_bus_mask=np.array([b in loaded for b in bus_ids]),
        )


@dataclass
class StepViolation:
    type: str
    element: str
    id: int
    name: str
    value: float
    limit: float
    severity: str
    hard: bool


def _sev_voltage(excess: float) -> str:
    lo, mid = SEVERITY_VOLTAGE_PU
    return "LOW" if excess < lo else ("MEDIUM" if excess < mid else "HIGH")


def _sev_loading(excess: float) -> str:
    lo, mid = SEVERITY_LOADING_PCT
    return "LOW" if excess < lo else ("MEDIUM" if excess < mid else "HIGH")


def check_step(pf: PFResult, meta: NetMeta, c: Constraints) -> list[StepViolation]:
    if not pf.converged:
        return [StepViolation("NON_CONVERGENCE", "network", -1, "Power flow", float("nan"), float("nan"), "HIGH", True)]
    out: list[StepViolation] = []
    vm = pf.bus_vm
    for k, bid in enumerate(meta.bus_ids):
        if not meta.mv_mask[k]:
            continue
        v = vm[k]
        if np.isnan(v):
            if meta.supplied_bus_mask[k]:
                out.append(StepViolation("ISLANDED_BUS", "bus", bid, meta.bus_names[k], float("nan"), float("nan"), "HIGH", True))
            continue
        if v > c.v_max + 1e-9:
            out.append(StepViolation("OVERVOLTAGE", "bus", bid, meta.bus_names[k], round(float(v), 5), c.v_max, _sev_voltage(v - c.v_max), True))
        elif v < c.v_min - 1e-9:
            out.append(StepViolation("UNDERVOLTAGE", "bus", bid, meta.bus_names[k], round(float(v), 5), c.v_min, _sev_voltage(c.v_min - v), True))
    for k, lid in enumerate(meta.line_ids):
        ld = pf.line_loading[k]
        if ld > c.line_loading_max + 1e-9:
            out.append(StepViolation("LINE_OVERLOAD", "line", lid, meta.line_names[k], round(float(ld), 3), c.line_loading_max,
                                     _sev_loading(ld - c.line_loading_max), True))
    for k, tid in enumerate(meta.trafo_ids):
        ld = pf.trafo_loading[k]
        if ld > c.trafo_loading_max + 1e-9:
            out.append(StepViolation("TRAFO_OVERLOAD", "trafo", tid, meta.trafo_names[k], round(float(ld), 3), c.trafo_loading_max,
                                     _sev_loading(ld - c.trafo_loading_max), True))
        p = pf.trafo_p_hv[k]
        if p < -1e-6:
            rev = -float(p)
            if c.reverse_flow_limit_mw is not None and rev > c.reverse_flow_limit_mw:
                sev = _sev_loading(100.0 * (rev - c.reverse_flow_limit_mw) / max(c.reverse_flow_limit_mw, 1e-3))
                out.append(StepViolation("REVERSE_FLOW", "trafo", tid, meta.trafo_names[k], round(rev, 4), c.reverse_flow_limit_mw, sev, True))
            elif c.reverse_flow_limit_mw is None:
                out.append(StepViolation("REVERSE_FLOW", "trafo", tid, meta.trafo_names[k], round(rev, 4), float("nan"), "INFO", False))
    if pf.load_p > 1e-6:
        loss_pct = 100.0 * pf.losses_mw / pf.load_p
        if loss_pct > c.loss_pct_max:
            out.append(StepViolation("EXCESSIVE_LOSSES", "network", -1, "Network losses", round(loss_pct, 3), c.loss_pct_max, "WARNING", False))
    return out


def hard_violations(vs: list[StepViolation]) -> list[StepViolation]:
    return [v for v in vs if v.hard]


def excess(pf: PFResult, meta: NetMeta, c: Constraints, include_reverse: bool = True) -> dict[str, float]:
    """Signed per-category margins (>0 means violated). Used by bisection searches."""
    if not pf.converged:
        return {"over_v": np.inf, "under_v": np.inf, "line": np.inf, "trafo": np.inf, "reverse": np.inf}
    vm = pf.bus_vm[meta.mv_mask]
    vm = vm[~np.isnan(vm)]
    rev = 0.0
    if include_reverse and c.reverse_flow_limit_mw is not None and len(pf.trafo_p_hv):
        rev = float(np.max(-pf.trafo_p_hv)) - c.reverse_flow_limit_mw
    else:
        rev = -np.inf
    return {
        "over_v": float(vm.max() - c.v_max) if len(vm) else 0.0,
        "under_v": float(c.v_min - vm.min()) if len(vm) else 0.0,
        "line": float((pf.line_loading.max() - c.line_loading_max) / 100.0) if len(pf.line_loading) else -1.0,
        "trafo": float((pf.trafo_loading.max() - c.trafo_loading_max) / 100.0) if len(pf.trafo_loading) else -1.0,
        "reverse": rev,
    }


def step_ok(pf: PFResult, meta: NetMeta, c: Constraints) -> bool:
    return not hard_violations(check_step(pf, meta, c))


def summarize(step_labels: list[str], per_step: list[list[StepViolation]]) -> dict:
    """Aggregate step violations into the documented JSON structure."""
    groups: dict[tuple, dict] = {}
    worst_step = None
    worst_score = 0.0
    info: dict[tuple, dict] = {}
    for label, vs in zip(step_labels, per_step):
        score = 0.0
        for v in vs:
            key = (v.type, v.element, v.id)
            target = groups if v.hard or v.severity == "WARNING" else info
            g = target.get(key)
            if g is None:
                g = target[key] = {"type": v.type, "element": v.element, "id": v.id, "name": v.name, "value": v.value,
                                   "limit": v.limit, "severity": v.severity, "hard": v.hard, "steps": []}
            g["steps"].append(label)
            if _worse(v, g):
                g["value"], g["severity"] = v.value, v.severity
            if v.hard:
                score += _score(v)
        if score > worst_score:
            worst_score, worst_step = score, label
    violations = sorted(groups.values(), key=lambda g: (not g["hard"], _sev_rank(g["severity"]), g["type"], g["id"]))
    hard = [g for g in violations if g["hard"]]
    status = "SAFE"
    if any(g["type"] == "NON_CONVERGENCE" for g in hard):
        status = "NON_CONVERGENCE"
    elif hard:
        status = "VIOLATION"
    return {"status": status, "worst_step": worst_step, "violations": violations, "info": list(info.values())}


def _sev_rank(s: str) -> int:
    return {"HIGH": 0, "MEDIUM": 1, "LOW": 2, "WARNING": 3, "INFO": 4}.get(s, 5)


def _worse(v: StepViolation, g: dict) -> bool:
    if isinstance(v.value, float) and np.isnan(v.value):
        return False
    if isinstance(g["value"], float) and np.isnan(g["value"]):
        return True
    if v.type == "UNDERVOLTAGE":
        return v.value < g["value"]
    return v.value > g["value"]


def _score(v: StepViolation) -> float:
    if v.type in ("NON_CONVERGENCE", "ISLANDED_BUS"):
        return 100.0
    if v.type in ("OVERVOLTAGE", "UNDERVOLTAGE"):
        return abs(v.value - v.limit) * 100.0
    return abs(v.value - v.limit) / 10.0
