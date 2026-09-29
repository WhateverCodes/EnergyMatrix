"""Connectivity and radiality checks for switch configurations."""
from __future__ import annotations

import itertools
from dataclasses import dataclass

import networkx as nx
import pandapower as pp
import pandapower.topology as top

from app.simulation.network_factory import SWITCHABLE_NAMES, switchable_indices


def unsupplied_buses(net: pp.pandapowerNet) -> set[int]:
    return {int(b) for b in top.unsupplied_buses(net, respect_switches=True)}


def is_radial(net: pp.pandapowerNet) -> bool:
    """Radial = the in-service graph (switches respected) contains no cycle.

    Two feeders tied together through the shared 110 kV bus also form a cycle,
    so closing a tie between feeders without opening a section is 'meshed'.
    """
    g = top.create_nxgraph(net, respect_switches=True, include_out_of_service=False)
    simple = nx.Graph()
    simple.add_nodes_from(g.nodes)
    for u, v, _k in g.edges(keys=True):
        if simple.has_edge(u, v):
            return False  # parallel branch = loop
        simple.add_edge(u, v)
    return nx.is_forest(simple)


def apply_switch_states(net: pp.pandapowerNet, states: dict[str, bool]) -> None:
    idx = switchable_indices(net)
    for name, closed in states.items():
        if name in idx:
            net.switch.at[idx[name], "closed"] = bool(closed)


def current_states(net: pp.pandapowerNet) -> dict[str, bool]:
    return {name: bool(net.switch.at[i, "closed"]) for name, i in switchable_indices(net).items()}


@dataclass
class ConfigCheck:
    states: dict[str, bool]
    connected: bool
    radial: bool
    unsupplied: list[int]
    switch_ops: int
    require_radial: bool = True

    @property
    def reason(self) -> str | None:
        if not self.connected:
            return f"islanding: buses {self.unsupplied} de-energized"
        if self.require_radial and not self.radial:
            return "meshed: in-service graph contains a loop"
        return None


def enumerate_configs(net: pp.pandapowerNet, require_radial: bool = True) -> list[ConfigCheck]:
    """Enumerate every combination of switchable switch states and check topology."""
    default = current_states(net)
    names = [n for n in SWITCHABLE_NAMES if n in default]
    out: list[ConfigCheck] = []
    original = dict(default)
    for combo in itertools.product([False, True], repeat=len(names)):
        states = dict(zip(names, combo))
        apply_switch_states(net, states)
        uns = sorted(unsupplied_buses(net))
        radial = is_radial(net)
        ops = sum(1 for n in names if states[n] != default[n])
        out.append(ConfigCheck(states=states, connected=not uns, radial=radial, unsupplied=uns, switch_ops=ops,
                               require_radial=require_radial))
    apply_switch_states(net, original)
    return out
