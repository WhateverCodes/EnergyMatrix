# Corrective actions and optimisation

## Evaluation protocol (every candidate)

1. Copy the baseline network (`deepcopy` of the scenario net; the cached template is never touched).
2. `setup`: window-level changes (the switch configuration for reconfiguration candidates).
3. Full QSTS over every step. At each violated step, the candidate's levers act **in order** switching → battery → reactive → curtailment, and each lever only addresses what the earlier ones left unresolved ("curtail last"). A final authoritative power flow is run with the chosen controls.
4. The constraint engine checks every step; metrics are computed; feasible ⇔ every step converged and passed every hard constraint.

## Levers

| Lever | Decision rule | Search |
|---|---|---|
| Battery | Surplus problem (overvoltage, export-direction overload, reverse-flow limit) → charge; deficit (undervoltage, import overload) → discharge. | Bisection for the minimum MW in [0, min(p_max, SOC headroom)]; if even the maximum fails, apply the maximum and note it. |
| Reactive | Overvoltage → absorb; undervoltage → inject. Overload-only steps are left untouched (Q adds current). | Bisection on a common fraction of each inverter's capability min(√(S²−P²), P·tan acos 0.9). |
| Curtailment | Only for surplus problems (N/A for undervoltage). | Bisection on a uniform fraction in [0, 1]. **Required** is always recorded; **applied** = min(required, cap). If absorbed Q makes the residual overload worse, the curtailment lever also tries releasing Q and keeps whichever needs less curtailment. |
| Reconfiguration | One configuration for the whole window. | Enumerate 2⁷ = 128 states → reject islanded (86) or meshed (25) → screen the 17 radial ones with real power flows at the 4 worst baseline steps → choose most steps safe, then smallest residual excess, then fewest switch operations → full QSTS. |

The bisection helper handles a non-monotone top of range: e.g. 100 % curtailment can create an evening undervoltage, so if the upper bound fails it scans 10 grid points for the first feasible value and bisects below it. Eight iterations give 1/256 of the range (0.4 % curtailment resolution).

## Candidates

No action (baseline) · Battery · Feeder reconfiguration · Reactive support · Limited curtailment · Battery + curtailment · Reactive + curtailment · Switching + battery · All levers (switching + battery + reactive + curtailment). "All levers" runs with whichever levers are available (e.g. without the battery) and notes the exclusion. Pairs that need an unavailable lever are reported as unavailable, not simulated.

## Objective (lexicographic)

1. Feasibility: all steps converge and satisfy V, line, trafo limits (plus reverse flow if a limit is set).
2. Among feasible candidates minimise
   **J = w_curt·E_curtailed [MWh] + w_batt·E_battery_throughput [MWh] + w_sw·N_switch_ops + w_loss·E_losses [MWh] + w_q·E_reactive [MVArh]**,
   defaults w_curt = 10, w_batt = 1, w_sw = 2, w_loss = 1, w_q = 0.2. Curtailment is weighted 10× because wasted renewable energy is the thing the problem statement asks us to minimise.
3. Every candidate is returned with its metrics, J and penalty breakdown. Recommended = minimum J among feasible candidates. Infeasible candidates follow, ranked by number of violating steps.

Changing weights never changes feasibility. It re-ranks the stored metrics (evaluation cache), so no re-simulation is needed.

## Infeasibility report

If no candidate is feasible: `NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS`, and for each candidate the first failing step, the binding constraint (value vs limit), and the reasons (e.g. "battery SOC at 90% limit: cannot charge", "required curtailment up to 53.9% exceeds 20% cap", "reactive support released: it added line current"). **Minimum intervention outside current limits** (reported, never applied):
- surplus → required curtailment % (standalone and with all other levers; the smaller is headlined),
- deficit → required load reduction MW (feeder loads first, then including the substation aggregate), computed on the baseline network.

S6 example: all levers would still need **35.9 %** curtailment at 12:15 against a 20 % cap.
