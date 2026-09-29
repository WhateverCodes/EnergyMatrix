"""Acceptance: predictive scenarios S7/S8 land in their outcome classes (classes only, never numbers)."""
from app.forecasting.predictive import run_predictive
from app.scenarios.library import get_scenario, scenario_config


def _run(sid, **over):
    p = get_scenario(sid)["predictive"] | over
    return run_predictive(scenario_config(sid), p["t0"], p["horizon_steps"], p["model"], p["plan_on"])


def test_s7_cloud_event_plan_fails_on_actuals():
    r = _run("S7")
    assert r["outcome"] == "PLAN_FAILED_ON_ACTUALS"
    assert r["replay"]["failing_steps"]
    assert r["why"] and "forecast" in r["why"]
    # the forecast missed the post-cloud recovery: actual above P50 at the first failing step
    k = r["horizon_labels"].index(r["replay"]["failing_steps"][0])
    assert r["actual_pu"][k] > r["forecast"]["p50"][k]


def test_s8_p50_safe_p90_violation():
    r = _run("S8")
    assert r["predicted"]["p50"]["status"] == "SAFE"
    assert r["predicted"]["p90"]["status"] == "VIOLATION"
    assert r["plan"]["candidate"] == "none"  # nothing to do according to P50
    assert r["outcome"] == "PLAN_FAILED_ON_ACTUALS"
