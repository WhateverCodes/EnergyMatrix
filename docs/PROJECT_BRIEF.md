# GRIDTWIN — Renewable Distribution Grid Digital Twin
## Complete build specification (hackathon problem ENR-02)

You are the entire engineering team for this project: software architect, full-stack engineer, power-systems engineer, ML engineer, optimization engineer, data engineer, UI designer and QA engineer. This message is your complete specification. Build the whole working project described here, end to end, in the current directory.

---

## STEP 0 — HOW YOU MUST WORK (read first, follow throughout)

1. **Persist this brief.** Save this entire prompt verbatim to `docs/PROJECT_BRIEF.md`. Create `CLAUDE.md` at the repo root containing a 40–60 line condensed version of the non-negotiable rules (Sections 0, 1, 3, 13) plus the commands to run tests and servers. Create `PROGRESS.md` with the phase checklist from Section 12.
2. **Resume protocol.** This is a long build. Before starting any phase, re-read `PROGRESS.md`. After finishing a phase, update `PROGRESS.md` (what was built, test status, known issues, decisions made) and `git commit` with a message like `phase 3: time-series engine + battery SOC`. If your context is ever reset, continue from `PROGRESS.md` and `docs/PROJECT_BRIEF.md` without asking.
3. **Autonomy.** When something is ambiguous, make a sensible engineering decision, record it in `docs/decisions.md` (one line: decision + reason), and continue. Do not stop for confirmation between phases. Only stop to ask the user if something is truly impossible to assume (see the dataset rule in Section 5.1 — even then, continue with the labelled fallback).
4. **Verification gates.** After every phase: run the phase's tests, fix failures, and only then move on. Never leave the repo in a state where `pytest` fails.
5. **Verify library APIs by running code, not by memory.** pandapower changed between 2.x and 3.x (e.g. geodata storage). Before using any pandapower function or table column, confirm it in a scratch Python session (`python -c "..."`) against the installed version, and pin versions in `requirements.txt`.
6. **Environment.** The user is on **macOS**. Use Python 3.11 (via `python3.11` if available, else the newest 3.10–3.12 present) in a venv at `backend/.venv`, Node 20+. No Docker requirement. Avoid dependencies that need native OpenMP on macOS (do NOT use XGBoost/LightGBM; use scikit-learn's `HistGradientBoostingRegressor`).
7. **No placeholders.** No `TODO`, `pass # implement later`, fake data returned from endpoints, or UI numbers that do not come from the backend. Optional features that are not built are simply absent, and listed under "Future work" in the README.
8. **Build a vertical slice early.** The P0 demo path (Section 11) must work end-to-end before any P1/P2 work begins.

---

## 1. THE PROBLEM AND THE NON-NEGOTIABLE PRINCIPLE

**ENR-02 — Renewable Distribution Grid Digital Twin.** As rooftop solar and other renewables feed into local distribution networks, changing generation and demand can cause unsafe voltage and equipment overload. Build a network model that **predicts near-term generation and demand**, checks conditions against equipment limits, and suggests corrective actions such as **changing feeder connections, battery use, or a limited reduction in renewable output** to keep the network safe **while maximizing renewable use**.

Expected outcomes (every one must be visibly demonstrated):
- Connects a simplified feeder/network model to **time-based** solar and load data.
- Runs **power-flow** calculations to detect voltage, overheating (thermal loading) or overloading problems.
- Compares at least a few corrective actions against network limits.
- Clear before/after demonstration across multiple scenarios.
- **Honestly reports at least one scenario where the recommended action fails or is infeasible.**

**Non-negotiable principle — physics decides, AI explains.**
```
DATA → FORECAST → DIGITAL TWIN → TIME-SERIES AC POWER FLOW → CONSTRAINT ENGINE
     → CANDIDATE ACTIONS → EACH ACTION RE-SIMULATED → FEASIBILITY + OBJECTIVE
     → RANKED, VERIFIED RESULT (or honest INFEASIBLE report) → EXPLANATION
```
Every number shown in the UI comes from a backend power-flow result. "Action X works" means the modified network was actually simulated over every timestep and passed every constraint. "No feasible solution" means every candidate within allowed limits was actually simulated and failed. If power flow fails to converge, the result is `NON_CONVERGENCE`, shown as such. The LLM never produces electrical values.

Product tagline: **"Build → Forecast → Stress → Detect → Heal → Verify."**

---

## 2. ENGINEERING DECISIONS (these override any intuition)

| Topic | Decision | Why |
|---|---|---|
| Network | pandapower built-in **CIGRE MV benchmark with DER**: `pandapower.networks.create_cigre_network_mv(with_der="pv_wind")`. Labelled everywhere as "CIGRE MV benchmark feeder (CIGRE TF C6.04.02) — representative, not a real Indian feeder". | Documented source, ~15 buses, PV already placed, and it has sectionalizing/tie switches → real feeder reconfiguration. Do NOT hand-build the IEEE 13-node feeder (it is unbalanced 3-phase; balanced `runpp` would misrepresent it). |
| Time | **Quasi-static time series (QSTS)**: loop AC power flow over 15-min steps, carrying battery SOC between steps. | The PS says time-based; battery is an energy resource, so snapshot-only battery results are physically wrong. |
| Curtailment | **Limited**: configurable cap, default `max_curtailment_pct = 20` per timestep. Minimum needed is found by **bisection**, not fixed steps. | PS says "limited reduction". Makes true infeasibility possible and honest. |
| Infeasibility | Genuine failure cases (Section 9): (a) extreme surplus needs more curtailment than the cap and storage is full/unavailable → INFEASIBLE with the minimum out-of-limit intervention reported; (b) a plan made on the forecast **fails when replayed on actual data** (cloud event); (c) evening undervoltage where curtailment is irrelevant. | Matches "the recommended action fails or is infeasible" without contradiction. |
| Forecasting | Integrated, not decorative: forecast next N steps (P50 + P90) → run twin on forecast → predicted violations → pre-emptive plan → verify on actuals. | PS explicitly says the model predicts near-term generation and demand. |
| Demand forecasting | Consumer profiles are synthetic and deterministic, so ML forecasting of them is meaningless. Demand forecast = schedule profile + configurable forecast-error injection. `LoadDatasetAdapter` is built so a real load dataset can later be forecast with the same ML pipeline. State this honestly in UI and docs. | Avoid fake ML metrics. |
| Reverse power flow | Tracked and displayed; `INFO` by default, `VIOLATION` only if a configurable reverse-flow limit is set. | Reverse flow is not inherently unsafe. |
| Reactive power | Inverter reactive support within PF / apparent-power capability. Explicitly explain its limited effect where R/X is high. | Honest physics. |
| Action combinations | Evaluate single actions AND combinations, applying non-curtailment levers first and curtailing only the residual ("curtail last"). | Best real answers are often "battery + small curtailment". Maximizes renewable use. |
| Hosting capacity | Per-bus PV hosting capacity (max added PV before first violation) by bisection. | Directly answers "maximize renewable use". |
| LLM | Optional. Rule-based NL parser and template explanations work with no API key. If `ANTHROPIC_API_KEY` is set, an LLM may parse NL and rephrase explanations, but outputs are schema-validated and every number in LLM text must match the supplied metrics, else fall back to the template. | Demo cannot depend on network/API; no fabricated numbers. |

---

## 3. TECH STACK (exact)

**Backend:** Python 3.11, FastAPI, Uvicorn, Pydantic v2, pandapower (latest 3.x; pin exact version after install), pandas, numpy, scipy, networkx (via pandapower.topology), scikit-learn, SQLAlchemy 2.x + SQLite, pytest, httpx. Optional: `anthropic` SDK only if key present (import lazily).

**Frontend:** React 18 + TypeScript + Vite, Tailwind CSS, TanStack Query, Recharts, lucide-react, custom SVG network diagram (fixed coordinates from CIGRE geodata), Vitest + React Testing Library. Fonts via `@fontsource`: IBM Plex Sans (UI) and JetBrains Mono (numbers/telemetry).

**Tooling:** root `Makefile` with `setup`, `backend`, `frontend`, `dev`, `test`, `calibrate`, `demo-check`. Also `scripts/dev.sh` that starts both servers.

---

## 4. REPOSITORY STRUCTURE

```
renewable-grid-digital-twin/
  CLAUDE.md  PROGRESS.md  README.md  Makefile  .gitignore
  backend/
    requirements.txt
    app/
      main.py                      # FastAPI app, CORS, routers, error handlers
      config.py                    # Settings + default Constraints (pydantic)
      api/                         # routers: networks, datasets, profiles, scenarios,
                                   #   simulate, actions, forecast, whatif, history, hosting
      schemas/                     # Pydantic request/response models
      db/                          # SQLAlchemy models, session, init
      datasets/
        base.py                    # DatasetAdapter ABC + normalized schema validation
        solar_kaggle.py            # SolarKaggleAdapter
        synthetic_clearsky.py      # clearly-labelled fallback generation profile
        csv_generic.py             # user-upload adapter with column mapping
        load_adapter.py            # LoadDatasetAdapter (for future real load data)
        registry.py
      load_profiles/profiles.py    # 8 deterministic consumer profiles
      simulation/
        network_factory.py         # builds + caches CIGRE MV template, adds battery
        mapping.py                 # maps generation/demand profiles onto net elements
        powerflow.py               # single-step runpp wrapper, convergence handling
        qsts.py                    # time-series engine with SOC coupling
        constraints.py             # constraint engine → structured violations
        metrics.py
        topology.py                # connectivity + radiality checks
        hosting_capacity.py
      optimization/
        actions/ base.py battery.py curtailment.py reactive.py switching.py combined.py
        evaluator.py               # independent evaluation of every candidate
        objective.py               # lexicographic feasibility + weighted penalty
        infeasibility.py           # "why each failed" + minimum required intervention
      forecasting/ features.py models.py backtest.py predictive.py
      scenarios/library.py         # loads simulation/scenarios/*.json
      explain/ templates.py llm.py
      whatif/ parser_rules.py parser_llm.py
    tests/ unit/ integration/ acceptance/
  frontend/src/
    app/ pages/ components/ features/{builder,grid,actions,forecast,whatif,library}/
    services/api.ts hooks/ types/ utils/format.ts
  data/raw/solar_kaggle/           # Kaggle CSVs (gitignored)
  data/processed/
  simulation/scenarios/            # reproducible scenario JSON files
  simulation/calibration.json
  scripts/ calibrate.py demo_check.py dev.sh
  docs/ PROJECT_BRIEF.md decisions.md architecture.md simulation.md optimization.md
        forecasting.md datasets.md api.md demo.md judge_qa.md viva_qa.md
```

---

## 5. DATA LAYER

### 5.1 Real solar dataset (Kaggle "Solar Power Generation Data", two plants in India, ~34 days May–June 2020, 15-min)
Expected files in `data/raw/solar_kaggle/`: `Plant_1_Generation_Data.csv`, `Plant_1_Weather_Sensor_Data.csv`, `Plant_2_Generation_Data.csv`, `Plant_2_Weather_Sensor_Data.csv`.

`SolarKaggleAdapter` must (verify every assumption by inspecting the files first):
- Detect date format per file (the two plants use different `DATE_TIME` formats); parse to naive local time (IST), document.
- Use `AC_POWER` (inspect DC vs AC — Plant 1 DC values may look inconsistent in scale; confirm and document what you find).
- Aggregate across inverters (`SOURCE_KEY`) per timestamp; record inverter count per timestamp; flag timestamps with missing inverters and document the handling.
- Reindex to a full 15-min grid; interpolate gaps ≤ 1 h; set night values to 0 when irradiation is 0; flag longer gaps (excluded from forecasting metrics).
- Join weather features (`IRRADIATION`, `AMBIENT_TEMPERATURE`, `MODULE_TEMPERATURE`).
- Output normalized per-unit profile `generation_pu = AC_power / plant_capacity` (capacity = documented estimate, e.g. high percentile of observed AC). The twin scales this shape to the feeder's installed PV. UI label: **"Real plant generation shape (Kaggle, India) — scaled to feeder PV capacity"**.
- Normalized schema: `timestamp, dataset_id, location, source_type, generation_kw, generation_pu, irradiation, ambient_temp, module_temp, quality_flag`.

**If the Kaggle files are missing:** do not stop. Implement `SyntheticClearSkyAdapter` (deterministic clear-sky bell curve with optional deterministic cloud dips), registered with `is_real=false`, labelled "SYNTHETIC" everywhere in the UI, and print a clear message in the terminal and README telling the user to place the Kaggle files. Never label synthetic data as real.

### 5.2 Generic CSV upload
`POST /api/datasets/upload` with column mapping (timestamp column, value column, unit kW/MW/W, source type). Validate columns, report missing values and gaps, resample to 15 min, store file under `data/processed/` and metadata in DB. Return a validation report; never a stack trace.

### 5.3 Synthetic consumer profiles (labelled "Synthetic consumer scenario")
Eight deterministic normalized 24-h profiles (hourly anchors, interpolated to 15 min): Bungalow, Residential Society, Neighborhood, Small Factory, School, Hospital, Commercial Building, Office. Parameters: `base_kw, peak_kw, scale, weekend_factor`. Documented shapes (Residential Society: morning rise 6–9, moderate day, strong peak 18–22; Small Factory: plateau 9–18, low night, weekend factor 0.3; Hospital: flat high with mild day bump; etc.). Optional `noise_seed` (default off).

### 5.4 Mapping onto the network (`simulation/mapping.py`)
- Inspect the CIGRE MV `load` and `sgen` tables (residential vs commercial/industrial naming — confirm).
- User selects a consumer scenario and a **target load bus**; that bus follows the selected profile × scale. Other loads follow a documented background profile (Residential Society for residential loads, Commercial for C/I loads) at nominal CIGRE magnitudes.
- All PV sgens follow `generation_pu × installed_capacity`. Installed capacity = CIGRE nominal PV rating × `pv_penetration_multiplier`, plus an optional **rooftop PV cluster** (user-sized MW) at a user-chosen bus. UI shows installed PV in MW.
- Wind sgens held at 0 in P0 (documented).
- Battery: one `storage` element (default 2 MW / 4 MWh at a calibrated bus, SOC limits 10–90%, round-trip efficiency 0.92 split as sqrt on charge/discharge). **Verify pandapower's storage sign convention with a unit test** before relying on it.

---

## 6. DIGITAL TWIN, POWER FLOW, CONSTRAINTS

### 6.1 Network factory
Build the CIGRE MV template once and cache it; every simulation works on `copy.deepcopy(template)`. `GET /api/networks` returns buses (id, name, vn_kv, coordinates), lines (from/to, length, max_i_ka), transformers, switches (default state), loads, sgens, storage. Extract coordinates from wherever the installed pandapower version stores bus geodata (verify; 3.x uses a `geo` column with GeoJSON). If missing, generate a deterministic layered layout.

### 6.2 Power flow
`pp.runpp(net, algorithm="nr")` with warm start where valid. Catch `LoadflowNotConverged` → step status `NON_CONVERGENCE` (never silently skip). Record per step: bus vm_pu and va_degree, line loading %, trafo loading %, P/Q flows, losses, ext-grid import/export, PV available vs dispatched, battery P and SOC, reverse flow at each transformer.

### 6.3 QSTS engine
Input: timestamps, per-step PV available per sgen, per-step load (Q via fixed PF 0.95 lagging, documented), battery params and initial SOC, switch states, action policy. Loop steps in order, update SOC with efficiency, enforce SOC and power limits. Target: 24 steps × one policy < 1 s.

### 6.4 Constraint engine — limits live in backend config (`GET /api/config/constraints`), overridable per request
Defaults: `v_min 0.95`, `v_max 1.05` pu; `line_loading_max 100%`; `trafo_loading_max 100%`; `reverse_flow_limit_mw null` (INFO only); `loss_pct_max 8%` (WARNING); `max_curtailment_pct 20`.
Types: `UNDERVOLTAGE, OVERVOLTAGE, LINE_OVERLOAD, TRAFO_OVERLOAD, REVERSE_FLOW, EXCESSIVE_LOSSES, NON_CONVERGENCE, ISLANDED_BUS`. Severity LOW/MEDIUM/HIGH from margin with documented thresholds.
```json
{"status":"VIOLATION","worst_step":"2020-05-20T12:30",
 "violations":[{"type":"OVERVOLTAGE","element":"bus","id":11,"name":"Bus 11",
   "value":1.071,"limit":1.05,"severity":"HIGH","steps":["12:00","12:15","12:30"]}]}
```

### 6.5 Hosting capacity
For each MV bus: bisection on added PV (MW) under a stated worst case (max PV step, min load step of the window) → max MW before first violation and which constraint binds. Cache per (config, window).

---

## 7. CORRECTIVE ACTIONS, EVALUATION, OBJECTIVE

### 7.1 Action interface
Each action: `name`, `available(ctx) -> (bool, reason)`, `apply(net_copy, step_ctx) -> ActionEffect`, and the parameters it chose. Evaluator always: copy baseline → apply → full QSTS → check every step → metrics → feasibility → penalty. Baseline template is never mutated (assert in tests).

### 7.2 Actions
- **A1 Battery.** Per step, charge only as much as needed to clear overvoltage/overload (bisection on charge power within p_max and SOC headroom); discharge to support undervoltage/overload; otherwise idle. Report the step where SOC saturates.
- **A2 Feeder reconfiguration.** Enumerate all switch-state combinations of the CIGRE switches (inspect how many). Keep only configs where every load/sgen bus is energized (`pandapower.topology.unsupplied_buses`) and, by default, radial (in-service graph is a forest). One config for the whole window. Report rejected configs with reason (islanding / meshed / constraint fail). Count switch operations.
- **A3 Reactive support.** PV inverters absorb (overvoltage) or inject (undervoltage) Q within `|Q| ≤ sqrt(S_rated² − P²)` and PF ≥ 0.90 (configurable). Bisection for minimum Q needed per step. Report saturation and resulting voltage.
- **A4 Limited curtailment.** Uniform proportional reduction across PV sgens. Per step, bisection for the minimum fraction restoring feasibility, capped at `max_curtailment_pct`. If required > cap → step fails, and the required value is still reported. Track MW, MWh and % curtailed exactly.
- **A5 Combinations.** At minimum: Battery+Curtail, Reactive+Curtail, Switching+Battery, Switching+Reactive+Battery+Curtail ("all levers"). Order: switching → battery → reactive → curtail residual only.

### 7.3 Objective — lexicographic, documented in docs/optimization.md
1. Feasibility: all steps converge and satisfy hard constraints (voltage, line, trafo; plus reverse flow if a limit is set).
2. Among feasible candidates minimize
   `J = w_curt·E_curtailed_MWh + w_batt·E_battery_throughput_MWh + w_sw·N_switch_ops + w_loss·E_losses_MWh + w_q·E_reactive_MVArh`
   Defaults `w_curt=10, w_batt=1, w_sw=2, w_loss=1, w_q=0.2`. Weights in config, overridable per request.
3. Return **all** candidates with feasibility, metrics, J and penalty breakdown; recommended = min J among feasible.

### 7.4 Infeasibility report
If no candidate is feasible: status `NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS`, and for each candidate the first failing step, binding constraint, value vs limit, and why (e.g. "battery SOC reached 90% at 11:45", "reactive capability saturated, V still 1.058 pu", "required curtailment 34.2% exceeds 20% cap"). Plus **minimum intervention outside current limits**: required curtailment % (overvoltage) or required load reduction MW (undervoltage/overload) — reported, never applied.

### 7.5 Explanations
Deterministic sentences built only from result fields, e.g. "Battery + 4.1% curtailment was selected: max voltage fell from 1.071 to 1.049 pu, peak line loading from 108.2% to 96.4%, with 0.31 MWh curtailed (J = 5.9, lowest of 4 feasible options)." Optional LLM rephrase validated number-by-number.

---

## 8. FORECASTING AND PREDICTIVE OPERATION

- **Models (generation):** persistence (same time previous day), last-value persistence, rolling mean, and `HistGradientBoostingRegressor` on time-of-day (sin/cos), lagged generation_pu (1, 2, 4, 96 steps), lagged irradiation, module temp. Quantile models (`loss="quantile"`, α=0.1/0.5/0.9) give P10/P50/P90.
- **Validation:** time-ordered split (never shuffle); MAE, RMSE, nMAE on daylight steps only (explain MAPE is undefined at night). State the ~34-day data limitation; if ML does not beat persistence, say so in UI and docs.
- **Predictive mode:** at time t, forecast next N steps (default 8 = 2 h) → QSTS on P50 and P90 → predicted violations with timestamps → evaluator on forecast → plan (battery schedule, Q, curtailment, switch config) → **replay the plan on actual data** → `PLAN_HELD` or `PLAN_FAILED_ON_ACTUALS` with failing steps.
- Demand forecast = profile schedule + optional injected error, labelled as such.

---

## 9. SCENARIO LIBRARY (reproducible JSON in simulation/scenarios/)

Run `scripts/calibrate.py` first: sweep installed PV on the calibrated window and record PV level at first violation, where battery alone stops being sufficient, and where required curtailment exceeds the cap. Set scenario parameters **relative to these thresholds**, saved with provenance in `simulation/calibration.json`. Choosing parameters is legitimate; results are always computed. If CIGRE MV cannot produce violations at realistic PV levels, add the rooftop PV cluster at the electrically farthest bus and document it.

| ID | Scenario | Expected outcome class (asserted by acceptance tests) |
|---|---|---|
| S1 | Normal solar + Residential Society | SAFE, no action needed |
| S2 | Solar surge, battery available | VIOLATION → feasible; battery-based option recommended with ~0% curtailment |
| S3 | Solar surge, battery unavailable | VIOLATION → switching / reactive / curtailment compared; at least one feasible |
| S4 | Solar + Small Factory (daytime self-consumption) | SAFE or mild |
| S5 | Evening demand spike, no sun, battery depleted | UNDERVOLTAGE/OVERLOAD; curtailment reported N/A; if nothing works → minimum load reduction reported |
| S6 | Extreme surplus, battery full/unavailable, 20% cap | **NO FEASIBLE SOLUTION UNDER CURRENT CONSTRAINTS**; exact required curtailment > cap |
| S7 | Cloud event: plan made on forecast, replayed on actuals | **PLAN_FAILED_ON_ACTUALS** with failing steps |
| S8 | Plan safe on P50, violates on P90 | Shows why robust planning matters |

Acceptance tests assert only the outcome class. If a class breaks, recalibrate and adjust parameters — never hard-code outputs.

---

## 10. API (typed Pydantic, OpenAPI at /docs)

```
GET  /api/health
GET  /api/config/constraints
GET  /api/networks                     GET /api/networks/{id}
GET  /api/datasets                     POST /api/datasets/upload   GET /api/datasets/{id}/series?start&end
GET  /api/load-profiles                GET /api/load-profiles/{type}/series?date&scale
POST /api/scenarios/build              # gen, demand, net surplus per step + data-honesty labels
POST /api/simulate/run                 # full QSTS baseline → per-step results + violations
POST /api/simulate/snapshot            # single-step PF for live sliders (<150 ms target)
POST /api/actions/evaluate             # all candidates, re-simulated, ranked, infeasibility report
POST /api/actions/apply                # after-state of chosen candidate
GET  /api/hosting-capacity?network&window
GET  /api/forecast/backtest            POST /api/forecast/predictive
POST /api/whatif/parse                 POST /api/whatif/run
GET  /api/scenarios/library            GET /api/scenarios/library/{id}
POST /api/history  GET /api/history  GET /api/history/{id}  GET /api/history/compare?a&b
```
Errors return `{"error_code","message","details"}`; a global handler ensures no stack traces reach the client.

**SQLite tables:** `datasets` (metadata + file path, is_real, source, coverage, resolution, variables), `scenarios`, `simulation_runs`, `action_evaluations`, `saved_scenarios` (name, labels, baseline result, selected intervention, final result, feasibility, created_at). Raw time series stay as files.

---

## 11. FRONTEND — PAGES, DESIGN, P0 DEMO PATH

**Visual identity:** dark control-room aesthetic, restrained palette (near-black slate, one cyan accent, amber warnings, red violations, green OK), dense calm layouts, thin 1px dividers instead of card-soup, JetBrains Mono for telemetry, no gradients, no gratuitous animation. Status never by colour alone (icons/labels too). Persistent **data-honesty strip** in the header: `REAL DATA · Kaggle Plant 1 (scaled)` | `SYNTHETIC CONSUMER SCENARIO` | `BENCHMARK FEEDER · CIGRE MV` | `SIMULATED RESULTS`.

**Pages:**
1. **Scenario Builder** (`/`) — three columns: Generation (type, dataset, date, window, installed PV MW, optional rooftop cluster) · Consumption (8 profile tiles, target bus, scale) · Network (feeder, battery on/off + size + SOC, constraint overrides). Summary bar from backend: generation, demand, net surplus. BUILD SCENARIO → RUN DIGITAL TWIN. Library scenario dropdown S1–S8.
2. **Grid Twin** (`/grid`) — SVG single-line diagram from real coordinates: buses coloured by voltage band, lines by loading (thickness + colour), direction markers showing reverse flow, transformer, switches (open/closed glyphs), PV, loads, battery with SOC. Time scrubber with play. Click element → inspector (value, limit, status, P/Q). Charts: generation vs demand, voltage profile along feeder, max loading over time, battery SOC.
3. **Heal & Verify** (`/actions`) — FIND CORRECTIVE ACTIONS → table of every candidate (feasible ✓/✗, max V, min V, max line %, trafo %, losses, curtailment %/MWh, battery throughput, switch ops, J), recommended row highlighted with explanation; penalty-weight sliders re-rank via backend. APPLY → before/after panel (deltas + two diagrams). If infeasible: red **"NO FEASIBLE SOLUTION UNDER CURRENT CONSTRAINTS"** panel with each action's failure reason and minimum required intervention.
4. **Live Lab** (`/lab`) — sliders that change real inputs (PV %, demand %, battery available, SOC, consumer scale, curtailment cap, v_max), debounced 350 ms to `/api/simulate/snapshot`; KPIs: min/max V, max line %, trafo %, losses, renewable utilization, curtailment, reverse flow, import/export, live violation list. Button for full evaluation.
5. **Forecast & Predict** (`/forecast`) — backtest chart (actual vs persistence vs ML with P10–P90 band) + metrics; predictive panel: predicted violations next 2 h, pre-emptive plan, replay result (PLAN_HELD / PLAN_FAILED_ON_ACTUALS).
6. **What-If Lab** (`/whatif`) — NL input → parsed parameters shown as editable chips before running → twin → result + explanation. Supports: solar ±%, demand ±%, battery unavailable, line/switch out of service, cloud event at time, move consumer to bus, set curtailment cap.
7. **Library** (`/library`) — dataset cards (name, type, location, resolution, coverage, records, source, REAL/SYNTHETIC, variables actually present) + upload; saved scenarios with compare-two view; hosting-capacity bus heat overlay.

**P0 demo path (must work first):** Builder (S1) → Run → Grid Twin → Live Lab raise PV → violation → Heal & Verify → compare → apply → before/after → disable battery + extreme surplus (S6) → NO FEASIBLE SOLUTION + required curtailment → Save scenario.

The frontend only formats and displays backend values; no electrical computation in frontend code.

---

## 12. PHASES (update PROGRESS.md and commit after each)

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Repo skeleton, brief persisted, CLAUDE.md, PROGRESS.md, Makefile, venv, installs, pinned versions, `/api/health`, Vite app boots | `make test` runs |
| 1 | Network factory (CIGRE MV), single-step PF, constraint engine, topology checks, storage sign test | unit tests pass; docs/simulation.md started with inspected network facts |
| 2 | Kaggle adapter (+ synthetic fallback), generic CSV adapter, 8 load profiles, mapping | parsing, timestamp, gap, profile tests pass |
| 3 | QSTS engine with SOC coupling, metrics | SOC limits and efficiency tests |
| 4 | Calibration script, hosting capacity | calibration.json produced and documented |
| 5 | Actions A1–A5, evaluator, objective, infeasibility report, explanations | per-action tests; baseline-immutability test |
| 6 | Scenario library S1–S8 | acceptance tests assert all outcome classes |
| 7 | FastAPI endpoints, SQLite, error handling | integration tests: scenario → PF → violations → actions → verification |
| 8 | Frontend: Builder, Grid Twin, Heal & Verify | P0 path works; component tests for comparison table and infeasible panel |
| 9 | Live Lab sliders with debounce | snapshot latency measured and logged |
| 10 | Forecast backtest + predictive mode + S7/S8 in UI | honest metrics; S7 shows PLAN_FAILED_ON_ACTUALS |
| 11 | What-If parser + history + compare + hosting view + upload UI | parser tests (10+ phrasings) |
| 12 | Polish, scripts/demo_check.py, all docs, README | `make demo-check` passes end-to-end |

P0 = phases 0–8 plus S6. Do not start phase 10+ while any P0 item is broken.

---

## 13. TESTING (pytest + vitest)

Unit: dataset parsing, both date formats, timestamp normalization, gap handling, unit conversion, load-profile determinism, network construction, PF convergence, non-convergence handling, each violation type (deliberate cases), storage sign convention, SOC limits and efficiency, switching connectivity/radiality rejection, reactive limits, curtailment bisection minimality and cap, combination ordering, objective ranking, infeasibility report content, baseline immutability, NL parser.
Integration: full API flow for S2 and S6. Acceptance: S1–S8 outcome classes. Frontend: comparison table renders backend data, infeasible panel only when backend says so, slider debounce fires once per burst.
`scripts/demo_check.py`: executes the 22-step demo in Section 15 via the API, asserts each step, prints a PASS/FAIL table.

---

## 14. DOCUMENTATION (written for a viva)

- **README.md:** overview, problem, solution, architecture (Mermaid), digital twin, power flow, forecasting, optimization, actions, datasets, macOS install, running, tests, API summary, demo scenarios, a table separating REAL DATA / SYNTHETIC DATA / REPRESENTATIVE NETWORK / SIMULATED RESULTS, limitations, future work.
- **docs/architecture.md**, **docs/simulation.md** (CIGRE MV facts as inspected, Newton-Raphson AC power flow, per-unit system, why PV raises voltage — ΔV ≈ (R·P + X·Q)/V — and why Q is weak where R/X is high, QSTS, SOC equations, calibration results), **docs/optimization.md**, **docs/forecasting.md**, **docs/datasets.md**, **docs/api.md**, **docs/demo.md** (click-by-click script + 5-minute pitch story), **docs/judge_qa.md** (20+ likely judge questions with answers), **docs/viva_qa.md** (25+ technical questions: Newton-Raphson, slack bus, p.u., thermal limits, why balanced PF is acceptable here, reverse flow, SOC dynamics, bisection, why not an LLM solver, forecast metrics, limitations).

---

## 15. FINAL DEMO (must pass `make demo-check`)

1 Open Scenario Builder · 2 Solar · 3 real Kaggle dataset · 4 Residential Society · 5 CIGRE MV feeder · 6 window (e.g. 10:00–15:00) · 7 Run · 8 network shown · 9 generation vs demand · 10 voltage/loading · 11 raise PV in Live Lab · 12 violation appears · 13 Find corrective actions · 14 compare battery, switching, reactive, curtailment, combinations · 15 apply recommended feasible action · 16 re-simulated · 17 before/after · 18 disable battery · 19 extreme surplus · 20 NO FEASIBLE SOLUTION UNDER CURRENT CONSTRAINTS · 21 exact required curtailment vs 20% cap · 22 save scenario. Bonus: Forecast page shows S7 plan failing on actuals.

---

## 16. FINAL HANDOFF

When all phases pass, print a concise summary: how to start (`make setup`, `make dev`), URLs, test and demo-check results, which dataset is active (real or fallback), known limitations, and where the Q&A docs are. Do not claim anything works that `make test` and `make demo-check` did not verify.

Begin now with Step 0 and continue through every phase without stopping for confirmation.
