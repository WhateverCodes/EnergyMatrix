# Simulation: the digital twin and its physics

## 1. The network — CIGRE MV benchmark (facts as inspected)

Built with `pandapower.networks.create_cigre_network_mv(with_der="pv_wind")`, pandapower **3.5.5**.
CIGRE Task Force C6.04.02 medium-voltage benchmark. **Representative, not a real Indian feeder.**

| Item | Inspected fact |
|---|---|
| Buses | 15. Bus 0 = 110 kV (external grid / slack, vm = 1.03 pu). Buses 1–14 = 20 kV. |
| Transformers | Trafo 0-1 and Trafo 0-12: 25 MVA, 110/20 kV, vk = 12 %, no tap changer modelled. |
| Feeder 1 | Buses 1–11: overhead lines, r = 0.501 Ω/km, x = 0.716 Ω/km (R/X ≈ 0.70), max_i = 0.145 kA (≈ 5.0 MVA at 20 kV). |
| Feeder 2 | Buses 12–14: cables, r = 0.510 Ω/km, x = 0.366 Ω/km (R/X ≈ 1.39), max_i = 0.195 kA. |
| Tie switches | S1 (line 14-8), S2 (line 6-7), S3 (line 11-4); all normally **open**. |
| Added sectionalizers | SW 3-8, SW 8-9, SW 10-11, SW 5-6; normally **closed** (added by us; see decisions.md). |
| Loads | 18 loads: residential `Load R*` and commercial/industrial `Load CI*`. Buses 1 and 12 carry ~20 MW aggregated each (the rest of the substation's supply area). |
| PV | 8 sgens `PV 3…PV 11`, 0.01–0.04 MW each (0.2 MW total) — far too small to stress the feeder, hence the penetration multiplier and rooftop cluster. |
| Wind | `WKA 7`, 1.5 MW at bus 7 — **held at 0 MW** in this build. |
| Storage | None in the built-in net; one battery is added per scenario. |
| Geodata | `net.bus["geo"]` holds GeoJSON Point strings (pandapower 3.x); used directly for the single-line diagram. |

**Switch configurations.** 7 switchable switches → 128 combinations. Topology checks
(`pandapower.topology.unsupplied_buses`, loop detection on `create_nxgraph`) leave **17 radial,
fully energized** configurations; 86 island at least one bus and 25 are meshed (two feeders
tied through the shared 110 kV bus also count as a loop).

**Baseline behaviour (all loads at nominal = peak):** min voltage 0.926 pu at bus 11, Trafo 0-1 at
100.4 %, lines 1-2 and 2-3 at ≈ 92 %. So a CIGRE evening peak is already marginal — useful for the
evening undervoltage scenario.

**Midday (loads at 40 %), PV cluster at bus 11:** 4 MW → V_max 1.045 pu; 6 MW → 1.065 pu and
line 10-11 at 110 %; 8 MW → 1.083 pu, 145 %.

## 2. Sign conventions (verified by unit tests)

- `storage.p_mw > 0` = **charging** (consumes from the grid; external-grid import rises).
- `res_trafo.p_hv_mw > 0` = import from 110 kV; **< 0 = reverse power flow** to the 110 kV grid.
- `sgen.q_mvar < 0` = inverter **absorbing** reactive power (lowers voltage).

## 3. Power flow

`pp.runpp(net, algorithm="nr")` — full AC Newton-Raphson. Within one topology the solver reuses its
internal admittance model (`recycle={"bus_pq": True}`, verified to match a fresh solve to 1e-8 pu),
cutting a solve from ≈ 23 ms to ≈ 10 ms. Any topology change forces a rebuild. `LoadflowNotConverged`
becomes a `NON_CONVERGENCE` step status — never skipped.

## 4. QSTS and battery state of charge

Steps are 15 min (dt = 0.25 h), simulated in order. Per step the loads and available PV are set,
corrective levers (if any) adjust the controls using real power flows, a final authoritative PF is run,
and the constraint engine checks it. Battery energy is carried between steps:

```
charging  (p > 0):  SOC[k+1] = SOC[k] + p · η_c · dt / E
discharge (p < 0):  SOC[k+1] = SOC[k] + p / η_d · dt / E
η_c = η_d = √η_rt = √0.92 ≈ 0.959,   SOC ∈ [10 %, 90 %]
max charge    = min(p_max, (SOC_max − SOC) · E / (η_c · dt))
max discharge = min(p_max, (SOC − SOC_min) · E · η_d / dt)
```

Loads use a fixed 0.95 lagging power factor (Q = P · tan φ).

## 5. Why PV raises voltage, and why reactive power is only a partial fix

Across a line with resistance R and reactance X, sending P and Q gives approximately
**ΔV ≈ (R·P + X·Q) / V**. Reverse PV export (P flowing back towards the substation) makes ΔV
negative along the direction of supply, so the far end of the feeder rises above the substation voltage.
Absorbing reactive power (Q < 0) cancels part of R·P. On feeder 1's overhead lines R/X ≈ 0.70, so
1 MVAr has about 1.4× the voltage effect of 1 MW. But at full PV output an inverter with S = 1.1·P has
only √(1.21 − 1) ≈ 0.46 pu of Q headroom, and absorbed Q *adds* current. So reactive support clears
mild overvoltage and cannot help a thermal overload; on feeder 2's cables (R/X ≈ 1.39) it is weaker still.

## 6. Calibration results (`make calibrate` → simulation/calibration.json)

Window 10:00–15:00 on the clearest day of Kaggle Plant 1 (**2020-05-25**; roughest/cloudiest day
2020-06-06). Distributed rooftop PV = CIGRE nominal PV (0.21 MW) × multiplier.

| Threshold | Multiplier | Installed PV |
|---|---|---|
| First baseline violation (line 1-2/2-3 overload + overvoltage) | 42 | 8.8 MW |
| Battery alone (2 MW / 4 MWh, SOC 20 %) still sufficient | ≤ 46 | 9.7 MW |
| Curtailment alone needs more than the 20 % cap | ≥ 52 | 10.9 MW |
| No candidate feasible, battery unavailable (all other levers combined) | ≥ 80 | 16.8 MW |

**Hosting capacity** (multiplier 20, worst case = 12:15 PV with 10:00 load): about **4.1–4.2 MW** extra
at any feeder-1 bus, bound by line 1-2 / 2-3 thermal limits (5 MVA overhead line). Feeder 2: 7.5 MW at
bus 13 (line 12-13) and 5.0 MW at bus 14 (overvoltage). On this benchmark, thermal capacity at the
feeder head, not voltage, limits PV on feeder 1.

Scenario parameters in `simulation/scenarios/*.json` are set relative to these thresholds.

## 7. Newton-Raphson AC power flow and the per-unit system

Each bus has four quantities: P, Q, |V| and θ. The slack bus (bus 0, the 110 kV external grid) fixes |V| = 1.03 pu and θ = 0 and absorbs the power mismatch. All other buses here are PQ buses (loads and PV at specified P and Q). Newton-Raphson solves the nonlinear power-balance equations
P_i = Σ_k |V_i||V_k|(G_ik cos θ_ik + B_ik sin θ_ik), Q_i = Σ_k |V_i||V_k|(G_ik sin θ_ik − B_ik cos θ_ik)
by repeatedly linearising with the Jacobian, J·[Δθ, Δ|V|] = [ΔP, ΔQ], until the mismatch is below 1e-8 MVA. It converges quadratically near the solution. If the power demanded cannot be delivered (past the nose of the PV curve), no solution exists, and pandapower raises `LoadflowNotConverged`. We report that as `NON_CONVERGENCE`.

**Per unit:** quantities are divided by base values (S_base, and V_base per voltage level, so Z_base = V_base²/S_base). 1.05 pu at a 20 kV bus means 21.0 kV. Per unit makes voltage limits comparable across 110 kV and 20 kV and removes transformer ratios from the equations.

**Thermal limits:** line loading % = I / I_max (0.145 kA ≈ 5.0 MVA at 20 kV for the overhead lines). Transformer loading % = S / S_rated (25 MVA).

**Balanced power flow:** CIGRE MV is specified as a balanced three-phase benchmark, so a positive-sequence power flow represents it faithfully. It would not represent an unbalanced LV feeder with single-phase rooftop PV (see the limitations in the README).

## 8. Grid-health score (Play view)

A 0–5 score per step, computed in the backend from the constraint results. Window health = the worst step.
5 HEALTHY: comfortable margins · 4 STRAINED: within 0.01 pu of a voltage limit or above 80 % of a thermal limit · 3 WARNING: LOW-severity violation · 2 DANGER: MEDIUM · 1 CRITICAL: HIGH · 0 FAILED: non-convergence or islanded bus.
