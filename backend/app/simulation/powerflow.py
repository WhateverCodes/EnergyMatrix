"""Single-step AC power flow (Newton-Raphson) with convergence handling.

Non-convergence is never skipped: it returns PFResult(converged=False) and the
constraint engine turns it into a NON_CONVERGENCE violation.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandapower as pp

_RECYCLE = {"bus_pq": True, "trafo": False, "gen": False}


@dataclass
class PFResult:
    converged: bool
    bus_vm: np.ndarray = field(default_factory=lambda: np.array([]))  # indexed like net.bus
    bus_va: np.ndarray = field(default_factory=lambda: np.array([]))
    line_loading: np.ndarray = field(default_factory=lambda: np.array([]))  # %
    line_p_from: np.ndarray = field(default_factory=lambda: np.array([]))  # MW
    line_q_from: np.ndarray = field(default_factory=lambda: np.array([]))
    trafo_loading: np.ndarray = field(default_factory=lambda: np.array([]))  # %
    trafo_p_hv: np.ndarray = field(default_factory=lambda: np.array([]))  # MW, >0 = import from 110 kV
    losses_mw: float = float("nan")
    ext_grid_p: float = float("nan")  # MW, >0 import
    ext_grid_q: float = float("nan")
    load_p: float = float("nan")
    sgen_p: np.ndarray = field(default_factory=lambda: np.array([]))
    sgen_q: np.ndarray = field(default_factory=lambda: np.array([]))
    storage_p: np.ndarray = field(default_factory=lambda: np.array([]))  # >0 charging
    error: str | None = None


def _topology_key(net: pp.pandapowerNet) -> tuple:
    return (
        tuple(net.switch["closed"].tolist()),
        tuple(net.line["in_service"].tolist()),
        tuple(net.sgen["in_service"].tolist()),
        tuple(net.load["in_service"].tolist()),
        tuple(net.storage["in_service"].tolist()),
        len(net.sgen), len(net.load), len(net.storage),
    )


class PowerFlowRunner:
    """Runs PF on one working net. Reuses the internal model (pandapower `recycle`)
    while only P/Q injections change, and rebuilds whenever topology changes."""

    def __init__(self, net: pp.pandapowerNet):
        self.net = net
        self._key: tuple | None = None
        self.n_runs = 0

    def run(self) -> PFResult:
        net = self.net
        key = _topology_key(net)
        self.n_runs += 1
        try:
            if key != self._key:
                pp.runpp(net, algorithm="nr", init="auto", numba=True)
                self._key = key
                # prime recycle structures for subsequent P/Q-only changes
                pp.runpp(net, algorithm="nr", init="results", recycle=_RECYCLE, numba=True)
            else:
                pp.runpp(net, algorithm="nr", init="results", recycle=_RECYCLE, numba=True)
        except pp.LoadflowNotConverged as exc:
            self._key = None
            return PFResult(converged=False, error=f"Newton-Raphson did not converge: {exc}")
        return extract(net)


def run_pf(net: pp.pandapowerNet) -> PFResult:
    """One-off PF without recycling (used by snapshots and tests)."""
    try:
        pp.runpp(net, algorithm="nr", init="auto", numba=True)
    except pp.LoadflowNotConverged as exc:
        return PFResult(converged=False, error=f"Newton-Raphson did not converge: {exc}")
    return extract(net)


def extract(net: pp.pandapowerNet) -> PFResult:
    rl = net.res_line
    rt = net.res_trafo
    return PFResult(
        converged=True,
        bus_vm=net.res_bus["vm_pu"].to_numpy(dtype=float).copy(),
        bus_va=net.res_bus["va_degree"].to_numpy(dtype=float).copy(),
        line_loading=np.nan_to_num(rl["loading_percent"].to_numpy(dtype=float)),
        line_p_from=np.nan_to_num(rl["p_from_mw"].to_numpy(dtype=float)),
        line_q_from=np.nan_to_num(rl["q_from_mvar"].to_numpy(dtype=float)),
        trafo_loading=np.nan_to_num(rt["loading_percent"].to_numpy(dtype=float)),
        trafo_p_hv=np.nan_to_num(rt["p_hv_mw"].to_numpy(dtype=float)),
        losses_mw=float(np.nansum(rl["pl_mw"].to_numpy(dtype=float)) + np.nansum(rt["pl_mw"].to_numpy(dtype=float))),
        ext_grid_p=float(net.res_ext_grid["p_mw"].sum()),
        ext_grid_q=float(net.res_ext_grid["q_mvar"].sum()),
        load_p=float(np.nansum(net.res_load["p_mw"].to_numpy(dtype=float))),
        sgen_p=np.nan_to_num(net.res_sgen["p_mw"].to_numpy(dtype=float)),
        sgen_q=np.nan_to_num(net.res_sgen["q_mvar"].to_numpy(dtype=float)),
        storage_p=np.nan_to_num(net.res_storage["p_mw"].to_numpy(dtype=float)) if len(net.storage) else np.array([]),
    )
