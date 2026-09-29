# Technical viva questions

**1. Explain Newton-Raphson power flow.**
It solves the nonlinear bus power-balance equations P_i(V, θ), Q_i(V, θ) for unknown |V| and θ at PQ buses. Each iteration linearises the equations with the Jacobian J = ∂(P,Q)/∂(θ,|V|), solves J·Δx = mismatch, and updates x. Near the solution it converges quadratically; pandapower's tolerance is 1e-8 MVA.

**2. What is the slack bus and why do we need one?**
Losses are unknown until the power flow is solved, so one bus must absorb the power imbalance and provide the angle reference. Here that is bus 0 (the 110 kV external grid), with |V| = 1.03 pu and θ = 0.

**3. Why use the per-unit system?**
Normalising by base values makes limits comparable across voltage levels (1.05 pu means the same thing at 110 kV and 20 kV), removes ideal transformer ratios, and keeps numbers well-conditioned.

**4. What is a thermal limit and how is loading computed?**
The current a conductor can carry without overheating. Line loading % = I/I_max (0.145 kA ≈ 5.0 MVA at 20 kV); transformer loading = S/S_rated (25 MVA).

**5. Why does PV raise voltage?**
ΔV ≈ (R·P + X·Q)/V. When PV exports, P flows towards the substation, so the far end sits above the substation voltage. With R/X ≈ 0.7 on the overhead lines, both R·P and X·Q matter.

**6. Why is reactive power weak here?**
Inverter headroom is small at full output (S = 1.1·P gives |Q| ≤ 0.46·P), and absorbed Q raises current, which worsens thermal overload. On cables (R/X ≈ 1.4) the X·Q term is relatively smaller still.

**7. Why is a balanced power flow acceptable here?**
CIGRE MV is defined as a balanced three-phase benchmark, so positive-sequence modelling represents it faithfully. It would not be acceptable for an unbalanced LV feeder, which is a stated limitation.

**8. What is reverse power flow and is it dangerous?**
Power flowing from the feeder back towards the upstream grid. It is not unsafe by itself, but it can confuse protection and voltage regulation. We report it as INFO, or as a violation if a limit is configured.

**9. Write the SOC update.**
Charging: SOC' = SOC + p·η_c·Δt/E. Discharging: SOC' = SOC + p/η_d·Δt/E. η_c = η_d = √0.92, Δt = 0.25 h, SOC ∈ [0.1, 0.9], with power limited by p_max and the remaining energy headroom.

**10. Why QSTS rather than a single worst-case snapshot?**
Time-coupled resources (battery energy) and time-varying generation and load: a snapshot cannot tell whether the battery still has headroom at 12:30.

**11. How does bisection find the minimum curtailment?**
Feasibility is monotone near the minimum, so we halve the interval [feasible, infeasible] 8 times (resolution 1/256). If 100 % fails (e.g. it creates undervoltage), we coarse-scan for the first feasible point and bisect below it.

**12. Why is curtailment capped?**
The problem statement says "limited reduction". The cap also makes true infeasibility possible and honest: we report the required value instead of silently curtailing 50 %.

**13. Why apply levers in a fixed order?**
Non-curtailment levers keep renewable energy, so they go first and curtailment only removes the residual. Switching first because it changes topology for the whole window.

**14. How do you guarantee reconfiguration stays radial?**
We build the switch-respecting graph (including the shared 110 kV bus) and reject any configuration with a cycle or parallel branch, and any with de-energised buses (`pandapower.topology.unsupplied_buses`).

**15. What is the objective function?**
Lexicographic: feasibility first, then minimise J = 10·E_curt + 1·E_batt + 2·N_sw + 1·E_loss + 0.2·E_Q.

**16. Why not let an LLM solve the dispatch?**
LLMs do not guarantee physical feasibility and cannot be verified by inspection. Here the solver is physics (power flow), and every candidate is checked at every step. The LLM, if enabled, only maps words to input parameters and rephrases verified text.

**17. How is "no feasible solution" proven?**
Every available candidate within the configured limits was simulated at every step and each had at least one hard violation. We also report the minimum out-of-limit intervention (e.g. 35.9 % curtailment) without applying it.

**18. What forecast metrics did you use and why not MAPE?**
MAE, RMSE and nMAE on daylight steps. MAPE divides by the actual value, which is 0 at night (undefined) and explodes near dawn and dusk.

**19. Why a time-ordered split?**
Shuffling leaks future information (neighbouring 15-min samples are highly correlated), so the scores would be optimistic.

**20. How do the quantile models work?**
Gradient boosting with pinball loss at α = 0.1/0.5/0.9 gives P10/P50/P90. We enforce non-crossing, and the empirical P10–P90 coverage is 78 %.

**21. What is hosting capacity and how is it computed?**
The maximum additional PV at a bus before the first limit violation. We compute it by bisection on added MW under a worst-case snapshot (maximum PV with minimum load). On this feeder it is ~4.1–4.2 MW per feeder-1 bus, bound by line 1-2/2-3 thermal limits.

**22. What does the constraint engine check?**
UNDERVOLTAGE, OVERVOLTAGE, LINE_OVERLOAD, TRAFO_OVERLOAD, REVERSE_FLOW, EXCESSIVE_LOSSES (warning), NON_CONVERGENCE, ISLANDED_BUS. Severity is LOW/MEDIUM/HIGH at 0.01/0.03 pu voltage excess and 10/25 points loading excess.

**23. What is `recycle` in pandapower and is it safe?**
It reuses the internal admittance model when only P/Q injections change, which halves solve time. We verified equality with a fresh solve (1e-8 pu) and rebuild on any topology change (switches, in-service flags).

**24. How do you handle missing inverter data?**
The plant total is taken as the mean per reporting inverter × 22 and flagged; gaps ≤ 1 h are interpolated; night gaps are set to 0; longer daylight gaps are flagged and excluded from metrics.

**25. Why is Plant 1's DC power ignored?**
Its DC_POWER is ~10× AC_POWER, which is physically impossible for a 97–98 %-efficient inverter and so indicates a unit/scale error in the source. AC_POWER is consistent across both plants.

**26. What are the main sources of error in this twin?**
Constant-power loads at a fixed PF, synthetic demand, no OLTC or tap model, balanced modelling, a benchmark network, and a short, single-season solar record.

**27. How would you extend battery control?**
Replace the per-step "minimum needed" rule with look-ahead (MPC or multi-period OPF) using the P90 forecast, so energy headroom is reserved before the peak.
