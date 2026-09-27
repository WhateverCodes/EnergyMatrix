"""Full API flow: scenario → power flow → violations → actions → verification (S2 feasible, S6 infeasible)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.scenarios.library import get_scenario


@pytest.fixture(scope="module")
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def test_health_and_config(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    cfg = client.get("/api/config/constraints").json()
    assert cfg["constraints"]["v_max"] == 1.05 and cfg["constraints"]["max_curtailment_pct"] == 20
    assert cfg["weights"]["w_curt"] == 10


def test_network_and_datasets(client):
    net = client.get("/api/networks/cigre_mv").json()
    assert len(net["buses"]) == 15 and any(s["kind"] == "tie" for s in net["switches"])
    assert client.get("/api/networks/ieee13").status_code == 404
    ds = client.get("/api/datasets").json()
    assert any(d["id"] == "synthetic_clearsky" and d["is_real"] is False for d in ds)
    lp = client.get("/api/load-profiles").json()
    assert len(lp) == 8
    ser = client.get("/api/load-profiles/hospital/series", params={"date": "2020-05-20"}).json()
    assert len(ser["demand_kw"]) == 96


def test_errors_have_contract_shape(client):
    r = client.post("/api/scenarios/build", json={"start": "10:07"})
    assert r.status_code == 422 and r.json()["error_code"] == "VALIDATION_ERROR"
    r = client.post("/api/scenarios/build", json={"date": "2019-01-01"})
    body = r.json()
    assert r.status_code == 400 and body["error_code"] == "DATA_OUT_OF_RANGE" and "message" in body and "details" in body
    r = client.post("/api/scenarios/build", json={"target_bus": 0})
    assert r.json()["error_code"] == "BAD_BUS"
    r = client.get("/api/datasets/nope/series")
    assert r.status_code == 404 and "Traceback" not in r.text


def test_s2_flow_feasible_and_verified(client):
    cfg = get_scenario("S2")["config"]
    b = client.post("/api/scenarios/build", json=cfg).json()
    assert len(b["generation_mw"]) == 21 and b["honesty"]["network"].startswith("BENCHMARK")
    run = client.post("/api/simulate/run", json=cfg).json()
    assert run["status"] == "VIOLATION" and len(run["steps"]) == 21 and run["run_id"] >= 1
    ev = client.post("/api/actions/evaluate", json={"config": cfg}).json()
    assert ev["status"] == "FEASIBLE" and "battery" in ev["recommended"]
    ap = client.post("/api/actions/apply", json={"config": cfg, "candidate_key": ev["recommended"]}).json()
    assert ap["verified"] is True and ap["after"]["status"] == "SAFE" and ap["before"]["status"] == "VIOLATION"
    assert ap["deltas"]["max_line_pct"] < 0
    # weight change re-ranks from cache (no re-simulation)
    ev2 = client.post("/api/actions/evaluate", json={"config": cfg, "weights": {"w_curt": 10, "w_batt": 50, "w_sw": 0.1,
                                                                                 "w_loss": 1, "w_q": 0.2}}).json()
    assert ev2["evaluation_id"] == ev["evaluation_id"] and ev2["recommended"] != ev["recommended"]


def test_s6_flow_infeasible_and_saved(client):
    cfg = get_scenario("S6")["config"]
    ev = client.post("/api/actions/evaluate", json={"config": cfg}).json()
    assert ev["status"] == "NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS" and ev["recommended"] is None
    mi = ev["infeasibility"]["minimum_intervention"]
    assert mi["required_curtailment_pct"] > 20
    ap = client.post("/api/actions/apply", json={"config": cfg, "candidate_key": "all_levers"}).json()
    assert ap["verified"] is False
    saved = client.post("/api/history", json={"name": "S6 demo", "config": cfg}).json()
    assert saved["feasibility"] == "NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS"
    s2 = client.post("/api/history", json={"name": "S1 demo", "config": get_scenario("S1")["config"]}).json()
    lst = client.get("/api/history").json()
    assert {x["id"] for x in lst} >= {saved["id"], s2["id"]}
    cmp = client.get("/api/history/compare", params={"a": saved["id"], "b": s2["id"]}).json()
    assert any(r["metric"] == "max_v" for r in cmp["rows"])
    assert client.get("/api/history/99999").status_code == 404


def test_snapshot_live_lab(client):
    cfg = get_scenario("S1")["config"]
    r = client.post("/api/simulate/snapshot", json={"config": cfg}).json()
    assert r["status"] == "SAFE" and r["preview"] is None
    hot = client.post("/api/simulate/snapshot", json={"config": cfg, "pv_pct": 300}).json()
    assert hot["status"] == "VIOLATION" and hot["preview"] is None
    prev = client.post("/api/simulate/snapshot", json={"config": cfg, "pv_pct": 300, "include_preview": True}).json()
    assert prev["preview"] is not None and prev["preview"]["curtail_pct"] <= 20.0
    assert hot["kpis"]["max_v"] > r["kpis"]["max_v"]
    bad = client.post("/api/simulate/snapshot", json={"config": cfg, "time": "03:00"})
    assert bad.json()["error_code"] == "BAD_TIME"
    lat = client.get("/api/simulate/latency").json()
    assert lat["n"] >= 2


def test_hosting_capacity(client):
    r = client.get("/api/hosting-capacity", params={"pv_multiplier": 20}).json()
    assert len(r["buses"]) == 14 and r["worst_case"]["max_pv_step"]


def test_forecast_endpoints(client):
    bt = client.get("/api/forecast/backtest", params={"horizon": 4}).json()
    assert set(bt["metrics"]) == {"persistence_day", "persistence_last", "rolling_mean", "hgb"}
    assert "ML" in bt["verdict"] and len(bt["series"]["actual"]) == len(bt["series"]["hgb_p90"])
    s7 = client.post("/api/forecast/predictive", json={"scenario_id": "S7"}).json()
    assert s7["outcome"] == "PLAN_FAILED_ON_ACTUALS"
    bad = client.post("/api/forecast/predictive", json={"scenario_id": "S7", "model": "gpt"})
    assert bad.json()["error_code"] == "UNKNOWN_MODEL"
