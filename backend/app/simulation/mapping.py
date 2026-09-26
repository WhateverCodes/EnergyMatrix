"""Maps generation and demand profiles onto elements of a working copy of the CIGRE MV net.

- All PV sgens follow  available_MW(t) = generation_pu(t) x rating x pv_scale  (x cloud factor, actuals only).
  CIGRE PV rating = nominal p_mw x pv_multiplier. Optional rooftop PV cluster (user MW) at a chosen bus.
  Inverter apparent rating = 1.1 x PV rating (config.INVERTER_S_OVERSIZE).
- Wind (WKA 7) held at 0 MW.
- Background loads: 'Load R*' follow the Residential Society shape, 'Load CI*' the Commercial Building
  shape, both normalized to their peak and applied to nominal CIGRE magnitudes.
- The selected consumer profile is ADDED as a separate load "Consumer: <name>" at the target bus
  (kW from the profile x consumer_scale).
- demand_scale multiplies every load. Q = P x tan(acos(0.95)) (0.95 lagging).
- Battery: one storage element at the configured bus.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import pandapower as pp

from app.config import INVERTER_S_OVERSIZE, LOAD_POWER_FACTOR, STEP_MINUTES
from app.datasets.registry import default_solar_dataset_id, get_dataset
from app.errors import ApiError
from app.load_profiles import profiles
from app.schemas.scenario import CloudEvent, ScenarioConfig
from app.simulation.network_factory import new_net
from app.simulation.topology import apply_switch_states

TAN_PHI = math.tan(math.acos(LOAD_POWER_FACTOR))
BACKGROUND_RES = "residential_society"
BACKGROUND_CI = "commercial_building"


@dataclass
class BatteryParams:
    storage_idx: int
    bus: int
    p_max_mw: float
    e_max_mwh: float
    soc_min: float  # fraction
    soc_max: float
    soc_init: float
    eta_c: float
    eta_d: float


@dataclass
class ScenarioInputs:
    config: ScenarioConfig
    timestamps: pd.DatetimeIndex
    labels: list[str]
    net: pp.pandapowerNet
    pv_idx: list[int]
    pv_rating_mw: np.ndarray
    pv_s_mva: np.ndarray
    pv_avail: np.ndarray  # steps x n_pv, MW (actual, incl. cloud event)
    load_idx: list[int]
    load_p: np.ndarray  # steps x n_load, MW
    load_q: np.ndarray
    battery: BatteryParams | None
    generation_pu: np.ndarray
    dataset_meta: dict
    honesty: dict = field(default_factory=dict)

    @property
    def n_steps(self) -> int:
        return len(self.timestamps)

    def with_pv_avail(self, pv_avail: np.ndarray) -> "ScenarioInputs":
        c = ScenarioInputs(**{**self.__dict__})
        c.pv_avail = pv_avail
        return c


def window_timestamps(date: str, start: str, end: str) -> pd.DatetimeIndex:
    t0 = pd.Timestamp(f"{date} {start}")
    t1 = pd.Timestamp(f"{date} {end}")
    if t1 < t0:
        raise ApiError("BAD_WINDOW", f"end {end} is before start {start}")
    return pd.date_range(t0, t1, freq=f"{STEP_MINUTES}min")


def cloud_factor(timestamps: pd.DatetimeIndex, ev: CloudEvent | None) -> np.ndarray:
    """Deterministic trapezoidal dip over [start, start + duration): full loss `depth` in the
    middle half, linear ramps in the first and last quarter."""
    f = np.ones(len(timestamps))
    if ev is None:
        return f
    t0 = timestamps[0].normalize() + pd.Timedelta(ev.start + ":00")
    dur = pd.Timedelta(minutes=ev.duration_min)
    for i, t in enumerate(timestamps):
        if t0 <= t < t0 + dur:
            x = (t - t0) / dur  # 0..1
            ramp = min(1.0, x / 0.25, (1.0 - x) / 0.25) if ev.duration_min >= 60 else 1.0
            f[i] = 1.0 - ev.depth * max(ramp, 0.0)
    return f


def generation_profile(cfg: ScenarioConfig, ts: pd.DatetimeIndex) -> tuple[np.ndarray, dict]:
    ds_id = cfg.dataset_id or default_solar_dataset_id()
    ds = get_dataset(ds_id)
    df = ds.load().set_index("timestamp")
    missing = ts.difference(df.index)
    if len(missing):
        raise ApiError("DATA_OUT_OF_RANGE", f"{len(missing)} timestamps outside dataset '{ds_id}' coverage",
                       details={"coverage": [ds.meta.coverage_start, ds.meta.coverage_end], "first_missing": str(missing[0])})
    sub = df.loc[ts]
    if (sub["quality_flag"] == "long_gap").any() or sub["generation_pu"].isna().any():
        bad = sub.index[(sub["quality_flag"] == "long_gap") | sub["generation_pu"].isna()]
        raise ApiError("DATA_GAP", f"Window contains {len(bad)} steps inside a long data gap; choose another date/window",
                       details={"steps": [t.strftime("%H:%M") for t in bad]})
    return sub["generation_pu"].to_numpy(dtype=float), ds.meta.to_dict()


def build_inputs(cfg: ScenarioConfig, gen_pu_override: np.ndarray | None = None) -> ScenarioInputs:
    if cfg.consumer_profile not in profiles.PROFILES:
        raise ApiError("UNKNOWN_PROFILE", f"Unknown consumer profile '{cfg.consumer_profile}'",
                       details={"available": sorted(profiles.PROFILES)})
    ts = window_timestamps(cfg.date, cfg.start, cfg.end)
    gen_pu, ds_meta = generation_profile(cfg, ts)
    if gen_pu_override is not None:
        gen_pu = np.asarray(gen_pu_override, dtype=float)

    net = new_net()
    n_bus = len(net.bus)
    for b in (cfg.rooftop_cluster_bus, cfg.target_bus, cfg.battery.bus):
        if b not in net.bus.index or net.bus.at[b, "vn_kv"] > 100:
            raise ApiError("BAD_BUS", f"Bus {b} is not a 20 kV feeder bus", details={"valid": list(range(1, n_bus))})

    # --- PV
    pv_mask = net.sgen["type"] == "PV"
    net.sgen.loc[pv_mask, "p_mw"] = net.sgen.loc[pv_mask, "p_mw"] * cfg.pv_multiplier
    net.sgen.loc[pv_mask, "sn_mva"] = net.sgen.loc[pv_mask, "p_mw"] * INVERTER_S_OVERSIZE
    if cfg.rooftop_cluster_mw > 0:
        pp.create_sgen(net, cfg.rooftop_cluster_bus, p_mw=cfg.rooftop_cluster_mw, q_mvar=0.0,
                       sn_mva=cfg.rooftop_cluster_mw * INVERTER_S_OVERSIZE, name="Rooftop PV cluster", type="PV")
    pv_idx = [int(i) for i in net.sgen.index[net.sgen["type"] == "PV"]]
    rating = net.sgen.loc[pv_idx, "p_mw"].to_numpy(dtype=float)
    s_mva = net.sgen.loc[pv_idx, "sn_mva"].to_numpy(dtype=float)
    cloud = cloud_factor(ts, cfg.cloud_event)
    pv_avail = np.outer(gen_pu * cfg.pv_scale * cloud, rating)

    # --- loads
    res_shape = profiles.normalized(BACKGROUND_RES, ts)
    ci_shape = profiles.normalized(BACKGROUND_CI, ts)
    base_p = net.load["p_mw"].to_numpy(dtype=float)
    is_ci = net.load["name"].str.contains("CI").to_numpy()
    load_p = np.where(is_ci[None, :], np.outer(ci_shape, base_p), np.outer(res_shape, base_p))
    consumer_kw = profiles.demand_kw(cfg.consumer_profile, ts, cfg.consumer_scale, cfg.noise_seed)
    pp.create_load(net, cfg.target_bus, p_mw=0.0, q_mvar=0.0,
                   name=f"Consumer: {profiles.PROFILES[cfg.consumer_profile].name}")
    load_p = np.column_stack([load_p, consumer_kw / 1000.0]) * cfg.demand_scale
    load_idx = [int(i) for i in net.load.index]
    net.load["scaling"] = 1.0

    # --- battery
    battery = None
    if cfg.battery.enabled and cfg.battery.p_max_mw > 0:
        b = cfg.battery
        s = pp.create_storage(net, b.bus, p_mw=0.0, max_e_mwh=b.e_max_mwh, soc_percent=b.soc_init_pct,
                              min_e_mwh=b.e_max_mwh * b.soc_min_pct / 100.0, sn_mva=b.p_max_mw, name="Battery")
        eta = math.sqrt(b.eta_rt)
        battery = BatteryParams(storage_idx=int(s), bus=b.bus, p_max_mw=b.p_max_mw, e_max_mwh=b.e_max_mwh,
                                soc_min=b.soc_min_pct / 100.0, soc_max=b.soc_max_pct / 100.0,
                                soc_init=b.soc_init_pct / 100.0, eta_c=eta, eta_d=eta)

    # --- topology
    if cfg.switch_states:
        apply_switch_states(net, cfg.switch_states)
    for li in cfg.lines_out_of_service:
        if li not in net.line.index:
            raise ApiError("BAD_LINE", f"Line {li} does not exist")
        net.line.at[li, "in_service"] = False

    ds_is_real = bool(ds_meta.get("is_real"))
    honesty = {
        "generation": (f"REAL DATA · {ds_meta['name']} (scaled)" if ds_is_real else f"SYNTHETIC · {ds_meta['name']}"),
        "generation_is_real": ds_is_real,
        "generation_label": ds_meta.get("label", ""),
        "consumption": "SYNTHETIC CONSUMER SCENARIO",
        "network": "BENCHMARK FEEDER · CIGRE MV",
        "results": "SIMULATED RESULTS",
        "cloud_event": "SYNTHETIC cloud event applied to actuals" if cfg.cloud_event else None,
    }
    return ScenarioInputs(
        config=cfg, timestamps=ts, labels=[t.strftime("%H:%M") for t in ts], net=net,
        pv_idx=pv_idx, pv_rating_mw=rating, pv_s_mva=s_mva, pv_avail=pv_avail,
        load_idx=load_idx, load_p=load_p, load_q=load_p * TAN_PHI, battery=battery,
        generation_pu=gen_pu, dataset_meta=ds_meta, honesty=honesty,
    )


def scenario_summary(inp: ScenarioInputs) -> dict:
    gen = inp.pv_avail.sum(axis=1)
    dem = inp.load_p.sum(axis=1)
    feeder_mask = ~np.isin(inp.net.load.loc[inp.load_idx, "bus"].to_numpy(), [1, 12])
    dem_feeder = inp.load_p[:, feeder_mask].sum(axis=1)
    return {
        "timestamps": [t.isoformat() for t in inp.timestamps],
        "labels": inp.labels,
        "generation_mw": gen.round(4).tolist(),
        "generation_pu": inp.generation_pu.round(4).tolist(),
        "demand_mw": dem.round(4).tolist(),
        "demand_feeder_mw": dem_feeder.round(4).tolist(),
        "net_surplus_mw": (gen - dem).round(4).tolist(),
        "net_surplus_feeder_mw": (gen - dem_feeder).round(4).tolist(),
        "installed_pv_mw": round(float(inp.pv_rating_mw.sum()), 4),
        "energy": {
            "generation_mwh": round(float(gen.sum() * STEP_MINUTES / 60), 4),
            "demand_mwh": round(float(dem.sum() * STEP_MINUTES / 60), 4),
            "demand_feeder_mwh": round(float(dem_feeder.sum() * STEP_MINUTES / 60), 4),
        },
        "honesty": inp.honesty,
        "dataset": inp.dataset_meta,
        "notes": [
            "Buses 1 and 12 carry ~20 MW of aggregated CIGRE substation load each; 'feeder' figures exclude them.",
            "Demand is a synthetic schedule (no ML forecast of synthetic profiles).",
        ],
    }
