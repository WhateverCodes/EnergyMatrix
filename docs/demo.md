# Demo script

`make dev` (or `make dev PORT=8010`), open http://localhost:5173. Run `make demo-check` beforehand: it executes these same steps through the API and prints PASS/FAIL.

## Click-by-click (≈ 6 minutes)

1. **Scenario Builder** opens on **S1 — Normal solar + Residential Society**. Point at the header strip: REAL DATA · Kaggle Plant 1 (scaled) | SYNTHETIC CONSUMER SCENARIO | BENCHMARK FEEDER · CIGRE MV | SIMULATED RESULTS.
2. Generation column: Solar, dataset **REAL · Kaggle Solar Plant 1**, date 2020-05-25, window **10:00–15:00**, rooftop PV 20× (summary bar: installed 4.20 MW).
3. Consumption: the **Residential Society** tile at bus 11. Network: CIGRE MV, battery 2 MW / 4 MWh at bus 11.
4. **RUN DIGITAL TWIN** → Grid Twin. Show the single-line diagram (green buses = within limits, line thickness = loading, arrows = power-flow direction), scrub time, click Line 1-2 in the inspector. Charts: PV vs feeder demand, voltage profile, loading, SOC. Status SAFE; INFO shows reverse flow at the feeder head, which is not a violation.
5. **Live Lab** → drag **PV output to 300 %**. Within ~0.1 s: max V ≈ 1.068 pu, line 1-2 ≈ 171 %, 11 live violations (overvoltage along feeder 1, line overloads), then the single-step heal preview.
6. **RUN FULL EVALUATION** → Heal & Verify runs automatically: 9 candidates, each re-simulated over 21 steps. Recommended: **Feeder reconfiguration** (2 switch operations), max line 171 % → 87 %, 0 % curtailment. Show that curtailment alone and battery + curtailment are infeasible (the cap binds), and reactive support fixes voltage but not overload (it adds current).
7. Move the **curtailment weight** / **switch weight** sliders: the ranking changes, feasibility does not.
8. **APPLY** → before/after table (Δ max line −84 pts, violation steps 21 → 0) and two diagrams at 12:15.
9. Builder → library **S6 — Extreme surplus** (battery full, 18.5 MW PV, 20 % cap) → Heal & Verify → FIND CORRECTIVE ACTIONS → red panel **NO FEASIBLE SOLUTION UNDER CURRENT CONSTRAINTS**: each candidate's first failure and reason; **35.9 % curtailment required vs 20 % cap**, reported and not applied.
10. **SAVE SCENARIO** → Library shows it; select two saved scenarios to compare.
11. Bonus — **Forecast & Predict**: the backtest (HGB beats persistence: MAE 0.093 vs 0.126 pu, 78 % P10–P90 coverage), then **RUN PREDICTIVE** on S7: P50 said safe, the frozen plan did nothing, the cloud cleared → **PLAN FAILED ON ACTUALS** at 11:45 (line 2-3 at 126 %).
12. Optional — **What-If**: "Increase solar by 150% and take the battery offline" → chips → RUN TWIN.

## 5-minute pitch

- **Problem (30 s).** Rooftop solar pushes power backwards up feeders built for one-way flow. Around midday that raises voltage and overloads lines, and utilities respond by curtailing clean energy. ENR-02 asks for a twin that predicts this and fixes it while wasting as little renewable energy as possible.
- **What we built (60 s).** A digital twin of the CIGRE MV benchmark feeder driven by real Indian PV data every 15 minutes. It runs full AC power flow, finds every violation, and tries battery, feeder switching, inverter reactive power and capped curtailment, alone and combined. Every option is re-simulated over the whole window before we call it safe.
- **Demo (2.5 min).** Normal day SAFE → triple the PV → violations → switching fixes it with zero curtailment → the extreme case where nothing works, and we say so with the exact number (35.9 % vs 20 %) → a forecast-based plan that fails when a cloud clears.
- **Why trust it (45 s).** Physics decides, AI explains. There are no hand-coded outcomes: scenario classes are asserted by 90 automated tests plus a 22-step scripted demo check. Every label says what is real, synthetic, representative or simulated.
- **What's next (15 s).** Real feeder data, unbalanced three-phase power flow, look-ahead battery scheduling.
