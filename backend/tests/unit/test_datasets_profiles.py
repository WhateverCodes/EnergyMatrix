import json

import numpy as np
import pandas as pd
import pytest

from app.datasets.base import validate_normalized
from app.datasets.csv_generic import ColumnMapping, UploadedCsvAdapter, parse_upload, to_kw
from app.datasets.load_adapter import LoadDatasetAdapter
from app.datasets.registry import all_datasets
from app.datasets.solar_kaggle import SolarKaggleAdapter, aggregate_inverters, detect_datetime_format, fill_gaps
from app.datasets.synthetic_clearsky import SyntheticClearSkyAdapter
from app.load_profiles import profiles
from app.schemas.scenario import CloudEvent, ScenarioConfig
from app.simulation.mapping import build_inputs, cloud_factor, scenario_summary, window_timestamps

KAGGLE = SolarKaggleAdapter.files_present()
needs_kaggle = pytest.mark.skipif(not KAGGLE, reason="Kaggle files not present")


def test_detect_both_date_formats():
    assert detect_datetime_format(pd.Series(["15-05-2020 00:00", "17-06-2020 23:45"])) == "%d-%m-%Y %H:%M"
    assert detect_datetime_format(pd.Series(["2020-05-15 00:00:00"])) == "%Y-%m-%d %H:%M:%S"
    with pytest.raises(ValueError):
        detect_datetime_format(pd.Series(["May 15th"]))


def test_aggregate_inverters_scales_for_missing():
    t = pd.Timestamp("2020-05-15 12:00")
    t2 = t + pd.Timedelta(minutes=15)
    gen = pd.DataFrame({"timestamp": [t, t, t2], "SOURCE_KEY": ["a", "b", "a"], "AC_POWER": [100.0, 200.0, 150.0]})
    agg = aggregate_inverters(gen)
    assert agg.loc[t, "ac_kw"] == 300.0 and not agg.loc[t, "missing_inverters"]
    assert agg.loc[t2, "ac_kw"] == 300.0 and agg.loc[t2, "missing_inverters"]  # 150 per inverter x 2


def test_fill_gaps_short_vs_long():
    s = pd.Series([1.0, np.nan, np.nan, 4.0] + [np.nan] * 6 + [10.0])
    filled, interp, long = fill_gaps(s, max_steps=4)
    assert filled[1] == pytest.approx(2.0) and filled[2] == pytest.approx(3.0)
    assert interp.sum() == 2
    assert long.sum() == 6 and filled[4:10].isna().all()


@needs_kaggle
@pytest.mark.parametrize("plant", [1, 2])
def test_kaggle_adapter_normalized(plant):
    a = SolarKaggleAdapter(plant)
    df = a.load()
    assert validate_normalized(df) == []
    assert len(df) == 34 * 96
    assert df["timestamp"].iloc[0] == pd.Timestamp("2020-05-15 00:00")
    assert df["generation_pu"].between(0, 1).all() or df["generation_pu"].isna().any()
    night = df[df["timestamp"].dt.hour == 2]
    assert (night["generation_kw"].fillna(0) == 0).all()
    assert df.attrs["n_inverters"] == 22


@needs_kaggle
def test_kaggle_capacity_is_percentile_estimate():
    a = SolarKaggleAdapter(1)
    a.fill_meta()
    df = a.load()
    assert a.meta.capacity_kw == pytest.approx(np.nanpercentile(df["generation_kw"], 99.5))
    assert a.meta.is_real


def test_synthetic_is_labelled_not_real():
    s = SyntheticClearSkyAdapter()
    df = s.load()
    assert not s.meta.is_real and "SYNTHETIC" in s.meta.label
    assert validate_normalized(df) == []
    noon = df[df["timestamp"] == pd.Timestamp("2020-05-15 12:15")]["generation_pu"].iloc[0]
    assert noon > 0.5
    assert df[df["timestamp"].dt.hour == 3]["generation_pu"].max() == 0


def test_registry_always_has_synthetic():
    ds = all_datasets()
    assert "synthetic_clearsky" in ds
    assert ("kaggle_plant1" in ds) == KAGGLE


def test_unit_conversion():
    assert to_kw(pd.Series([1000.0]), "W").iloc[0] == 1.0
    assert to_kw(pd.Series([2.0]), "MW").iloc[0] == 2000.0
    with pytest.raises(ValueError):
        to_kw(pd.Series([1.0]), "GW")


def test_csv_upload_validation_and_resample(tmp_path):
    ts = pd.date_range("2021-01-01", periods=48, freq="30min")
    vals = np.clip(np.sin(np.linspace(0, np.pi, 48)), 0, None) * 500.0
    vals[10] = np.nan
    csv = pd.DataFrame({"time": ts, "power_w": vals * 1000}).to_csv(index=False).encode()
    rep, df = parse_upload(csv, ColumnMapping("time", "power_w", "W", "solar", "Test Roof"), out_dir=tmp_path)
    assert rep.ok and rep.missing_values == 1
    assert rep.detected_resolution_min == 30.0
    assert validate_normalized(df) == []
    assert df["generation_kw"].max() == pytest.approx(500.0, rel=0.01)
    a = UploadedCsvAdapter(tmp_path / f"{rep.dataset_id}.meta.json")
    assert len(a.load()) == len(df)
    bad, _ = parse_upload(csv, ColumnMapping("nope", "power_w"), out_dir=tmp_path)
    assert not bad.ok and "not found" in bad.errors[0]
    garbage, _ = parse_upload(b"\x00\x01not,a\ncsv", ColumnMapping("a", "b"), out_dir=tmp_path)
    assert not garbage.ok


def test_load_dataset_adapter(tmp_path):
    ts = pd.date_range("2021-01-01", periods=96, freq="15min")
    csv = pd.DataFrame({"t": ts, "kw": np.linspace(100, 200, 96)}).to_csv(index=False).encode()
    rep, _ = parse_upload(csv, ColumnMapping("t", "kw", "kW", "load", "Feeder load"), out_dir=tmp_path)
    inner = UploadedCsvAdapter(tmp_path / f"{rep.dataset_id}.meta.json")
    la = LoadDatasetAdapter(inner)
    out = la.load()
    assert list(out.columns) == ["timestamp", "dataset_id", "load_kw", "load_pu", "quality_flag"]
    with pytest.raises(ValueError):
        LoadDatasetAdapter(SyntheticClearSkyAdapter())


def test_profiles_deterministic_and_shaped():
    assert len(profiles.PROFILES) == 8
    ts = pd.date_range("2020-05-20", periods=96, freq="15min")  # Wednesday
    for key in profiles.PROFILES:
        a, b = profiles.demand_kw(key, ts), profiles.demand_kw(key, ts)
        assert np.array_equal(a, b)
        p = profiles.PROFILES[key]
        assert a.min() >= p.base_kw - 1e-9 and a.max() <= p.peak_kw + 1e-9
    rs = profiles.day_series("residential_society", "2020-05-20").set_index("timestamp")["demand_kw"]
    assert rs.idxmax().hour in range(18, 23)
    fac = profiles.demand_kw("small_factory", ts)
    assert fac[12 * 4] > 5 * fac[2 * 4]  # noon plateau >> 2 am
    sat = pd.date_range("2020-05-23", periods=96, freq="15min")
    assert profiles.demand_kw("small_factory", sat).max() == pytest.approx(fac.max() * 0.3)
    n1 = profiles.demand_kw("hospital", ts, noise_seed=3)
    assert np.array_equal(n1, profiles.demand_kw("hospital", ts, noise_seed=3))
    assert not np.array_equal(n1, profiles.demand_kw("hospital", ts))


def test_window_and_cloud_factor():
    ts = window_timestamps("2020-05-25", "10:00", "15:00")
    assert len(ts) == 21
    f = cloud_factor(ts, CloudEvent(start="12:00", duration_min=60, depth=0.8))
    labels = [t.strftime("%H:%M") for t in ts]
    assert f[labels.index("12:30")] == pytest.approx(0.2)
    assert f[labels.index("11:45")] == 1.0 and f[labels.index("13:00")] == 1.0


def test_mapping_builds_inputs():
    cfg = ScenarioConfig(pv_multiplier=10, rooftop_cluster_mw=3.0, rooftop_cluster_bus=11,
                         consumer_profile="small_factory", target_bus=9, consumer_scale=2.0)
    inp = build_inputs(cfg)
    assert inp.n_steps == 21
    assert inp.pv_avail.shape == (21, 9)  # 8 CIGRE PV + cluster
    assert inp.pv_rating_mw.sum() == pytest.approx(0.21 * 10 + 3.0)  # CIGRE PV nominal total = 0.21 MW
    assert inp.load_p.shape == (21, 19)  # 18 CIGRE + consumer
    assert inp.net.load.iloc[-1]["bus"] == 9 and "Small Factory" in inp.net.load.iloc[-1]["name"]
    assert inp.battery is not None and inp.battery.eta_c == pytest.approx(0.92 ** 0.5)
    assert np.allclose(inp.load_q / np.where(inp.load_p == 0, 1, inp.load_p), np.tan(np.arccos(0.95)))
    s = scenario_summary(inp)
    assert len(s["generation_mw"]) == 21 and s["honesty"]["consumption"] == "SYNTHETIC CONSUMER SCENARIO"
    json.dumps(s)
    # template not mutated
    from app.simulation.network_factory import get_template
    assert len(get_template().load) == 18 and len(get_template().storage) == 0
