import type { Candidate, Evaluation, Metrics } from '../types/api'

export const metrics = (o: Partial<Metrics> = {}): Metrics => ({
  max_v: 1.0412, min_v: 0.9871, max_line_pct: 99.8, max_trafo_pct: 57.7, losses_mwh: 1.234, losses_pct: 1.1,
  pv_available_mwh: 30, pv_dispatched_mwh: 30, curtailed_mwh: 0, curtailed_pct: 0, max_step_curtail_pct: 0,
  max_required_curtail_pct: null, renewable_utilization_pct: 100, battery_throughput_mwh: 1.24, soc_max_pct: 49.8,
  soc_end_pct: 49.8, reactive_mvarh: 0, switch_ops: 0, import_mwh: 100, export_mwh: 0, peak_reverse_flow_mw: 0,
  peak_feeder_reverse_flow_mw: 3.2, n_steps: 21, n_violation_steps: 0, n_nonconverged_steps: 0, ...o,
})

export const cand = (o: Partial<Candidate>): Candidate => ({
  key: 'battery', name: 'Battery', available: true, feasible: true, status: 'FEASIBLE', metrics: metrics(), J: 2.516,
  penalty_breakdown: {}, rank: 1, recommended: false, explanation: 'x', ...o,
})

export const evaluation = (o: Partial<Evaluation> = {}): Evaluation => ({
  evaluation_id: 'abc', status: 'FEASIBLE', recommended: 'battery', baseline_status: 'VIOLATION',
  candidates: [cand({ recommended: true })], infeasibility: null, explanation: 'Battery was selected.',
  weights: { w_curt: 10, w_batt: 1, w_sw: 2, w_loss: 1, w_q: 0.2 },
  constraints: { v_min: 0.95, v_max: 1.05, line_loading_max: 100, trafo_loading_max: 100, reverse_flow_limit_mw: null, loss_pct_max: 8, max_curtailment_pct: 20, min_inverter_pf: 0.9 },
  honesty: { generation: 'REAL DATA · Kaggle Solar Plant 1 (scaled)', generation_is_real: true, generation_label: '', consumption: '', network: '', results: '', cloud_event: null },
  ...o,
})
