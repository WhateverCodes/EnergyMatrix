# GRIDTWIN — working rules (condensed from docs/PROJECT_BRIEF.md)

Full spec: `docs/PROJECT_BRIEF.md`. Progress + resume point: `PROGRESS.md`. Decisions log: `docs/decisions.md`.

## How to work
- Before any phase, re-read `PROGRESS.md`. After each phase: update it (built / tests / issues / decisions) and `git commit -m "phase N: ..."`.
- Ambiguity → make a sensible decision, log one line in `docs/decisions.md`, continue. Don't stop between phases.
- Gate: run the phase's tests and fix failures before moving on. `pytest` must never be left failing.
- Verify pandapower APIs by running code (`backend/.venv/bin/python -c ...`), not from memory. Versions pinned in `backend/requirements.txt`.
- macOS, Python 3.11 venv at `backend/.venv`, Node 20+. No XGBoost/LightGBM (use sklearn HistGradientBoostingRegressor).
- No placeholders: no TODOs, no fake endpoint data, no UI numbers not from the backend. Unbuilt features are absent and listed as Future work.
- Build the P0 vertical slice (Builder → Run → Grid → Live Lab → Heal & Verify → apply → S6 infeasible → save) before P1/P2.

## Non-negotiable principle: physics decides, AI explains
DATA → FORECAST → TWIN → QSTS AC POWER FLOW → CONSTRAINTS → CANDIDATE ACTIONS → EACH RE-SIMULATED
→ FEASIBILITY + OBJECTIVE → RANKED VERIFIED RESULT (or honest INFEASIBLE) → EXPLANATION
- Every UI number comes from a backend power-flow result. Frontend never computes electrical values.
- "Action works" = modified net simulated over every step and passed every constraint.
- Non-convergence is reported as `NON_CONVERGENCE`, never skipped.
- LLM is optional, never produces electrical values; numbers in LLM text must match metrics or fall back to templates.
- Network: CIGRE MV benchmark (`create_cigre_network_mv(with_der="pv_wind")`), labelled representative, not a real Indian feeder.
- Curtailment is capped (default 20%/step), minimum found by bisection. Curtail last in combinations.
- Synthetic data is always labelled SYNTHETIC; never presented as real.

## Stack
Backend: FastAPI, Pydantic v2, pandapower 3.x, pandas, numpy, scipy, scikit-learn, SQLAlchemy 2 + SQLite, pytest, httpx.
Frontend: React 18 + TS + Vite, Tailwind, TanStack Query, Recharts, lucide-react, custom SVG diagram, Vitest + RTL.

## Testing expectations
Unit: parsing, date formats, gaps, profiles, network, PF convergence/non-convergence, each violation type,
storage sign, SOC limits/efficiency, switching radiality, reactive limits, curtailment bisection + cap,
combination ordering, objective ranking, infeasibility content, baseline immutability, NL parser.
Integration: API flow for S2 and S6. Acceptance: S1–S8 outcome classes (never hard-code outputs).
Frontend: comparison table, infeasible panel only when backend says so, slider debounce.

## Commands
- `make setup`       — venv + pip install + npm install
- `make test`        — backend pytest + frontend vitest
- `make backend`     — uvicorn on http://localhost:8000 (OpenAPI at /docs)
- `make frontend`    — Vite on http://localhost:5173
- `make dev`         — both (scripts/dev.sh); `make dev PORT=8010` if :8000 is taken (frontend proxy follows via GRIDTWIN_API)
- `make calibrate`   — regenerate simulation/calibration.json
- `make demo-check`  — scripted 22-step demo against the API (in-process, temp DB; `--url` for a live server)
- Single backend test: `cd backend && .venv/bin/pytest tests/unit/test_x.py -q`
