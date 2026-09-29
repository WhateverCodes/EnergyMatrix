"""Acceptance: each library scenario lands in its documented OUTCOME CLASS.

Only the class is asserted — never exact numbers. If a class breaks, recalibrate
(make calibrate) and adjust scenario parameters; never hard-code outputs.
S7/S8 (predictive mode) are asserted in test_predictive_scenarios.py.
"""
import pytest

from app.optimization.evaluator import evaluate
from app.scenarios.library import list_scenarios, scenario_config


@pytest.fixture(scope="module")
def results():
    return {sid: evaluate(scenario_config(sid)) for sid in ["S1", "S2", "S3", "S4", "S5", "S6"]}


def test_library_has_eight_scenarios_with_expected_classes():
    lib = list_scenarios()
    assert [s["id"] for s in lib] == [f"S{i}" for i in range(1, 9)]
    assert all(s["expected_outcome"] and s["provenance"] for s in lib)


def test_s1_safe_no_action(results):
    r = results["S1"]
    assert r["status"] == "NO_ACTION_NEEDED" and r["baseline_status"] == "FEASIBLE"


def test_s2_battery_recommended_without_curtailment(results):
    r = results["S2"]
    assert r["baseline_status"] == "VIOLATION"
    assert r["status"] == "FEASIBLE"
    rec = next(c for c in r["candidates"] if c["recommended"])
    assert "battery" in rec["key"]
    assert rec["metrics"]["curtailed_pct"] < 1.0  # ~0 % curtailment


def test_s3_no_battery_levers_compared_one_feasible(results):
    r = results["S3"]
    assert r["baseline_status"] == "VIOLATION" and r["status"] == "FEASIBLE"
    keys = {c["key"]: c for c in r["candidates"]}
    assert not keys["battery"]["available"]
    for k in ("switching", "reactive", "curtailment"):
        assert keys[k]["available"] and keys[k]["metrics"] is not None
    assert any(c["feasible"] for c in r["candidates"] if c["key"] != "none")


def test_s4_safe_or_mild(results):
    r = results["S4"]
    if r["status"] != "NO_ACTION_NEEDED":
        base = next(c for c in r["candidates"] if c["key"] == "none")
        assert all(v["severity"] == "LOW" for v in base["violations"] if v["hard"])


def test_s5_evening_undervoltage_curtailment_na(results):
    r = results["S5"]
    base = next(c for c in r["candidates"] if c["key"] == "none")
    types = {v["type"] for v in base["violations"]}
    assert "UNDERVOLTAGE" in types or {"LINE_OVERLOAD", "TRAFO_OVERLOAD"} & types
    curt = next(c for c in r["candidates"] if c["key"] == "curtailment")
    assert curt["metrics"]["curtailed_mwh"] == 0
    assert any("N/A" in w for w in (curt["failure"] or {}).get("why", [])) or curt["feasible"]
    if r["status"] == "NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS":
        lr = r["infeasibility"]["minimum_intervention"]["load_reduction"]
        assert lr["mw"] is not None and lr["mw"] > 0


def test_s6_no_feasible_solution_required_curtailment_exceeds_cap(results):
    r = results["S6"]
    assert r["status"] == "NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS"
    mi = r["infeasibility"]["minimum_intervention"]
    assert mi["required_curtailment_pct"] > mi["cap_pct"] == 20.0
    assert mi["applied"] is False
    assert all(not c["feasible"] for c in r["candidates"])
