# PROGRESS

Resume protocol: read this file and `docs/PROJECT_BRIEF.md`, continue from the first unchecked phase.

| Phase | Deliverable | Gate | Status |
|---|---|---|---|
| 0 | Repo skeleton, brief, CLAUDE.md, Makefile, venv, pinned versions, `/api/health`, Vite boots | `make test` runs | DONE |
| 1 | Network factory, single-step PF, constraint engine, topology, storage sign test | unit tests; docs/simulation.md started | DONE |
| 2 | Kaggle adapter (+ synthetic fallback), CSV adapter, 8 load profiles, mapping | parsing/timestamp/gap/profile tests | DONE |
| 3 | QSTS engine with SOC coupling, metrics | SOC limits + efficiency tests | DONE |
| 4 | Calibration script, hosting capacity | calibration.json produced + documented | |
| 5 | Actions A1–A5, evaluator, objective, infeasibility, explanations | per-action tests; baseline immutability | DONE |
| 6 | Scenario library S1–S8 | acceptance tests for all outcome classes | |
| 7 | FastAPI endpoints, SQLite, error handling | integration tests S2 + S6 | |
| 8 | Frontend: Builder, Grid Twin, Heal & Verify | P0 path; component tests | |
| 9 | Live Lab sliders + debounce | snapshot latency logged | |
| 10 | Forecast backtest + predictive + S7/S8 UI | honest metrics; S7 PLAN_FAILED_ON_ACTUALS | |
| 11 | What-If parser, history/compare, hosting view, upload UI | parser tests (10+ phrasings) | |
| 12 | Polish, demo_check.py, docs, README | `make demo-check` passes | |

## Log

### Phase 0 — done
Skeleton, brief, CLAUDE.md, Makefile, dev.sh, venv (py3.11), pinned requirements, /api/health, Vite app builds, vitest + pytest run.

### Phase 1 — done
network_factory (CIGRE MV + 4 sectionalizers, cached template), powerflow (PowerFlowRunner with recycle, NON_CONVERGENCE), constraints (all 8 types, severity, summarize), topology (128 configs → 17 radial). 13 unit tests pass incl. storage + trafo sign conventions.

### Phase 2 — done
datasets/ (base schema + validator, SolarKaggleAdapter with per-file date format detection, inverter aggregation, gap handling; SyntheticClearSkyAdapter; generic CSV upload with mapping/validation report; LoadDatasetAdapter; registry), load_profiles (8 deterministic profiles), simulation/mapping.py (ScenarioConfig → ScenarioInputs on a working net copy). 27 tests pass.

### Phase 3 — done
qsts.py (StepControl/StepContext/levers, SOC dynamics with sqrt(eta) split, clamps to SOC/p_max, authoritative final PF per step), metrics.py (energies, utilization, reverse flow incl. feeder head). 21-step window ≈ 0.18 s warm. 33 tests pass.
Note: phase 5 built before phase 4 (calibration depends on actions).

### Phase 5 — done (before phase 4)
actions/ base (bisect_min w/ non-monotone guard), battery, reactive, curtailment (capped, required always reported), switching (128→17 radial, screened), combined (ordered); evaluator (independent copies, process pool, cache, re-rank by weights), objective (lexicographic + J), infeasibility (per-candidate why + minimum intervention), explain/templates. 45 tests pass. Warm evaluation 7–9 s.
Findings: switching (2 ops) is very effective on CIGRE feeder 1; mult≈70 w/o battery → infeasible (≈42 % curtailment needed vs 20 % cap).
