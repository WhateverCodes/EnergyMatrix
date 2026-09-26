import time

import pytest

from app.config import STEP_HOURS
from app.schemas.scenario import BatteryConfig, ScenarioConfig
from app.simulation.mapping import build_inputs
from app.simulation.metrics import compute_metrics
from app.simulation.qsts import StepControl, battery_limits, next_soc, run_qsts


class FixedBattery:
    """Test lever: request a constant battery power every step."""

    always = True
    key = "fixed"

    def __init__(self, p):
        self.p = p

    def step(self, sc, ctrl: StepControl, pf):
        ctrl.battery_p_mw = self.p
        return pf


def cfg(**kw):
    base = dict(date="2020-05-25", start="10:00", end="15:00", pv_multiplier=1.0)
    base.update(kw)
    return ScenarioConfig(**base)


def test_baseline_qsts_runs_fast_and_safe():
    run_qsts(build_inputs(cfg()))  # warm-up (numba JIT on first power flow)
    inp = build_inputs(cfg())
    t = time.time()
    res = run_qsts(inp)
    dt = time.time() - t
    assert len(res.records) == 21
    assert res.summary["status"] == "SAFE"
    assert dt < 1.0, f"21-step QSTS took {dt:.2f}s"
    m = compute_metrics(res)
    assert m["curtailed_mwh"] == 0 and m["renewable_utilization_pct"] == pytest.approx(100.0)


def test_soc_charging_efficiency_and_upper_limit():
    b = BatteryConfig(bus=11, p_max_mw=2.0, e_max_mwh=4.0, soc_init_pct=50, soc_max_pct=90, eta_rt=0.92)
    inp = build_inputs(cfg(battery=b))
    res = run_qsts(inp, levers=[FixedBattery(2.0)])
    eta_c = 0.92 ** 0.5
    # first step: +2 MW x 0.25 h x eta_c / 4 MWh
    assert res.records[0].soc_pct == pytest.approx(50 + 100 * 2.0 * STEP_HOURS * eta_c / 4.0, abs=1e-3)
    socs = [r.soc_pct for r in res.records]
    assert max(socs) == pytest.approx(90.0, abs=1e-6)  # saturates at soc_max, never above
    assert all(s <= 90.0 + 1e-9 for s in socs)
    sat = next(i for i, s in enumerate(socs) if s >= 90.0 - 1e-6)
    # after saturation the battery can no longer charge
    assert all(r.battery_p_mw == pytest.approx(0.0, abs=1e-9) for r in res.records[sat + 1:])
    # energy balance: stored = charged x eta_c
    charged = sum(r.battery_p_mw for r in res.records) * STEP_HOURS
    assert (90.0 - 50.0) / 100 * 4.0 == pytest.approx(charged * eta_c, rel=1e-6)


def test_soc_discharge_lower_limit():
    b = BatteryConfig(bus=11, p_max_mw=2.0, e_max_mwh=4.0, soc_init_pct=30, soc_min_pct=10)
    inp = build_inputs(cfg(battery=b))
    res = run_qsts(inp, levers=[FixedBattery(-2.0)])
    socs = [r.soc_pct for r in res.records]
    assert min(socs) == pytest.approx(10.0, abs=1e-6) and all(s >= 10.0 - 1e-9 for s in socs)
    delivered = -sum(r.battery_p_mw for r in res.records) * STEP_HOURS
    eta_d = 0.92 ** 0.5
    assert delivered == pytest.approx((0.30 - 0.10) * 4.0 * eta_d, rel=1e-6)


def test_battery_limit_helpers():
    inp = build_inputs(cfg())
    bp = inp.battery
    ch, dis = battery_limits(bp, 0.9)
    assert ch == 0.0 and dis == pytest.approx(2.0)
    ch, dis = battery_limits(bp, 0.1)
    assert dis == 0.0 and ch == pytest.approx(2.0)
    assert next_soc(bp, 0.89, 2.0) == pytest.approx(0.9)


def test_overvoltage_window_detected_and_metrics():
    # distributed rooftop PV (60 x CIGRE nominal = 12.6 MW) raises voltage along feeder 1
    inp = build_inputs(cfg(pv_multiplier=60, battery=BatteryConfig(enabled=False)))
    res = run_qsts(inp)
    assert res.summary["status"] == "VIOLATION"
    types = {v["type"] for v in res.summary["violations"]}
    assert "OVERVOLTAGE" in types
    ov = next(v for v in res.summary["violations"] if v["type"] == "OVERVOLTAGE")
    assert len(ov["steps"]) >= 1 and ov["value"] > 1.05
    m = compute_metrics(res)
    assert m["max_v"] > 1.05 and m["n_violation_steps"] >= 1
    assert m["peak_feeder_reverse_flow_mw"] > 0  # feeder 1 exports towards bus 1


def test_qsts_does_not_mutate_template():
    from app.simulation.network_factory import get_template
    before = get_template().sgen["p_mw"].copy()
    run_qsts(build_inputs(cfg(rooftop_cluster_mw=5.0)))
    assert get_template().sgen["p_mw"].equals(before)
    assert len(get_template().sgen) == 9
