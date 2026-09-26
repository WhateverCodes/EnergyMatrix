import numpy as np
import pytest

from app.config import Constraints, ObjectiveWeights
from app.optimization.actions.base import bisect_min
from app.optimization.actions.battery import BatteryLever
from app.optimization.actions.combined import LEVER_ORDER, CombinedAction, all_candidates
from app.optimization.actions.curtailment import CurtailmentLever
from app.optimization.actions.reactive import ReactiveLever
from app.optimization.actions.switching import SwitchingAction
from app.optimization.evaluator import clone_inputs, evaluate, simulate_candidate
from app.optimization.objective import penalty, rank
from app.schemas.scenario import BatteryConfig, ScenarioConfig
from app.simulation.mapping import build_inputs
from app.simulation.network_factory import get_template
from app.simulation.qsts import q_capability, run_qsts
from app.simulation.topology import is_radial, unsupplied_buses

NO_BATT = BatteryConfig(enabled=False)


def cfg(**kw):
    base = dict(date="2020-05-25", start="11:30", end="13:00")
    base.update(kw)
    return ScenarioConfig(**base)


def test_bisect_min_finds_minimum_and_handles_nonmonotone_top():
    assert bisect_min(0, 1, lambda x: x >= 0.3) == pytest.approx(0.3, abs=1e-3)
    assert bisect_min(0, 1, lambda x: False) is None
    assert bisect_min(0, 1, lambda x: True) == 0
    # feasible band [0.3, 0.9]: top fails, still finds 0.3
    assert bisect_min(0, 1, lambda x: 0.3 <= x <= 0.9) == pytest.approx(0.3, abs=1e-3)


def test_curtailment_bisection_is_minimal_and_capped():
    inp = build_inputs(cfg(pv_multiplier=50, battery=NO_BATT))
    res = run_qsts(clone_inputs(inp), [CurtailmentLever()])
    for r in res.records:
        if r.required_curtail_pct is None:
            continue
        assert r.curtail_pct <= 20.0 + 1e-9
        if r.required_curtail_pct <= 20.0:
            assert r.status == "SAFE"
            assert r.curtail_pct == pytest.approx(r.required_curtail_pct)
        else:
            assert r.status == "VIOLATION" and r.curtail_pct == pytest.approx(20.0)
    # minimality: 1 percentage point less than required must violate
    r = next(r for r in res.records if r.required_curtail_pct and 1.0 < r.required_curtail_pct <= 20.0)
    from app.simulation.qsts import StepContext, StepControl
    from app.simulation.powerflow import PowerFlowRunner
    from app.simulation.constraints import NetMeta
    work = clone_inputs(inp)
    k = r.k
    work.net.load.loc[work.load_idx, "p_mw"] = work.load_p[k]
    work.net.load.loc[work.load_idx, "q_mvar"] = work.load_q[k]
    sc = StepContext(k, work, PowerFlowRunner(work.net), NetMeta.from_net(work.net), work.config.constraints, None)
    assert not sc.ok(sc.eval(StepControl(curtail_frac=(r.required_curtail_pct - 1.0) / 100)))
    assert sc.ok(sc.eval(StepControl(curtail_frac=r.required_curtail_pct / 100)))


def test_curtailment_cap_is_configurable():
    inp = build_inputs(cfg(pv_multiplier=55, battery=NO_BATT, constraints=Constraints(max_curtailment_pct=40)))
    res = run_qsts(inp, [CurtailmentLever()])
    assert res.summary["status"] == "SAFE"
    assert max(r.curtail_pct for r in res.records) > 20.0


def test_curtailment_not_applicable_to_undervoltage():
    # CIGRE evening peak is already below 0.95 pu at the feeder end; add a consumer spike
    inp = build_inputs(ScenarioConfig(date="2020-05-25", start="19:00", end="20:00", consumer_profile="residential_society",
                                      consumer_scale=1.5, battery=NO_BATT))
    res = run_qsts(inp, [CurtailmentLever()])
    assert res.summary["status"] == "VIOLATION"
    assert any("N/A" in n for r in res.records for n in r.notes)
    assert all(r.curtail_pct == 0 for r in res.records)


def test_reactive_limits_respected():
    p = np.array([1.0, 0.5, 0.0])
    s = np.array([1.1, 1.1, 1.1])
    cap = q_capability(p, s, 0.9)
    assert cap[0] == pytest.approx(min(np.sqrt(1.21 - 1.0), 1.0 * np.tan(np.arccos(0.9))))
    assert cap[1] == pytest.approx(0.5 * np.tan(np.arccos(0.9)))
    assert cap[2] == 0.0
    inp = build_inputs(cfg(pv_multiplier=55, battery=NO_BATT))
    res = run_qsts(inp, [ReactiveLever()])
    pv_p = inp.pv_avail
    caps = np.array([q_capability(pv_p[k], inp.pv_s_mva, 0.9).sum() for k in range(inp.n_steps)])
    for r, cap_k in zip(res.records, caps):
        assert abs(r.pv_q_mvar) <= cap_k + 1e-6
        assert r.pv_q_mvar <= 1e-9  # overvoltage -> absorbing only
    # reactive clears overvoltage but cannot fix thermal overload
    assert res.summary["status"] == "VIOLATION"
    assert {v["type"] for v in res.summary["violations"]} == {"LINE_OVERLOAD"}


def test_battery_charges_only_when_needed():
    inp = build_inputs(cfg(start="10:00", end="15:00", pv_multiplier=45, battery=BatteryConfig(soc_init_pct=20)))
    base = run_qsts(clone_inputs(inp))
    res = run_qsts(clone_inputs(inp), [BatteryLever()])
    for b, r in zip(base.records, res.records):
        if b.status == "SAFE":
            assert r.battery_p_mw == 0.0
        else:
            assert r.battery_p_mw > 0  # surplus -> charge
    assert max(r.soc_pct for r in res.records) <= 90.0 + 1e-6


def test_switching_rejects_islanding_and_meshes_and_keeps_radial():
    inp = build_inputs(cfg(pv_multiplier=55, battery=NO_BATT))
    work = clone_inputs(inp)
    eff = SwitchingAction().setup(work)
    rc = eff.params["rejected_counts"]
    assert rc["islanding"] > 0 and rc["meshed"] > 0
    assert is_radial(work.net) and not unsupplied_buses(work.net)
    assert eff.params["switch_ops"] == sum(1 for _ in eff.params["changed"])


def test_combination_ordering_enforced():
    with pytest.raises(AssertionError):
        CombinedAction("bad", "bad", ["curtailment", "battery"])
    for a in all_candidates():
        if isinstance(a, CombinedAction):
            assert a.parts == sorted(a.parts, key=LEVER_ORDER.index)
    ac = next(a for a in all_candidates() if a.key == "all_levers")
    assert [type(lv).__name__ for lv in ac.levers] == ["BatteryLever", "ReactiveLever", "CurtailmentLever"]


def test_objective_ranking_feasible_first_then_J():
    m = dict(curtailed_mwh=1.0, battery_throughput_mwh=0.0, switch_ops=0, losses_mwh=0.5, reactive_mvarh=0.0, n_violation_steps=0)
    assert penalty(m, ObjectiveWeights())["J"] == pytest.approx(10.5)
    cands = [
        {"key": "a", "available": True, "feasible": True, "metrics": dict(m)},
        {"key": "b", "available": True, "feasible": True, "metrics": dict(m, curtailed_mwh=0.0, battery_throughput_mwh=2.0)},
        {"key": "c", "available": True, "feasible": False, "metrics": dict(m, curtailed_mwh=0.0, n_violation_steps=3)},
        {"key": "d", "available": False, "feasible": False, "metrics": None},
    ]
    order = [c["key"] for c in rank(cands, ObjectiveWeights())]
    assert order == ["b", "a", "c", "d"]
    # changing weights re-ranks without re-simulation
    order2 = [c["key"] for c in rank(cands, ObjectiveWeights(w_curt=1.0, w_batt=5.0))]
    assert order2[:2] == ["a", "b"]


def test_baseline_template_never_mutated_by_evaluation():
    tpl = get_template()
    snap = {t: tpl[t].copy() for t in ("bus", "line", "load", "sgen", "switch", "storage")}
    evaluate(cfg(pv_multiplier=55, battery=NO_BATT), use_cache=False)
    for t, df in snap.items():
        assert tpl[t].equals(df), f"template table {t} mutated"


def test_unavailable_battery_reported_not_simulated():
    inp = build_inputs(cfg(pv_multiplier=55, battery=NO_BATT))
    from app.optimization.actions.battery import BatteryAction
    cand, res, _ = simulate_candidate(inp, BatteryAction())
    assert not cand["available"] and res is None and "unavailable" in cand["unavailable_reason"]


def test_infeasibility_report_content():
    r = evaluate(cfg(pv_multiplier=75, battery=NO_BATT), use_cache=False)
    assert r["status"] == "NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS"
    inf = r["infeasibility"]
    mi = inf["minimum_intervention"]
    assert mi["required_curtailment_pct"] > 20.0 and mi["cap_pct"] == 20.0 and mi["applied"] is False
    evaluated = [c for c in inf["candidates"] if c["available"]]
    assert evaluated and all(c["first_failing_step"] and c["binding_constraint"] for c in evaluated)
    curt = next(c for c in inf["candidates"] if c["key"] == "curtailment")
    assert any("exceeds 20% cap" in w for w in curt["why"])
    unavailable = [c for c in inf["candidates"] if not c["available"]]
    assert unavailable and all("battery" in c["why"][0] for c in unavailable)
    assert "NO FEASIBLE SOLUTION" in r["explanation"]
