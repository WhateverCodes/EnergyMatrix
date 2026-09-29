"""Per-bus PV hosting capacity.

Worst case (stated): the window's maximum-PV step combined with its minimum-load step, as a single
snapshot (existing PV at that step's output, all loads at the minimum-load step). For each 20 kV bus,
bisection on ADDED PV (MW, unity PF) finds the largest addition that keeps every hard constraint
satisfied, and reports which constraint binds just above it. Results are cached per (config, window).
"""
from __future__ import annotations

import copy
from collections import OrderedDict

import numpy as np
import pandapower as pp

from app.schemas.scenario import ScenarioConfig
from app.simulation.constraints import NetMeta, check_step, hard_violations
from app.simulation.mapping import build_inputs
from app.simulation.powerflow import PowerFlowRunner

MAX_ADD_MW = 30.0
ITERS = 10
_CACHE: "OrderedDict[str, dict]" = OrderedDict()


def _key(cfg: ScenarioConfig) -> str:
    return cfg.model_dump_json(exclude={"weights", "name"})


def hosting_capacity(cfg: ScenarioConfig) -> dict:
    key = _key(cfg)
    if key in _CACHE:
        return _CACHE[key]
    inp = build_inputs(cfg)
    k_pv = int(np.argmax(inp.pv_avail.sum(axis=1)))
    k_load = int(np.argmin(inp.load_p.sum(axis=1)))
    net = copy.deepcopy(inp.net)
    net.load.loc[inp.load_idx, "p_mw"] = inp.load_p[k_load]
    net.load.loc[inp.load_idx, "q_mvar"] = inp.load_q[k_load]
    net.sgen.loc[inp.pv_idx, "p_mw"] = inp.pv_avail[k_pv]
    net.sgen.loc[inp.pv_idx, "q_mvar"] = 0.0
    if inp.battery is not None:
        net.storage.at[inp.battery.storage_idx, "p_mw"] = 0.0
    c = cfg.constraints
    probe = pp.create_sgen(net, 1, p_mw=0.0, name="hosting probe", type="PV")
    meta = NetMeta.from_net(net)
    runner = PowerFlowRunner(net)
    base_vs = hard_violations(check_step(runner.run(), meta, c))
    buses = []
    for b in net.bus.index:
        if net.bus.at[b, "vn_kv"] > 100:
            continue
        net.sgen.at[probe, "bus"] = int(b)
        runner = PowerFlowRunner(net)  # bus change = topology change for the solver

        def violations(mw: float):
            net.sgen.at[probe, "p_mw"] = mw
            return hard_violations(check_step(runner.run(), meta, c))

        if base_vs:
            buses.append({"bus": int(b), "name": str(net.bus.at[b, "name"]), "hosting_mw": 0.0,
                          "binding": base_vs[0].type, "binding_element": base_vs[0].name, "note": "violated before adding PV"})
            continue
        if not violations(MAX_ADD_MW):
            buses.append({"bus": int(b), "name": str(net.bus.at[b, "name"]), "hosting_mw": MAX_ADD_MW,
                          "binding": None, "binding_element": None, "note": f">= {MAX_ADD_MW} MW (search cap)"})
            continue
        lo, hi = 0.0, MAX_ADD_MW
        for _ in range(ITERS):
            m = 0.5 * (lo + hi)
            if violations(m):
                hi = m
            else:
                lo = m
        vs = violations(hi)
        worst = vs[0] if vs else None
        buses.append({"bus": int(b), "name": str(net.bus.at[b, "name"]), "hosting_mw": round(lo, 3),
                      "binding": worst.type if worst else None, "binding_element": worst.name if worst else None, "note": None})
    net.sgen.at[probe, "p_mw"] = 0.0
    out = {
        "worst_case": {"max_pv_step": inp.labels[k_pv], "min_load_step": inp.labels[k_load],
                       "existing_pv_mw": round(float(inp.pv_avail[k_pv].sum()), 4),
                       "load_mw": round(float(inp.load_p[k_load].sum()), 4)},
        "method": "bisection on added PV at each bus (unity PF), max PV step + min load step snapshot",
        "buses": buses,
    }
    _CACHE[key] = out
    while len(_CACHE) > 16:
        _CACHE.popitem(last=False)
    return out
