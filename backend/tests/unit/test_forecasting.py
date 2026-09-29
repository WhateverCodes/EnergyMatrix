import numpy as np
import pandas as pd

from app.datasets.synthetic_clearsky import SyntheticClearSkyAdapter
from app.forecasting.features import FEATURES, daylight_mask, make_frame
from app.forecasting.models import fit_hgb, predict


def _frame():
    return make_frame(SyntheticClearSkyAdapter().load(), range(1, 5))


def test_features_use_only_past_information():
    f = _frame()
    row = f[(f["issue"] == pd.Timestamp("2020-05-20 12:00")) & (f["h"] == 2)].iloc[0]
    df = SyntheticClearSkyAdapter().load().set_index("timestamp")["generation_pu"]
    assert row["g_lag1"] == df[pd.Timestamp("2020-05-20 12:00")]
    assert row["g_day"] == df[pd.Timestamp("2020-05-19 12:30")]  # target 12:30 minus one day
    assert row["y"] == df[pd.Timestamp("2020-05-20 12:30")]
    assert set(FEATURES) <= set(f.columns)


def test_daylight_mask_excludes_night():
    f = _frame()
    m = daylight_mask(f)
    night = f["target_time"].dt.hour.isin([0, 1, 2, 3, 22, 23]).to_numpy()
    assert not m[night].any() and m.any()


def test_baselines_and_quantile_ordering():
    f = _frame()
    train, test = f[f["issue"] < "2020-06-05"], f[f["issue"] >= "2020-06-05"]
    qm = fit_hgb(train)
    p = predict("hgb", test.dropna(subset=FEATURES), qm)
    assert np.all(p["p10"] <= p["p50"] + 1e-12) and np.all(p["p50"] <= p["p90"] + 1e-12)
    last = predict("persistence_last", test, None)
    assert np.array_equal(last["p50"], np.clip(test["g_lag1"].to_numpy(), 0, 1.05), equal_nan=True)
