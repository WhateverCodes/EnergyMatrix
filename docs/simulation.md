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
