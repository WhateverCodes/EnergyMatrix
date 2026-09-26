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


class CombinedAction(Action):
    def __init__(self, key: str, name: str, parts: list[str]):
        assert parts == sorted(parts, key=LEVER_ORDER.index), "levers must follow switching→battery→reactive→curtailment"
        self.key = key
        self.name = name
        self.parts = parts
        self.levers = []
        lever_map = {"battery": BatteryLever, "reactive": ReactiveLever, "curtailment": CurtailmentLever}
        for p in parts:
            if p in lever_map:
                self.levers.append(lever_map[p]())
        self._switching = SwitchingAction() if "switching" in parts else None

    def available(self, inp: ScenarioInputs):
        singles = {"battery": BatteryAction(), "reactive": ReactiveAction(), "curtailment": CurtailmentAction()}
        for p in self.parts:
            if p in singles:
                ok, why = singles[p].available(inp)
                if not ok:
                    return False, why
        return True, None

    def setup(self, inp: ScenarioInputs) -> ActionEffect:
        if self._switching is not None:
            return self._switching.setup(inp)
        return ActionEffect()


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
                       ["switching", "battery", "reactive", "curtailment"]),
    ]
