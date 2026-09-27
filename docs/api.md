# API

FastAPI; interactive OpenAPI at `http://localhost:8000/docs`. Request bodies are typed Pydantic models; responses are JSON with NaN/inf converted to `null`.

**Errors:** `{"error_code": str, "message": str, "details": any}`; validation errors → `422 VALIDATION_ERROR`; unexpected exceptions → `500 INTERNAL_ERROR` (no stack trace).

| Method & path | Body / query | Returns |
|---|---|---|
| GET `/api/health` | — | `{status}` |
| GET `/api/config/constraints` | — | default constraints, weights, severity thresholds, default dataset, whether real data is available |
| GET `/api/networks`, `/api/networks/{id}` | — | network list; buses (with coordinates), lines, trafos, switches (kind: tie/sectionalizer/fixed), loads, sgens |
| GET `/api/datasets` | — | dataset metadata incl. `is_real`, coverage, variables, notes, available dates |
| POST `/api/datasets/upload` | multipart: file, timestamp_col, value_col, unit, source_type, name, location | `{report}` validation report |
| GET `/api/datasets/{id}/series` | `start`, `end` | normalised series (≤ 5000 points) |
| GET `/api/load-profiles`, `/api/load-profiles/{type}/series` | `date`, `scale` | catalogue / 96-step demand |
| POST `/api/scenarios/build` | `ScenarioConfig` | per-step generation, demand, surplus, installed PV, energies, honesty labels |
| GET `/api/scenarios/library`, `/{id}` | — | S1–S8 with full configs, expected outcome class, rationale |
| POST `/api/simulate/run` | `ScenarioConfig` | baseline QSTS: status, summary (violations with steps), metrics, per-step records, network, `run_id` |
| POST `/api/simulate/snapshot` | `{config, time?, pv_pct, demand_pct, consumer_scale?, battery_available?, soc_pct?, curtailment_cap_pct?, v_max?, include_preview}` | single-step power flow + KPIs + violations (+ heal preview) + latency |
| GET `/api/simulate/latency` | — | p50/p95/max snapshot latency |
| POST `/api/actions/evaluate` | `{config, weights?}` | status (`NO_ACTION_NEEDED` / `FEASIBLE` / `NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS`), ranked candidates with metrics, J, breakdown, failure analysis, infeasibility report, explanation |
| POST `/api/actions/apply` | `{config, candidate_key}` | before/after QSTS payloads, deltas, `verified` |
| GET/POST `/api/hosting-capacity` | query (`network, date, start, end, pv_multiplier`) or `ScenarioConfig` | per-bus hosting MW + binding constraint |
| GET `/api/forecast/backtest` | `dataset?, date?, horizon` | metrics per model, verdict, series for one test day |
| POST `/api/forecast/predictive` | `{scenario_id | config, t0?, horizon_steps?, model?, plan_on?, demand_error_pct}` | forecast P10/P50/P90, predicted violations, frozen plan, replay outcome |
| POST `/api/whatif/parse` | `{text, use_llm}` | edits (typed), unparsed fragments, parser used |
| POST `/api/whatif/run` | `{config, edits, rephrase}` | modified config, baseline, evaluation status, recommended, explanation (+ source) |
| POST `/api/history` | `{name, config, selected_intervention?}` | saved scenario (baseline, intervention, final metrics, feasibility) |
| GET `/api/history`, `/api/history/{id}`, `/api/history/compare?a&b` | — | list / detail / side-by-side metrics |

`ScenarioConfig` (all optional with defaults): `name, dataset_id, date, start, end, pv_multiplier, rooftop_cluster_mw, rooftop_cluster_bus, pv_scale, cloud_event{start,duration_min,depth}, consumer_profile, target_bus, consumer_scale, demand_scale, noise_seed, battery{enabled,bus,p_max_mw,e_max_mwh,soc_init_pct,soc_min_pct,soc_max_pct,eta_rt}, switch_states, lines_out_of_service, constraints{…}, weights{…}`.
