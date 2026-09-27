# Likely judge questions

**1. Is this a real Indian feeder?**
No. It is the CIGRE MV benchmark (TF C6.04.02), a published, documented representative network, and every screen labels it that way. The generation shape is real Indian plant data (Kaggle Plant 1). Demand is synthetic and labelled so.

**2. Where do the numbers on screen come from?**
Every electrical number comes from a pandapower AC Newton-Raphson power flow run by the backend. The frontend only formats values. The optional LLM never produces numbers; its rephrasings are rejected unless every number already appears in the simulation text.

**3. What does "feasible" mean exactly?**
The modified network was simulated at every 15-minute step of the window, every power flow converged, and every hard limit was met at every step: voltage 0.95–1.05 pu at 20 kV buses, line ≤ 100 %, transformer ≤ 100 %, plus reverse flow if a limit is set.

**4. Show me a case where your recommendation fails.**
Three, all computed. S6: at 18.5 MW PV with a full battery, every candidate is simulated and fails; all levers would still need 35.9 % curtailment against a 20 % cap. S5: an evening peak where curtailment is irrelevant, reported as 3.09 MW of load reduction needed. S7: a plan made on the forecast fails on actual data after a cloud clears.

**5. How do you maximise renewable use?**
Curtailment carries the heaviest penalty (w = 10 per MWh) and is always applied last, only for what the other levers left. Curtailment is capped at 20 % per step, and the minimum needed is found by bisection. The hosting-capacity map shows how much more PV each bus can take.

**6. Why did switching win over the battery in the Live Lab demo?**
At 3× PV the feeder head (lines 1-2, 2-3) carries the whole export. Two switch operations move buses 8–11 onto feeder 2's cables, which fixes every step with zero energy cost. The battery (2 MW / 4 MWh) saturates. In S2, where the surge is smaller, the battery wins because its J is lower than two switch operations.

**7. Can the ranking be changed?**
Yes. The penalty-weight sliders re-rank the stored results through the backend, e.g. make switching expensive and the battery is recommended. Feasibility never changes with weights.

**8. Why does reactive power not fix the overload?**
Absorbing Q lowers voltage (ΔV ≈ (R·P + X·Q)/V), but it adds current, so thermal loading gets worse. The twin shows this: reactive alone clears overvoltage and leaves LINE_OVERLOAD; in combinations the curtailment step releases Q when it helps.

**9. How accurate is the forecast?**
On a time-ordered backtest (daylight steps only), HistGradientBoosting P50 MAE is 0.093 pu vs 0.126 for the best baseline, and the P10–P90 band covers 78 % of actuals (target 80 %). This comes from 34 days of one plant in one season, so it is indicative.

**10. Is the forecast actually used, or decorative?**
It is used. Predictive mode forecasts 2 h ahead, runs the twin on P50 and P90, plans corrective actions on the forecast, freezes the plan, and replays it on actual data (S7, S8).

**11. Why not forecast demand with ML?**
Our demand profiles are deterministic synthetic schedules, so ML metrics on them would be fake. We use the schedule plus a configurable forecast error, labelled as such. `LoadDatasetAdapter` is ready for real metered load.

**12. What happens if the power flow does not converge?**
The step is marked `NON_CONVERGENCE`, a hard violation. It is never skipped or interpolated.

**13. How are the scenarios chosen? Did you tune them to look good?**
`make calibrate` sweeps PV penetration and records where violations start (42×), where the battery alone stops working (46×), where curtailment exceeds the cap (52×), and where nothing works (80×). Scenario parameters are set relative to those thresholds, and acceptance tests assert only the outcome class, never the numbers.

**14. Why 15-minute time series instead of a single snapshot?**
The battery is an energy resource. Whether it can absorb noon surplus depends on what it did at 11:00. QSTS carries SOC between steps, which is how S6's full battery fails.

**15. How long does it take?**
A Live Lab snapshot takes ~40–100 ms. A full evaluation of 9 candidates × 21 steps, with bisections, takes 5–9 s in parallel processes.

**16. How is reconfiguration kept safe?**
All 128 switch combinations are enumerated. 86 island a bus and 25 create a loop, and those are rejected. The 17 radial, fully energised configurations are screened with real power flows, and the chosen one is verified over the whole window.

**17. What about reverse power flow?**
It is tracked at the transformers and the feeder heads, and shown as INFO (not unsafe by itself). If you set a reverse-flow limit, it becomes a hard constraint.

**18. What if the Kaggle data is missing?**
The app runs on a SYNTHETIC clear-sky profile, labelled SYNTHETIC everywhere, and prints where to put the files.

**19. Can a DISCOM use its own data?**
Yes. CSV upload with column mapping, unit conversion, gap report and 15-min resampling; uploads are labelled UPLOADED · UNVERIFIED.

**20. What is the biggest limitation?**
Balanced power flow on a benchmark feeder. Real Indian LV feeders are unbalanced, with single-phase rooftop PV. The next step is an unbalanced three-phase solver on a real feeder model.

**21. Where does AI/LLM fit?**
The rule-based What-If parser works without any key. If a key is set, an LLM can parse free text into the same typed parameter edits (schema-validated) and rephrase explanations (numbers verified). It never decides anything physical.

**22. How do you know the code is correct?**
90 backend tests: sign conventions, SOC efficiency, bisection minimality, radiality, baseline immutability, every violation type, S1–S8 outcome classes. 4 frontend tests. `make demo-check`: 23/23 steps.
