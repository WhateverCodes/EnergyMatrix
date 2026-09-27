# PROGRESS

Resume protocol: read this file and `docs/PROJECT_BRIEF.md`, continue from the first unchecked phase.

| Phase | Deliverable | Gate | Status |
|---|---|---|---|
| 0 | Repo skeleton, brief, CLAUDE.md, Makefile, venv, pinned versions, `/api/health`, Vite boots | `make test` runs | DONE |
| 1 | Network factory, single-step PF, constraint engine, topology, storage sign test | unit tests; docs/simulation.md started | DONE |
| 2 | Kaggle adapter (+ synthetic fallback), CSV adapter, 8 load profiles, mapping | parsing/timestamp/gap/profile tests | DONE |
| 3 | QSTS engine with SOC coupling, metrics | SOC limits + efficiency tests | DONE |
| 4 | Calibration script, hosting capacity | calibration.json produced + documented | DONE |
| 5 | Actions A1–A5, evaluator, objective, infeasibility, explanations | per-action tests; baseline immutability | DONE |
| 6 | Scenario library S1–S8 | acceptance tests for all outcome classes | DONE (S7/S8 added in phase 10) |
| 7 | FastAPI endpoints, SQLite, error handling | integration tests S2 + S6 | DONE |
| 8 | Frontend: Builder, Grid Twin, Heal & Verify | P0 path; component tests | DONE |
| 9 | Live Lab sliders + debounce | snapshot latency logged | DONE |
| 10 | Forecast backtest + predictive + S7/S8 UI | honest metrics; S7 PLAN_FAILED_ON_ACTUALS | DONE |
| 11 | What-If parser, history/compare, hosting view, upload UI | parser tests (10+ phrasings) | DONE |
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

### Phase 4 — done
scripts/calibrate.py (≈80 s): thresholds mult 42 / 46 / 52 / 80 (see docs/simulation.md §6); hosting_capacity.py (per-bus bisection, cached). calibration.json written.

### Phase 6 — S1–S6 done
simulation/scenarios/S1..S8.json with rationale relative to calibration thresholds; scenarios/library.py; tests/acceptance/test_scenarios.py (S1–S6 outcome classes, 7 tests, ~35 s). S7/S8 predictive acceptance pending phase 10.

### Phase 7 — done
api/core.py (config, networks, datasets + upload, load profiles, scenario build, library), api/simulate.py (run, snapshot + latency, actions evaluate/apply, hosting capacity, history save/list/get/compare), db/models.py (5 tables), global error contract, lifespan warm-up. 59 backend tests pass (~47 s).

### Phase 8 — done
Frontend: Shell + data-honesty strip, Scenario Builder (library dropdown, 3 columns, backend summary bar), Grid Twin (SVG single-line diagram from CIGRE geodata, scrubber/play, inspector, 4 charts, violation list), Heal & Verify (candidate table, weight sliders re-rank via backend cache, APPLY → before/after with two diagrams, infeasible panel, save). Vitest: comparison table, infeasible panel, debounce (4 tests). P0 path verified headless in Chrome (playwright-core, scratchpad script): Builder S1 → Run → Grid → Live Lab PV 300% → violation → full evaluation → apply → S6 NO FEASIBLE (35.9% vs 20% cap) → saved; zero console errors.

### Phase 9 — done
Live Lab: 7 sliders (PV %, demand %, consumer scale, battery available, SOC, curtailment cap, v_max) + time step, 350 ms debounce, 12 KPIs, live violations, diagram, follow-up heal preview. Snapshot latency (no preview) ≈ 40–100 ms warm, logged per request and at GET /api/simulate/latency.

### Phase 10 — done
forecasting/ features (direct multi-horizon), models (3 baselines + HGB quantile P10/P50/P90), backtest (time-ordered, daylight-only MAE/RMSE/nMAE/coverage; ML beats baseline 0.093 vs 0.126 pu), predictive (forecast → QSTS on P50/P90 → evaluate → frozen plan → replay on actuals). API: GET /api/forecast/backtest, POST /api/forecast/predictive. Frontend Forecast & Predict page. Acceptance S7 (PLAN_FAILED_ON_ACTUALS) + S8 (P50 SAFE / P90 VIOLATION) pass; forecasting unit tests pass.

### Phase 11 — done
whatif/parser_rules.py (12 edit types, 18 single phrasings + cloud + compound tests), parser_llm.py + explain/llm.py (optional, lazy, validated), API /api/whatif/parse|run. Frontend What-If Lab (editable chips, run, explanation with source tag, open in Heal & Verify) and Library (dataset cards incl. upload + validation report, saved scenarios + compare-two, hosting-capacity heat overlay on the diagram + table). Verified in headless Chrome, zero console errors.
