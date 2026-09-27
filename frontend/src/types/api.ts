// Types mirror backend payloads (backend/app/schemas + api/*). Every number rendered comes from these.

export interface BatteryConfig {
  enabled: boolean; bus: number; p_max_mw: number; e_max_mwh: number
  soc_init_pct: number; soc_min_pct: number; soc_max_pct: number; eta_rt: number
}
export interface Constraints {
  v_min: number; v_max: number; line_loading_max: number; trafo_loading_max: number
  reverse_flow_limit_mw: number | null; loss_pct_max: number; max_curtailment_pct: number; min_inverter_pf: number
}
export interface Weights { w_curt: number; w_batt: number; w_sw: number; w_loss: number; w_q: number }
export interface CloudEvent { start: string; duration_min: number; depth: number }
export interface ScenarioConfig {
  name: string; dataset_id: string | null; date: string; start: string; end: string
  pv_multiplier: number; rooftop_cluster_mw: number; rooftop_cluster_bus: number; pv_scale: number
  cloud_event: CloudEvent | null
  consumer_profile: string; target_bus: number; consumer_scale: number; demand_scale: number; noise_seed: number | null
  battery: BatteryConfig; switch_states: Record<string, boolean> | null; lines_out_of_service: number[]
  constraints: Constraints; weights: Weights
}

export interface Honesty {
  generation: string; generation_is_real: boolean; generation_label: string
  consumption: string; network: string; results: string; cloud_event: string | null
}

export interface Bus { id: number; name: string; vn_kv: number; x: number; y: number }
export interface Line { id: number; name: string; from_bus: number; to_bus: number; length_km: number; max_i_ka: number }
export interface Trafo { id: number; name: string; hv_bus: number; lv_bus: number; sn_mva: number }
export interface Switch { id: number; name: string; bus: number; element: number; et: string; closed: boolean; switchable: boolean; kind: string }
export interface NetworkSummary {
  id: string; label: string; buses: Bus[]; lines: Line[]; trafos: Trafo[]; switches: Switch[]
  loads: { id: number; name: string; bus: number; p_mw: number }[]
  sgens: { id: number; name: string; bus: number; p_mw: number; type: string }[]
}

export interface Violation {
  type: string; element: string; id: number; name: string; value: number | null; limit: number | null
  severity: string; hard: boolean; steps?: string[]
}
export interface StepRecord {
  k: number; label: string; timestamp: string; converged: boolean; status: string
  bus_vm: (number | null)[]; line_loading: number[]; line_p_from: number[]; trafo_loading: number[]; trafo_p_hv: number[]
  max_v: number | null; min_v: number | null; max_line: number | null; max_trafo: number | null
  losses_mw: number | null; ext_grid_p: number | null; load_mw: number; feeder_load_mw: number
  pv_avail_mw: number; pv_dispatched_mw: number; curtailed_mw: number; curtail_pct: number
  required_curtail_pct: number | null; pv_q_mvar: number; battery_p_mw: number; soc_pct: number | null
  violations: Violation[]; notes: string[]; levers_used: string[]; health: number
}
export interface Metrics {
  max_v: number | null; min_v: number | null; max_line_pct: number | null; max_trafo_pct: number | null
  losses_mwh: number; losses_pct: number | null; pv_available_mwh: number; pv_dispatched_mwh: number
  curtailed_mwh: number; curtailed_pct: number; max_step_curtail_pct: number; max_required_curtail_pct: number | null
  renewable_utilization_pct: number | null; battery_throughput_mwh: number; soc_max_pct: number | null
  soc_end_pct: number | null; reactive_mvarh: number; switch_ops: number; import_mwh: number; export_mwh: number
  peak_reverse_flow_mw: number; peak_feeder_reverse_flow_mw: number; n_steps: number; n_violation_steps: number
  n_nonconverged_steps: number
}
export interface Summary { status: string; worst_step: string | null; violations: Violation[]; info: Violation[]; health: number; health_label: string }
export interface QstsPayload { status: string; summary: Summary; metrics: Metrics; switch_states: Record<string, boolean>; steps: StepRecord[] }

export interface ScenarioSummary {
  labels: string[]; timestamps: string[]; generation_mw: number[]; demand_mw: number[]; demand_feeder_mw: number[]
  net_surplus_mw: number[]; net_surplus_feeder_mw: number[]; installed_pv_mw: number; peak_net_surplus_feeder_mw: number
  energy: { generation_mwh: number; demand_mwh: number; demand_feeder_mwh: number }
  honesty: Honesty; dataset: DatasetMeta; notes: string[]
}
export interface RunResult extends QstsPayload {
  run_id: number; scenario: ScenarioSummary; honesty: Honesty; network: NetworkSummary
  battery: { bus: number; e_max_mwh: number; soc_max: number; soc_min: number } | null; config_key: string
}

export interface Failure {
  first_failing_step: string; failing_steps: string[]
  binding_constraint: { type: string; name: string; value: number | null; limit: number | null } | null; why: string[]
}
export interface Candidate {
  key: string; name: string; available: boolean; feasible: boolean; status: string
  unavailable_reason?: string; metrics: Metrics | null; J: number | null
  penalty_breakdown: Record<string, number> | null; rank: number; recommended: boolean; explanation: string
  params?: Record<string, unknown>; notes?: string[]; failure?: Failure | null; violations?: Violation[]
}
export interface Infeasibility {
  status: string
  candidates: { key: string; name: string; available: boolean; first_failing_step?: string; n_failing_steps?: number
    binding_constraint?: Failure['binding_constraint']; why: string[] }[]
  minimum_intervention: {
    problem_kind: string; applied: boolean; note: string
    required_curtailment_pct?: number; required_curtailment_step?: string; required_curtailment_with?: string; cap_pct?: number
    load_reduction?: { mw: number | null; fraction_pct?: number; step: string | null; scope: string | null }
  }
}
export interface Evaluation {
  evaluation_id: string; status: string; recommended: string | null; baseline_status: string
  candidates: Candidate[]; infeasibility: Infeasibility | null; explanation: string
  weights: Weights; constraints: Constraints; honesty: Honesty
}
export interface ApplyResult {
  candidate: Candidate; before: QstsPayload; after: QstsPayload; deltas: Record<string, number | null>
  verified: boolean; verification: string
}
export interface Snapshot {
  time: string; steps: string[]; status: string; step: StepRecord
  kpis: Record<string, number | null>; violations: Violation[]
  preview: null | { status: string; battery_p_mw: number; curtail_pct: number; required_curtail_pct: number | null
    max_v: number | null; max_line: number | null; notes: string[]; label: string }
  honesty: Honesty; latency_ms: number
}
export interface DatasetMeta {
  id: string; name: string; source_type: string; location: string; is_real: boolean; source: string
  description: string; label: string; coverage_start: string | null; coverage_end: string | null
  records: number; variables: string[]; capacity_kw: number | null; notes: string[]; available_dates?: string[]
  resolution_min: number
}
export interface LoadProfile { key: string; name: string; base_kw: number; peak_kw: number; weekend_factor: number; description: string; hourly_shape: number[] }
export interface LibraryScenario {
  id: string; title: string; description: string; expected_outcome: string; mode: string
  parameter_rationale: string; provenance: string; config: Partial<ScenarioConfig>
  predictive?: { t0: string; horizon_steps: number; model: string; plan_on: string }
}
export interface SavedScenario {
  id: number; name: string; feasibility: string; selected_intervention: string | null; created_at: string
  labels: Honesty; baseline_metrics: Metrics | null; final_metrics: Metrics | null
}
export interface HostingCapacity {
  worst_case: { max_pv_step: string; min_load_step: string; existing_pv_mw: number; load_mw: number }
  method: string
  buses: { bus: number; name: string; hosting_mw: number; binding: string | null; binding_element: string | null; note: string | null }[]
}

export interface ModelMetrics { mae: number | null; rmse: number | null; nmae_pct: number | null; n: number; by_horizon: Record<string, number | null>; p10_p90_coverage_pct?: number }
export interface Backtest {
  dataset_id: string; dataset: { id: string; name: string; is_real: boolean; label: string }
  split: { train_until: string; method: string; train_samples: number; test_daylight_samples: number }
  horizons_steps: number[]; metrics: Record<string, ModelMetrics>; best_baseline: string; ml_beats_best_baseline: boolean
  verdict: string; notes: string[]
  series: { date: string; horizon_steps: number; available_dates: string[]; timestamps: string[]; actual: number[]
    persistence_day: number[]; persistence_last: number[]; hgb: number[]; hgb_p10: number[]; hgb_p90: number[] }
}
export interface Predictive {
  t0: string; horizon_labels: string[]; model: string; plan_on: string; demand_forecast: string; model_training: string
  forecast: { p10: number[]; p50: number[]; p90: number[] }; actual_pu: number[]; history: { labels: string[]; pu: number[] }
  predicted: Record<'p50' | 'p90', { status: string; violating_steps: string[] }>
  plan: { candidate: string; planning_status: string; explanation: string; battery_p_mw: number[]; curtail_pct: number[] }
  replay: { outcome: string; failing_steps: string[]; steps: { label: string; status: string; max_v: number | null; max_line: number | null; battery_p_mw: number; curtail_pct: number }[] }
  outcome: string; why: string | null; honesty: Honesty & { forecast: string }
}

export interface WhatIfEdit { param: string; value: unknown; label: string; source?: string }
export interface WhatIfParse { edits: WhatIfEdit[]; unparsed: string[]; parser: string; notes: string[]; llm_available: boolean }
export interface WhatIfRun {
  config: ScenarioConfig; edits: WhatIfEdit[]
  baseline: { status: string; metrics: Metrics; violations: Violation[] }
  evaluation_status: string; recommended: Candidate | null; explanation: { text: string; source: string; note?: string }
  infeasibility: Infeasibility | null; honesty: Honesty
}
