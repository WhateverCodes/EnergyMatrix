"""Builds and caches the CIGRE MV benchmark feeder used as the digital twin.

Source: pandapower.networks.create_cigre_network_mv(with_der="pv_wind"),
CIGRE Task Force C6.04.02 medium-voltage benchmark. Representative network,
NOT a real Indian feeder.

Facts verified against pandapower 3.5.5 (see docs/simulation.md):
- 15 buses: bus 0 is 110 kV (external grid, vm 1.03 pu), buses 1-14 are 20 kV.
- Two 25 MVA 110/20 kV transformers feed feeder 1 (buses 1-11) and feeder 2 (buses 12-14).
- Three normally-open tie switches S1 (line 14-8), S2 (line 6-7), S3 (line 11-4).
- 8 small PV sgens (0.01-0.04 MW each) and one 1.5 MW wind turbine (held at 0 MW).
- No storage in the built-in net; the battery is added by mapping.py.

With only the three ties, the default configuration is the *only* radial one, so
reconfiguration would be trivial. We add four normally-closed sectionalizing load-break
switches (decision logged in docs/decisions.md) so that radial alternatives exist.
"""
from __future__ import annotations

import copy
import json
from functools import lru_cache
from typing import Any

import pandapower as pp
import pandapower.networks as pn

NETWORK_ID = "cigre_mv"
NETWORK_LABEL = "CIGRE MV benchmark feeder (CIGRE TF C6.04.02) — representative, not a real Indian feeder"

# (switch name, line name, bus at which the switch sits)
SECTIONALIZERS = [
    ("SW 3-8", "Line 3-8", 3),
    ("SW 8-9", "Line 8-9", 8),
    ("SW 10-11", "Line 10-11", 10),
    ("SW 5-6", "Line 5-6", 5),
]
TIE_SWITCHES = ["S1", "S2", "S3"]
SWITCHABLE_NAMES = TIE_SWITCHES + [s[0] for s in SECTIONALIZERS]


def _build() -> pp.pandapowerNet:
    net = pn.create_cigre_network_mv(with_der="pv_wind")
    # Wind held at 0 MW in this build (PV-focused study); element kept for completeness.
    wind = net.sgen.index[net.sgen["type"] == "WP"]
    net.sgen.loc[wind, "p_mw"] = 0.0
    net.sgen["sn_mva"] = net.sgen["sn_mva"].astype(float)
    for sw_name, line_name, bus in SECTIONALIZERS:
        line_idx = int(net.line.index[net.line["name"] == line_name][0])
        pp.create_switch(net, bus=bus, element=line_idx, et="l", closed=True, type="LBS", name=sw_name)
    return net


@lru_cache(maxsize=1)
def get_template() -> pp.pandapowerNet:
    """Cached template. NEVER mutate; use new_net() for a working copy."""
    return _build()


def new_net() -> pp.pandapowerNet:
    return copy.deepcopy(get_template())


def switchable_indices(net: pp.pandapowerNet) -> dict[str, int]:
    return {str(net.switch.at[i, "name"]): int(i) for i in net.switch.index if net.switch.at[i, "name"] in SWITCHABLE_NAMES}


def bus_coordinates(net: pp.pandapowerNet) -> dict[int, tuple[float, float]]:
    """pandapower 3.x stores bus geodata as a GeoJSON string in net.bus['geo'].

    Falls back to a deterministic layered layout if geodata is missing.
    """
    coords: dict[int, tuple[float, float]] = {}
    if "geo" in net.bus.columns:
        for idx, geo in net.bus["geo"].items():
            if isinstance(geo, str) and geo:
                c = json.loads(geo)["coordinates"]
                coords[int(idx)] = (float(c[0]), float(c[1]))
    missing = [int(b) for b in net.bus.index if int(b) not in coords]
    for k, b in enumerate(missing):
        coords[b] = (float(k % 5) * 2.0, float(k // 5) * 2.0)
    return coords


def network_summary(net: pp.pandapowerNet | None = None) -> dict[str, Any]:
    net = net if net is not None else get_template()
    coords = bus_coordinates(net)
    sw_names = set(SWITCHABLE_NAMES)
    return {
        "id": NETWORK_ID,
        "label": NETWORK_LABEL,
        "buses": [
            {
                "id": int(i),
                "name": str(r["name"]),
                "vn_kv": float(r["vn_kv"]),
                "x": coords[int(i)][0],
                "y": coords[int(i)][1],
            }
            for i, r in net.bus.iterrows()
        ],
        "lines": [
            {
                "id": int(i),
                "name": str(r["name"]),
                "from_bus": int(r["from_bus"]),
                "to_bus": int(r["to_bus"]),
                "length_km": float(r["length_km"]),
                "max_i_ka": float(r["max_i_ka"]),
                "r_ohm_per_km": float(r["r_ohm_per_km"]),
                "x_ohm_per_km": float(r["x_ohm_per_km"]),
            }
            for i, r in net.line.iterrows()
        ],
        "trafos": [
            {
                "id": int(i),
                "name": str(r["name"]),
                "hv_bus": int(r["hv_bus"]),
                "lv_bus": int(r["lv_bus"]),
                "sn_mva": float(r["sn_mva"]),
            }
            for i, r in net.trafo.iterrows()
        ],
        "switches": [
            {
                "id": int(i),
                "name": str(r["name"]) if r["name"] is not None else f"switch {i}",
                "bus": int(r["bus"]),
                "element": int(r["element"]),
                "et": str(r["et"]),
                "closed": bool(r["closed"]),
                "switchable": r["name"] in sw_names,
                "kind": "tie" if r["name"] in TIE_SWITCHES else ("sectionalizer" if r["name"] in sw_names else "fixed"),
            }
            for i, r in net.switch.iterrows()
        ],
        "loads": [
            {"id": int(i), "name": str(r["name"]), "bus": int(r["bus"]), "p_mw": float(r["p_mw"]), "q_mvar": float(r["q_mvar"])}
            for i, r in net.load.iterrows()
        ],
        "sgens": [
            {"id": int(i), "name": str(r["name"]), "bus": int(r["bus"]), "p_mw": float(r["p_mw"]), "type": str(r["type"]),
             "sn_mva": float(r["sn_mva"])}
            for i, r in net.sgen.iterrows()
        ],
        "storage": [
            {"id": int(i), "name": str(r["name"]), "bus": int(r["bus"]), "max_e_mwh": float(r["max_e_mwh"])}
            for i, r in net.storage.iterrows()
        ],
        "ext_grid": [{"id": int(i), "bus": int(r["bus"]), "vm_pu": float(r["vm_pu"])} for i, r in net.ext_grid.iterrows()],
    }
