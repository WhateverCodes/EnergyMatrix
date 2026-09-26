import copy

import numpy as np
import pandapower as pp
import pytest

from app.config import Constraints
from app.simulation.constraints import NetMeta, check_step, summarize
from app.simulation.network_factory import SWITCHABLE_NAMES, get_template, network_summary, new_net
from app.simulation.powerflow import PowerFlowRunner, run_pf
from app.simulation.topology import apply_switch_states, enumerate_configs, is_radial, unsupplied_buses


def test_network_construction():
    net = get_template()
    assert len(net.bus) == 15
    assert set(net.bus.vn_kv.unique()) == {110.0, 20.0}
    assert len(net.trafo) == 2
    names = set(net.switch.name.dropna())
    assert set(SWITCHABLE_NAMES) <= names
    # tie switches normally open, sectionalizers closed
    for n in ["S1", "S2", "S3"]:
        assert not net.switch.loc[net.switch.name == n, "closed"].iloc[0]
    summary = network_summary()
    assert all("x" in b and "y" in b for b in summary["buses"])
    assert summary["buses"][1]["x"] == 4.0 and summary["buses"][1]["y"] == 15.0  # from GeoJSON


def test_default_config_is_radial_and_connected():
    net = new_net()
    assert is_radial(net)
    assert unsupplied_buses(net) == set()


def test_pf_converges_and_records():
    net = new_net()
    pf = run_pf(net)
    assert pf.converged
    assert len(pf.bus_vm) == 15 and len(pf.line_loading) == len(net.line)
    assert pf.bus_vm[0] == pytest.approx(1.03, abs=1e-6)


def test_non_convergence_is_reported():
    net = new_net()
    net.load["p_mw"] *= 60  # absurd load -> no solution
    pf = run_pf(net)
    assert not pf.converged
    vs = check_step(pf, NetMeta.from_net(net), Constraints())
    assert vs[0].type == "NON_CONVERGENCE" and vs[0].hard


def test_recycle_runner_matches_fresh_and_handles_topology_change():
    net = new_net()
    runner = PowerFlowRunner(net)
    runner.run()
    net.load["scaling"] = 0.5
    r1 = runner.run()
    fresh = run_pf(copy.deepcopy(net))
    assert np.allclose(r1.bus_vm, fresh.bus_vm, atol=1e-8)
    apply_switch_states(net, {"S3": True, "SW 10-11": False})
    r2 = runner.run()
    fresh2 = run_pf(copy.deepcopy(net))
    assert np.allclose(r2.bus_vm, fresh2.bus_vm, atol=1e-8)
    assert not np.allclose(r1.bus_vm, r2.bus_vm)


def test_storage_sign_convention():
    """pandapower storage: p_mw > 0 is CHARGING (consumes power -> more import)."""
    net = new_net()
    net.load["scaling"] = 0.4
    s = pp.create_storage(net, 11, p_mw=0.0, max_e_mwh=4.0)
    base = run_pf(net).ext_grid_p
    net.storage.at[s, "p_mw"] = 1.0
    charging = run_pf(net)
    # import rises by 1 MW plus a small increase in losses
    assert 1.0 <= charging.ext_grid_p - base < 1.1
    assert charging.storage_p[0] == pytest.approx(1.0)


def test_trafo_reverse_flow_sign():
    net = new_net()
    net.load["scaling"] = 0.1
    pp.create_sgen(net, 12, p_mw=10.0)
    pf = run_pf(net)
    assert pf.trafo_p_hv[1] < 0  # feeder 2 exports to 110 kV
    vs = check_step(pf, NetMeta.from_net(net), Constraints())
    rev = [v for v in vs if v.type == "REVERSE_FLOW"]
    assert rev and rev[0].severity == "INFO" and not rev[0].hard
    vs2 = check_step(pf, NetMeta.from_net(net), Constraints(reverse_flow_limit_mw=1.0))
    assert any(v.type == "REVERSE_FLOW" and v.hard for v in vs2)


def test_overvoltage_and_line_overload_detected():
    net = new_net()
    net.load["scaling"] = 0.4
    pp.create_sgen(net, 11, p_mw=8.0)
    vs = check_step(run_pf(net), NetMeta.from_net(net), Constraints())
    types = {v.type for v in vs}
    assert "OVERVOLTAGE" in types and "LINE_OVERLOAD" in types
    ov = [v for v in vs if v.type == "OVERVOLTAGE"]
    assert max(v.value for v in ov) > 1.05


def test_undervoltage_and_trafo_overload_detected():
    net = new_net()
    net.load["scaling"] = 1.1
    vs = check_step(run_pf(net), NetMeta.from_net(net), Constraints())
    types = {v.type for v in vs}
    assert "UNDERVOLTAGE" in types and "TRAFO_OVERLOAD" in types


def test_excessive_losses_warning():
    net = new_net()
    vs = check_step(run_pf(net), NetMeta.from_net(net), Constraints(loss_pct_max=0.1))
    loss = [v for v in vs if v.type == "EXCESSIVE_LOSSES"]
    assert loss and loss[0].severity == "WARNING" and not loss[0].hard


def test_islanded_bus_detected():
    net = new_net()
    apply_switch_states(net, {"SW 5-6": False})  # bus 6 cut off, S2 open
    assert 6 in unsupplied_buses(net)
    vs = check_step(run_pf(net), NetMeta.from_net(net), Constraints())
    assert any(v.type == "ISLANDED_BUS" and v.id == 6 for v in vs)


def test_switch_enumeration_rejects_islanding_and_meshes():
    net = new_net()
    configs = enumerate_configs(net)
    assert len(configs) == 2 ** len(SWITCHABLE_NAMES)
    reasons = {(c.reason or "ok").split(":")[0] for c in configs}
    assert reasons == {"ok", "islanding", "meshed"}
    valid = [c for c in configs if c.reason is None]
    assert any(c.switch_ops == 0 for c in valid)
    # enumeration must not change the net's switch states
    assert is_radial(net)


def test_summarize_structure():
    net = new_net()
    net.load["scaling"] = 0.4
    pp.create_sgen(net, 11, p_mw=8.0)
    meta = NetMeta.from_net(net)
    vs = check_step(run_pf(net), meta, Constraints())
    s = summarize(["12:00", "12:15"], [vs, vs])
    assert s["status"] == "VIOLATION" and s["worst_step"] in ("12:00", "12:15")
    ov = next(v for v in s["violations"] if v["type"] == "OVERVOLTAGE")
    assert ov["steps"] == ["12:00", "12:15"] and ov["limit"] == 1.05
