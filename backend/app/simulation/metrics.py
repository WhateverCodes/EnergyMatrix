"""Window-level metrics computed from QSTS step records (energies in MWh, dt = 15 min)."""
from __future__ import annotations

from app.config import STEP_HOURS
from app.simulation.qsts import QSTSResult


def compute_metrics(res: QSTSResult, switch_ops: int = 0) -> dict:
    recs = res.records
    conv = [r for r in recs if r.converged]
    dt = STEP_HOURS
    pv_avail = sum(r.pv_avail_mw for r in recs) * dt
    pv_disp = sum(r.pv_dispatched_mw for r in recs) * dt
    curtailed = sum(r.curtailed_mw for r in recs) * dt
    batt_thr = sum(abs(r.battery_p_mw) for r in recs) * dt
    batt_ch = sum(r.battery_p_mw for r in recs if r.battery_p_mw > 0) * dt
    batt_dis = -sum(r.battery_p_mw for r in recs if r.battery_p_mw < 0) * dt
    losses = sum(r.losses_mw for r in conv) * dt
    q = sum(abs(r.pv_q_mvar) for r in recs) * dt
    imports = sum(max(r.ext_grid_p, 0.0) for r in conv) * dt
    exports = sum(max(-r.ext_grid_p, 0.0) for r in conv) * dt
    rev = [max(0.0, -min(r.trafo_p_hv)) for r in conv if r.trafo_p_hv]
    head = res.head_line_pos
    feeder_rev = [max([0.0] + [-r.line_p_from[k] for k in head]) for r in conv if r.line_p_from]
    socs = [r.soc_pct for r in recs if r.soc_pct is not None]
    required = [r.required_curtail_pct for r in recs if r.required_curtail_pct is not None]
    load = sum(r.load_mw for r in recs) * dt
    return {
        "max_v": max((r.max_v for r in conv), default=None),
        "min_v": min((r.min_v for r in conv), default=None),
        "max_line_pct": max((r.max_line for r in conv), default=None),
        "max_trafo_pct": max((r.max_trafo for r in conv), default=None),
        "losses_mwh": round(losses, 5),
        "losses_pct": round(100.0 * losses / load, 3) if load > 0 else None,
        "pv_available_mwh": round(pv_avail, 5),
        "pv_dispatched_mwh": round(pv_disp, 5),
        "curtailed_mwh": round(curtailed, 5),
        "curtailed_pct": round(100.0 * curtailed / pv_avail, 3) if pv_avail > 0 else 0.0,
        "max_step_curtail_pct": max((r.curtail_pct for r in recs), default=0.0),
        "max_required_curtail_pct": max(required) if required else None,
        "renewable_utilization_pct": round(100.0 * pv_disp / pv_avail, 3) if pv_avail > 0 else None,
        "battery_throughput_mwh": round(batt_thr, 5),
        "battery_charged_mwh": round(batt_ch, 5),
        "battery_discharged_mwh": round(batt_dis, 5),
        "soc_start_pct": socs[0] if socs else None,
        "soc_end_pct": socs[-1] if socs else None,
        "soc_max_pct": max(socs) if socs else None,
        "soc_min_pct": min(socs) if socs else None,
        "reactive_mvarh": round(q, 5),
        "switch_ops": int(switch_ops),
        "import_mwh": round(imports, 4),
        "export_mwh": round(exports, 4),
        "peak_reverse_flow_mw": round(max(rev), 4) if rev else 0.0,
        "peak_feeder_reverse_flow_mw": round(max(feeder_rev), 4) if feeder_rev else 0.0,
        "load_mwh": round(load, 4),
        "n_steps": len(recs),
        "n_violation_steps": sum(1 for r in recs if r.status != "SAFE"),
        "n_nonconverged_steps": sum(1 for r in recs if not r.converged),
        "n_powerflows": res.n_powerflows,
    }
