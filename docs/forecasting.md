# Forecasting and predictive operation

## What is forecast

**Generation only.** Consumer demand profiles are deterministic synthetic schedules, so fitting ML to them would produce meaningless metrics. Predictive mode uses the schedule × (1 + injected error %), labelled as such. `LoadDatasetAdapter` exposes a real load dataset in the same frame format, so the same pipeline can forecast it once real data exists.

## Features (direct multi-horizon)

One training sample per (issue time t, horizon h = 1…8 steps). Only information available at t is used: target time of day (sin/cos), h, g(t), g(t−1), g(t−3), g(t+h−96) (same time yesterday), irradiation(t), module temperature(t). Forecasting each horizon directly avoids compounding errors from recursive one-step forecasts.

## Models

| Model | Definition |
|---|---|
| persistence_day | g(t+h−96) |
| persistence_last | g(t) |
| rolling_mean | mean of the last 4 observations |
| hgb | `HistGradientBoostingRegressor(loss="quantile")` at α = 0.1 / 0.5 / 0.9 → P10 / P50 / P90 (non-crossing enforced; night forced to 0) |

## Backtest (time-ordered — never shuffled)

Train on the first 70 % of days (until 2020-06-07), test on the rest. Metrics on **daylight** target steps only (irradiation > 0): MAPE is undefined when actual output is 0. Errors are in pu of plant capacity.

| Model (Plant 1, h = 1–8) | MAE | RMSE | nMAE | P10–P90 coverage |
|---|---|---|---|---|
| Persistence (same time yesterday) — best baseline | 0.1255 | 0.1787 | 30.1 % | — |
| Persistence (last value) | 0.1668 | 0.2137 | 39.9 % | — |
| Rolling mean (1 h) | 0.1907 | 0.2373 | 45.7 % | — |
| **HistGradientBoosting P50** | **0.0927** | **0.1346** | **22.2 %** | **78.4 %** (nominal 80 %) |

Last-value persistence beats HGB only at h = 1 (0.0766 vs 0.0743 — essentially equal); from h = 2 on, HGB is clearly better. The UI states whether ML beats the best baseline. **Limitation:** 34 days, one plant, one season; ~10 test days.

## Predictive mode

At issue time t0: forecast the next N ≤ 8 steps → run the twin on P50 and P90 → predicted violations → evaluate corrective actions on the planning forecast (P50 or P90) → freeze the recommended plan (switch states + per-step battery MW, curtailment fraction, per-inverter Q) → **replay the frozen plan on actual data** (including any real/synthetic cloud event) → `PLAN_HELD` or `PLAN_FAILED_ON_ACTUALS` with failing steps and the reason. HGB is trained leave-one-day-out (all days except the scenario date).

- **S7:** a cloud between 10:30 and 11:45 depresses the observations the forecaster sees at 11:30. P50 predicts ~0.42–0.54 pu, so the P50 plan is "no action". The sun returns (actual ~0.97 pu) and lines 1-2/2-3 reach 126 % → PLAN_FAILED_ON_ACTUALS. The P90 twin had flagged violations.
- **S8:** P50 predicts SAFE, P90 predicts overload. Planning on P50 fails on actuals. Even planning on P90 fails at 3 steps because actual output exceeded P90 there, which is consistent with the measured 78 % coverage.
