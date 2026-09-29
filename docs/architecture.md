# Architecture

## Pipeline (physics decides, AI explains)

```
DATA → FORECAST → DIGITAL TWIN → QSTS AC POWER FLOW → CONSTRAINT ENGINE
     → CANDIDATE ACTIONS → EACH RE-SIMULATED → FEASIBILITY + OBJECTIVE
     → RANKED, VERIFIED RESULT (or honest INFEASIBLE report) → EXPLANATION
```

## Backend (`backend/app`)

| Package | Responsibility |
|---|---|
| `datasets/` | `DatasetAdapter` contract and normalised 15-min schema; `SolarKaggleAdapter`, `SyntheticClearSkyAdapter`, CSV upload with validation report, `LoadDatasetAdapter`, registry. |
| `load_profiles/` | 8 deterministic synthetic consumer profiles. |
| `simulation/network_factory.py` | Builds and caches the CIGRE MV template (plus 4 sectionalizers). Every simulation `deepcopy`s it; the template is never mutated (asserted in tests). |
| `simulation/mapping.py` | `ScenarioConfig` → `ScenarioInputs`: per-step PV available per sgen, per-step load P/Q, battery, topology, honesty labels. |
| `simulation/powerflow.py` | `runpp` (Newton-Raphson) wrapper with `recycle` for P/Q-only changes; non-convergence → `PFResult(converged=False)`. |
| `simulation/qsts.py` | Time-series engine: `StepControl`/`StepContext`, levers, SOC dynamics, final authoritative PF per step. |
| `simulation/constraints.py` | 8 violation types, severity, per-window summary, signed margins for bisection. |
| `simulation/topology.py` | Connectivity (`unsupplied_buses`), radiality (loop detection on the switch-respecting graph), switch enumeration. |
| `simulation/hosting_capacity.py` | Per-bus PV hosting capacity by bisection. |
| `optimization/actions/` | Battery, switching, reactive, curtailment levers; ordered combinations. |
| `optimization/evaluator.py` | Independent evaluation of every candidate (process pool), cache keyed by config, re-ranking by weights. |
| `optimization/objective.py`, `infeasibility.py` | Lexicographic ranking and J; "why each failed" and minimum out-of-limit intervention. |
| `forecasting/` | Features, baselines + HGB quantile models, backtest, predictive plan/replay. |
| `scenarios/library.py` | Loads `simulation/scenarios/S1..S8.json`. |
| `explain/`, `whatif/` | Template explanations; optional validated LLM; rule-based NL parser. |
| `api/`, `db/` | FastAPI routers, SQLite (SQLAlchemy 2) persistence, error contract. |

**Data flow for "Find corrective actions":** config → `build_inputs` → baseline QSTS. If the baseline is SAFE → `NO_ACTION_NEEDED`. Otherwise 8 candidates are submitted to a persistent `ProcessPoolExecutor`. Each worker rebuilds the inputs from the config, deep-copies the net, runs `setup` (switching) and a full QSTS with its levers, then computes metrics, feasibility and failure analysis. The main process ranks, explains, builds the infeasibility report, and caches. Weight changes re-rank the cached metrics.

## Frontend (`frontend/src`)

React 18 + TypeScript + Vite, Tailwind 4, TanStack Query, Recharts, custom SVG single-line diagram.
`services/api.ts` is the only data source. `app/ScenarioContext.tsx` holds the current config and results (a config change clears downstream results). Pages are in `pages/`; reusable feature components are in `features/{grid,actions}`. The frontend only formats values; it performs no electrical computation.

## Persistence

SQLite `backend/gridtwin.db` (override with `GRIDTWIN_DB`): `datasets`, `scenarios`, `simulation_runs`, `action_evaluations`, `saved_scenarios`. Raw time series stay as files (`data/raw`, `data/processed`).
