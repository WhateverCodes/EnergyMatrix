import type {
  ApplyResult, DatasetMeta, Evaluation, HostingCapacity, LibraryScenario, LoadProfile, NetworkSummary, RunResult,
  SavedScenario, ScenarioConfig, ScenarioSummary, Snapshot, Weights, Constraints, Backtest, Predictive, WhatIfParse, WhatIfRun,
} from '../types/api'

export class ApiError extends Error {
  code: string
  details: unknown
  status: number
  constructor(status: number, code: string, message: string, details: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response
  try {
    r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
  } catch {
    throw new ApiError(0, 'BACKEND_UNREACHABLE', 'Backend not reachable on :8000 — run `make backend`', null)
  }
  const body = await r.json().catch(() => null)
  if (!r.ok) {
    throw new ApiError(r.status, body?.error_code ?? 'HTTP_ERROR', body?.message ?? r.statusText, body?.details)
  }
  return body as T
}
const post = <T>(path: string, data: unknown) => req<T>(path, { method: 'POST', body: JSON.stringify(data) })

export const api = {
  health: () => req<{ status: string }>('/api/health'),
  config: () => req<{ constraints: Constraints; weights: Weights; default_dataset: string; real_data_available: boolean }>('/api/config/constraints'),
  network: () => req<NetworkSummary>('/api/networks/cigre_mv'),
  datasets: () => req<DatasetMeta[]>('/api/datasets'),
  profiles: () => req<LoadProfile[]>('/api/load-profiles'),
  library: () => req<LibraryScenario[]>('/api/scenarios/library'),
  build: (c: ScenarioConfig) => post<ScenarioSummary>('/api/scenarios/build', c),
  run: (c: ScenarioConfig) => post<RunResult>('/api/simulate/run', c),
  snapshot: (body: Record<string, unknown>) => post<Snapshot>('/api/simulate/snapshot', body),
  evaluate: (c: ScenarioConfig, weights?: Weights) => post<Evaluation>('/api/actions/evaluate', { config: c, weights }),
  apply: (c: ScenarioConfig, key: string) => post<ApplyResult>('/api/actions/apply', { config: c, candidate_key: key }),
  save: (name: string, c: ScenarioConfig, selected?: string | null) =>
    post<SavedScenario & { explanation: string }>('/api/history', { name, config: c, selected_intervention: selected ?? null }),
  history: () => req<SavedScenario[]>('/api/history'),
  compare: (a: number, b: number) => req<{ a: SavedScenario; b: SavedScenario; rows: { metric: string; a: number | null; b: number | null }[] }>(`/api/history/compare?a=${a}&b=${b}`),
  backtest: (horizon: number, date?: string) => req<Backtest>(`/api/forecast/backtest?horizon=${horizon}${date ? `&date=${date}` : ''}`),
  predictive: (body: Record<string, unknown>) => post<Predictive>('/api/forecast/predictive', body),
  whatifParse: (text: string, useLlm: boolean) => post<WhatIfParse>('/api/whatif/parse', { text, use_llm: useLlm }),
  whatifRun: (c: ScenarioConfig, edits: unknown[], rephrase: boolean) => post<WhatIfRun>('/api/whatif/run', { config: c, edits, rephrase }),
  hosting: (c: ScenarioConfig) => post<HostingCapacity>('/api/hosting-capacity', c),
  upload: async (form: FormData) => {
    let r: Response
    try {
      r = await fetch('/api/datasets/upload', { method: 'POST', body: form })
    } catch {
      throw new ApiError(0, 'BACKEND_UNREACHABLE', 'Backend not reachable', null)
    }
    const body = await r.json().catch(() => null)
    if (!r.ok) throw new ApiError(r.status, body?.error_code ?? 'HTTP_ERROR', body?.message ?? r.statusText, body?.details)
    return body as { report: { ok: boolean; errors: string[]; warnings: string[]; rows_in: number; rows_out: number; dataset_id: string | null; missing_values: number; gaps_interpolated: number; long_gap_steps: number; coverage_start: string | null; coverage_end: string | null } }
  },
}
