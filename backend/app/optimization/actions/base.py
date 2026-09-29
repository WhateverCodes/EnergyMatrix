"""Corrective-action interface.

An Action bundles one or more levers. Evaluator flow for every candidate:
  copy baseline net -> action.setup (window-level, e.g. switch config) -> full QSTS with the action's
  per-step levers -> constraint check at every step -> metrics -> feasibility -> penalty J.

Per-step levers are applied in the fixed order switching -> battery -> reactive -> curtailment
("curtail last"), each acting only on what the previous ones left unresolved.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from app.simulation.constraints import excess
from app.simulation.mapping import ScenarioInputs
from app.simulation.powerflow import PFResult
from app.simulation.qsts import StepContext

BISECT_ITERS = 8  # resolution 1/256 of the search range (0.4 % for curtailment)


@dataclass
class ActionEffect:
    """Window-level description of what an action chose (parameters) — reported to the user."""

    params: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def surplus_problem(sc: StepContext, pf: PFResult) -> bool:
    """True if the step's violation is of the 'too much generation' kind (overvoltage, reverse-direction
    overload or reverse-flow limit)."""
    e = sc.excess(pf)
    if e["over_v"] > 0 or e["reverse"] > 0:
        return True
    if e["line"] > 0 or e["trafo"] > 0:
        # overload direction: is the feeder exporting through its head?
        head = [pf.line_p_from[k] for k in sc.meta.head_line_pos]
        return bool(head) and min(head) < 0
    return False


def deficit_problem(sc: StepContext, pf: PFResult) -> bool:
    e = sc.excess(pf)
    if e["under_v"] > 0:
        return True
    if e["line"] > 0 or e["trafo"] > 0:
        return not surplus_problem(sc, pf)
    return False


def worst_excess(sc: StepContext, pf: PFResult) -> float:
    """Single scalar 'how violated' (>0 = violated); used for bisection and progress comparisons."""
    if not pf.converged:
        return float("inf")
    e = excess(pf, sc.meta, sc.c)
    return max(e.values())


COARSE_STEPS = 10


def bisect_min(lo: float, hi: float, is_ok: Callable[[float], bool], iters: int = BISECT_ITERS) -> float | None:
    """Smallest x in [lo, hi] with is_ok(x). None if no feasible x exists.

    Feasibility is monotone near the minimum but not always up to `hi` (e.g. curtailing 100% of PV
    can create an undervoltage), so if `hi` fails we coarse-scan for the first feasible point and
    bisect between it and the previous grid point.
    """
    if is_ok(lo):
        return lo
    a, b = lo, hi
    if not is_ok(hi):
        grid = [lo + (hi - lo) * i / COARSE_STEPS for i in range(1, COARSE_STEPS)]
        first = next((x for x in grid if is_ok(x)), None)
        if first is None:
            return None
        a, b = first - (hi - lo) / COARSE_STEPS, first
    for _ in range(iters):
        m = 0.5 * (a + b)
        if is_ok(m):
            b = m
        else:
            a = m
    return b


class Action:
    key: str = "base"
    name: str = "Base action"
    levers: list = []

    def available(self, inp: ScenarioInputs) -> tuple[bool, str | None]:
        return True, None

    def setup(self, inp: ScenarioInputs) -> ActionEffect:
        """Window-level changes to inp.net (a private copy) before the QSTS run."""
        return ActionEffect()

    def step_levers(self, inp: ScenarioInputs) -> list:
        return list(self.levers)
