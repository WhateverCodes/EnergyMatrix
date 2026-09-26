"""A5 — Combinations. Order is always switching -> battery -> reactive -> curtail residual only."""
from __future__ import annotations

from app.optimization.actions.base import Action, ActionEffect
from app.optimization.actions.battery import BatteryAction, BatteryLever
from app.optimization.actions.curtailment import CurtailmentAction, CurtailmentLever
from app.optimization.actions.reactive import ReactiveAction, ReactiveLever
from app.optimization.actions.switching import SwitchingAction
from app.simulation.mapping import ScenarioInputs

LEVER_ORDER = ["switching", "battery", "reactive", "curtailment"]


class NoAction(Action):
    key = "none"
    name = "No action (baseline)"

    def __init__(self):
        self.levers = []


_LEVERS = {"battery": BatteryLever, "reactive": ReactiveLever, "curtailment": CurtailmentLever}


class CombinedAction(Action):
    """Ordered combination. With use_available=True ("all levers") unavailable parts are dropped and
    noted instead of making the whole candidate unavailable."""

    def __init__(self, key: str, name: str, parts: list[str], use_available: bool = False):
        assert parts == sorted(parts, key=LEVER_ORDER.index), "levers must follow switching→battery→reactive→curtailment"
        self.key = key
        self.name = name
        self.parts = parts
        self.use_available = use_available
        self.levers = [_LEVERS[p]() for p in parts if p in _LEVERS]
        self._switching = SwitchingAction() if "switching" in parts else None
        self._excluded: list[str] = []

    def _unavailable(self, inp: ScenarioInputs) -> dict[str, str]:
        singles = {"battery": BatteryAction(), "reactive": ReactiveAction(), "curtailment": CurtailmentAction()}
        out = {}
        for p in self.parts:
            if p in singles:
                ok, why = singles[p].available(inp)
                if not ok:
                    out[p] = why
        return out

    def available(self, inp: ScenarioInputs):
        missing = self._unavailable(inp)
        if not missing:
            return True, None
        if self.use_available and len(self.parts) - len(missing) >= 2:
            return True, None
        return False, next(iter(missing.values()))

    def step_levers(self, inp: ScenarioInputs) -> list:
        missing = self._unavailable(inp)
        return [lv for lv in self.levers if lv.key not in missing]

    def setup(self, inp: ScenarioInputs) -> ActionEffect:
        eff = self._switching.setup(inp) if self._switching is not None else ActionEffect()
        for p, why in self._unavailable(inp).items():
            eff.notes.append(f"{p} excluded: {why}")
        return eff


def all_candidates() -> list[Action]:
    return [
        NoAction(),
        BatteryAction(),
        SwitchingAction(),
        ReactiveAction(),
        CurtailmentAction(),
        CombinedAction("battery_curtail", "Battery + curtailment", ["battery", "curtailment"]),
        CombinedAction("reactive_curtail", "Reactive + curtailment", ["reactive", "curtailment"]),
        CombinedAction("switching_battery", "Switching + battery", ["switching", "battery"]),
        CombinedAction("all_levers", "All levers (switching + battery + reactive + curtailment)",
                       ["switching", "battery", "reactive", "curtailment"], use_available=True),
    ]
