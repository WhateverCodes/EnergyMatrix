"""Executes the 22-step final demo (docs/PROJECT_BRIEF.md §15) through the API and asserts each step.

Default: in-process (FastAPI TestClient) with a temporary SQLite DB — no server needed.
Against a running backend:  python scripts/demo_check.py --url http://localhost:8000

Prints a PASS/FAIL table; exit code 1 if any step fails.
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))


class Http:
    def __init__(self, url: str):
        import httpx
        self.c = httpx.Client(base_url=url, timeout=300)

    def get(self, path, **kw):
        return self.c.get(path, **kw)

    def post(self, path, **kw):
        return self.c.post(path, **kw)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="base URL of a running backend (default: in-process)")
    args = ap.parse_args()
    ctx = None
    if args.url:
        client = Http(args.url)
    else:
        os.environ.setdefault("GRIDTWIN_DB", os.path.join(tempfile.mkdtemp(prefix="gridtwin-demo-"), "demo.db"))
        from fastapi.testclient import TestClient

        from app.main import app
        ctx = TestClient(app, raise_server_exceptions=False)
        client = ctx.__enter__()

    rows: list[tuple[int, str, bool, str, float]] = []
    state: dict = {}

    def step(n: int, name: str, fn):
        t = time.perf_counter()
        try:
            detail = fn() or ""
            ok = True
        except AssertionError as exc:
            ok, detail = False, f"assertion failed: {exc}"
        except Exception as exc:  # report, keep going
            ok, detail = False, f"{type(exc).__name__}: {exc}"
        rows.append((n, name, ok, str(detail), time.perf_counter() - t))

    def j(r):
        assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:200]}"
        return r.json()

    def s1():
        assert j(client.get("/api/health"))["status"] == "ok"
        lib = j(client.get("/api/scenarios/library"))
        assert [s["id"] for s in lib] == [f"S{i}" for i in range(1, 9)]
        state["lib"] = {s["id"]: s for s in lib}
        return "backend healthy; library S1–S8 loaded"

    def s2():
        ds = j(client.get("/api/datasets"))
        state["ds"] = ds
        assert any(d["source_type"] == "solar" for d in ds)
        return "solar generation source available"

    def s3():
        real = [d for d in state["ds"] if d["id"] == "kaggle_plant1" and d["is_real"]]
        if not real:
            raise AssertionError("Kaggle Plant 1 not found — SYNTHETIC fallback active; place Kaggle CSVs in data/raw/solar_kaggle/")
        return f"REAL Kaggle Plant 1: {real[0]['records']} records, capacity est. {real[0]['capacity_kw']:.0f} kW"

    def s4():
        p = j(client.get("/api/load-profiles/residential_society/series", params={"date": "2020-05-25"}))
        assert len(p["demand_kw"]) == 96 and p["label"] == "Synthetic consumer scenario"
        return f"Residential Society profile, peak {max(p['demand_kw']):.0f} kW (synthetic)"

    def s5():
        n = j(client.get("/api/networks/cigre_mv"))
        assert len(n["buses"]) == 15 and "representative" in n["label"]
        state["net"] = n
        return n["label"]

    def s6():
        cfg = state["lib"]["S1"]["config"]
        assert (cfg["start"], cfg["end"]) == ("10:00", "15:00")
        b = j(client.post("/api/scenarios/build", json=cfg))
        assert len(b["labels"]) == 21 and b["honesty"]["generation"].startswith("REAL DATA")
        state["cfg"] = cfg
        return f"window 10:00–15:00, 21 steps, installed PV {b['installed_pv_mw']:.2f} MW"

    def s7():
        r = j(client.post("/api/simulate/run", json=state["cfg"]))
        assert r["status"] == "SAFE"
        state["run"] = r
        return f"QSTS baseline {r['status']}, {r['metrics']['n_powerflows']} power flows"

    def s8():
        n = state["run"]["network"]
        assert all("x" in b for b in n["buses"]) and len(n["switches"]) >= 7
        return "network with coordinates + switches returned"

    def s9():
        st = state["run"]["steps"]
        assert all(x["pv_avail_mw"] >= 0 and x["feeder_load_mw"] > 0 for x in st)
        return f"PV peak {max(x['pv_avail_mw'] for x in st):.2f} MW vs feeder demand {max(x['feeder_load_mw'] for x in st):.2f} MW"

    def s10():
        m = state["run"]["metrics"]
        assert m["max_v"] <= 1.05 and m["max_line_pct"] <= 100
        return f"max V {m['max_v']:.3f} pu, max line {m['max_line_pct']:.1f}%"

    def s11():
        r = j(client.post("/api/simulate/snapshot", json={"config": state["cfg"], "pv_pct": 300}))
        state["snap"] = r
        return f"Live Lab PV 300% at {r['time']}, latency {r['latency_ms']:.0f} ms"

    def s12():
        r = state["snap"]
        assert r["status"] == "VIOLATION"
        types = sorted({v["type"] for v in r["violations"] if v["hard"]})
        return f"violation appears: {', '.join(types)}"

    def s13():
        cfg = dict(state["cfg"], pv_scale=3.0, name="Demo — PV 300%")
        state["cfg_hot"] = cfg
        ev = j(client.post("/api/actions/evaluate", json={"config": cfg}))
        assert ev["status"] == "FEASIBLE"
        state["ev"] = ev
        return f"{len(ev['candidates'])} candidates simulated; recommended {ev['recommended']}"

    def s14():
        keys = {c["key"] for c in state["ev"]["candidates"] if c["metrics"]}
        need = {"battery", "switching", "reactive", "curtailment", "battery_curtail", "reactive_curtail", "switching_battery", "all_levers"}
        assert need <= keys, f"missing {need - keys}"
        feas = [c["key"] for c in state["ev"]["candidates"] if c["feasible"] and c["key"] != "none"]
        return f"compared battery/switching/reactive/curtailment + 4 combinations; feasible: {', '.join(feas)}"

    def s15():
        ap_ = j(client.post("/api/actions/apply", json={"config": state["cfg_hot"], "candidate_key": state["ev"]["recommended"]}))
        state["ap"] = ap_
        return f"applied {ap_['candidate']['name']}"

    def s16():
        a = state["ap"]
        assert a["verified"] and a["after"]["status"] == "SAFE" and len(a["after"]["steps"]) == 21
        return a["verification"]

    def s17():
        d = state["ap"]["deltas"]
        assert d["max_line_pct"] < 0 and d["n_violation_steps"] < 0
        return f"Δ max line {d['max_line_pct']:+.1f} pts, Δ max V {d['max_v']:+.3f} pu, Δ violation steps {d['n_violation_steps']:+.0f}"

    def s18():
        cfg = dict(state["lib"]["S6"]["config"])
        cfg["battery"] = dict(cfg["battery"], enabled=False)
        state["cfg6"] = cfg
        return "battery disabled"

    def s19():
        r = j(client.post("/api/simulate/run", json=state["cfg6"]))
        assert r["status"] == "VIOLATION" and r["metrics"]["max_line_pct"] > 150
        return f"extreme surplus (PV × {state['cfg6']['pv_multiplier']}): max line {r['metrics']['max_line_pct']:.0f}%, max V {r['metrics']['max_v']:.3f} pu"

    def s20():
        ev = j(client.post("/api/actions/evaluate", json={"config": state["cfg6"]}))
        assert ev["status"] == "NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS"
        assert not any(c["feasible"] for c in ev["candidates"])
        state["ev6"] = ev
        n = sum(1 for c in ev["candidates"] if c["available"] and c["key"] != "none")
        return f"NO FEASIBLE SOLUTION UNDER CURRENT CONSTRAINTS — {n} available candidates simulated, all fail"

    def s21():
        mi = state["ev6"]["infeasibility"]["minimum_intervention"]
        assert mi["required_curtailment_pct"] > mi["cap_pct"] and mi["applied"] is False
        return f"required curtailment {mi['required_curtailment_pct']:.1f}% at {mi['required_curtailment_step']} vs {mi['cap_pct']:.0f}% cap (not applied)"

    def s22():
        sv = j(client.post("/api/history", json={"name": "Demo check — S6 no battery", "config": state["cfg6"]}))
        lst = j(client.get("/api/history"))
        assert any(x["id"] == sv["id"] for x in lst)
        return f"saved scenario #{sv['id']} ({sv['feasibility']})"

    def bonus():
        r = j(client.post("/api/forecast/predictive", json={"scenario_id": "S7"}))
        assert r["outcome"] == "PLAN_FAILED_ON_ACTUALS"
        return f"S7: {r['why']}"

    names = ["Open Scenario Builder", "Solar", "Real Kaggle dataset", "Residential Society", "CIGRE MV feeder",
             "Window 10:00–15:00", "Run", "Network shown", "Generation vs demand", "Voltage / loading",
             "Raise PV in Live Lab", "Violation appears", "Find corrective actions", "Compare actions",
             "Apply recommended", "Re-simulated", "Before / after", "Disable battery", "Extreme surplus",
             "NO FEASIBLE SOLUTION", "Required curtailment vs cap", "Save scenario"]
    fns = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22]
    t0 = time.perf_counter()
    for i, (nm, fn) in enumerate(zip(names, fns), start=1):
        step(i, nm, fn)
    step(23, "Bonus: S7 plan fails on actuals", bonus)
    if ctx is not None:
        ctx.__exit__(None, None, None)

    w = max(len(r[1]) for r in rows)
    print(f"\n{'#':>3}  {'Step':<{w}}  Result  Time   Detail")
    print("-" * (w + 90))
    for n, nm, ok, detail, dt in rows:
        print(f"{n:>3}  {nm:<{w}}  {'PASS' if ok else 'FAIL':<6}  {dt:5.1f}s {detail[:140]}")
    failed = [r for r in rows if not r[2]]
    print("-" * (w + 90))
    print(f"{len(rows) - len(failed)}/{len(rows)} passed in {time.perf_counter() - t0:.1f}s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
