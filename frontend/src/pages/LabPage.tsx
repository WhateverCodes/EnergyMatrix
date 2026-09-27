import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FlaskConical } from 'lucide-react'
import { useScenario } from '../app/ScenarioContext'
import { ErrorBox, Kpi, Section, Spinner, StatusBadge } from '../components/Status'
import { NetworkDiagram, DiagramLegend } from '../features/grid/NetworkDiagram'
import { ViolationList } from './GridPage'
import { useDebounced } from '../hooks/useDebounced'
import { api } from '../services/api'
import { fmt, mw, pct, pu } from '../utils/format'

export interface LabInputs {
  time: string | null; pv_pct: number; demand_pct: number; consumer_scale: number; battery_available: boolean
  soc_pct: number; curtailment_cap_pct: number; v_max: number
}

export const LAB_DEBOUNCE_MS = 350

export default function LabPage() {
  const { config, setConfig, setLibraryId } = useScenario()
  const nav = useNavigate()
  const network = useQuery({ queryKey: ['network'], queryFn: api.network })
  const [inp, setInp] = useState<LabInputs | null>(null)
  useEffect(() => {
    if (config && !inp) setInp({ time: null, pv_pct: 100, demand_pct: 100, consumer_scale: config.consumer_scale, battery_available: config.battery.enabled,
      soc_pct: config.battery.soc_init_pct, curtailment_cap_pct: config.constraints.max_curtailment_pct, v_max: config.constraints.v_max })
  }, [config, inp])
  const d = useDebounced(inp, LAB_DEBOUNCE_MS)
  const body = useMemo(() => (d && config ? { config, ...d } : null), [d, config])
  const snap = useQuery({ queryKey: ['snapshot', body], queryFn: () => api.snapshot(body!), enabled: !!body, placeholderData: (p) => p, retry: false })
  // The heal preview needs extra power flows (~0.5 s), so it is a separate follow-up request.
  const violated = !!snap.data && snap.data.status !== 'SAFE' && !snap.isPlaceholderData
  const prev = useQuery({ queryKey: ['preview', body], queryFn: () => api.snapshot({ ...body!, include_preview: true }), enabled: !!body && violated, retry: false })

  if (!config || !inp) return <div className="p-6 text-ink-2">No scenario. <button className="text-accent underline" onClick={() => nav('/')}>Open the Scenario Builder</button>.</div>
  const s = snap.data
  const c = config.constraints
  const set = (patch: Partial<LabInputs>) => setInp({ ...inp, ...patch })
  const slider = (label: string, key: keyof LabInputs, min: number, max: number, step: number, unit: string) => (
    <label className="grid grid-cols-[1fr_auto] gap-1 px-3 py-2 border-b border-line/60">
      <span className="text-[12px] text-ink-2">{label}</span><span className="num">{String(inp[key])}{unit}</span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={Number(inp[key])} className="col-span-2"
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<LabInputs>)} />
    </label>
  )
  const fullEvaluation = () => {
    setLibraryId(null)
    setConfig({
      ...config, name: `${config.name} (Live Lab)`, pv_scale: config.pv_scale * inp.pv_pct / 100, demand_scale: config.demand_scale * inp.demand_pct / 100,
      consumer_scale: inp.consumer_scale, battery: { ...config.battery, enabled: inp.battery_available, soc_init_pct: inp.soc_pct },
      constraints: { ...c, max_curtailment_pct: inp.curtailment_cap_pct, v_max: inp.v_max },
    })
    nav('/actions', { state: { autorun: true } })
  }
  const k = s?.kpis ?? {}
  const pvBuses = [...new Set((network.data?.sgens ?? []).filter((g) => g.type === 'PV').map((g) => g.bus))]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="border-r border-line">
        <Section title="Inputs (real model inputs)">
          <label className="grid grid-cols-[1fr_auto] items-center px-3 py-2 border-b border-line/60">
            <span className="text-[12px] text-ink-2">Time step</span>
            <select aria-label="Time step" value={inp.time ?? s?.time ?? ''} onChange={(e) => set({ time: e.target.value })}>
              {(s?.steps ?? []).map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          {slider('PV output', 'pv_pct', 0, 300, 5, '%')}
          {slider('Demand', 'demand_pct', 20, 250, 5, '%')}
          {slider('Consumer scale', 'consumer_scale', 0, 6, 0.1, '×')}
          <label className="flex items-center justify-between px-3 py-2 border-b border-line/60">
            <span className="text-[12px] text-ink-2">Battery available</span>
            <input type="checkbox" aria-label="Battery available" checked={inp.battery_available} onChange={(e) => set({ battery_available: e.target.checked })} />
          </label>
          {slider('Battery SOC', 'soc_pct', 10, 90, 5, '%')}
          {slider('Curtailment cap', 'curtailment_cap_pct', 0, 100, 5, '%')}
          {slider('V max', 'v_max', 1.02, 1.1, 0.005, ' pu')}
          <div className="p-3">
            <button onClick={fullEvaluation} className="w-full inline-flex justify-center items-center gap-2 px-3 h-8 bg-accent text-bg font-medium">
              <FlaskConical size={14} /> RUN FULL EVALUATION
            </button>
            <p className="text-[11px] text-ink-3 mt-2">Applies these inputs to the whole window and simulates every corrective action.</p>
          </div>
        </Section>
      </aside>
      <div className="min-w-0">
        <div className="flex items-center gap-3 px-3 h-10 border-b border-line bg-surface">
          {s ? <StatusBadge status={s.status} /> : <Spinner label="solving" />}
          <span className="text-[12px] text-ink-3">single-step AC power flow at <span className="num text-ink">{s?.time ?? '…'}</span></span>
          {snap.isFetching && <Spinner label="" />}
          <span className="ml-auto num text-[11px] text-ink-3">{s ? `${fmt(s.latency_ms, 0)} ms` : ''}</span>
        </div>
        {snap.error ? <div className="p-3"><ErrorBox error={snap.error} /></div> : null}
        <div className="grid grid-cols-3 md:grid-cols-6 border-b border-line">
          <Kpi label="Max V" value={pu(k.max_v)} tone={(k.max_v ?? 0) > inp.v_max ? 'crit' : undefined} />
          <Kpi label="Min V" value={pu(k.min_v)} tone={(k.min_v ?? 1) < c.v_min ? 'crit' : undefined} />
          <Kpi label="Max line" value={pct(k.max_line_pct)} tone={(k.max_line_pct ?? 0) > c.line_loading_max ? 'crit' : undefined} />
          <Kpi label="Trafo" value={pct(k.max_trafo_pct)} />
          <Kpi label="Losses" value={mw(k.losses_mw, 3)} sub={pct(k.losses_pct, 2) + ' of load'} />
          <Kpi label="RE utilization" value={pct(k.renewable_utilization_pct)} sub={`PV ${mw(k.pv_dispatched_mw)} of ${mw(k.pv_available_mw)}`} />
          <Kpi label="Curtailed" value={mw(k.curtailed_mw)} />
          <Kpi label="Feeder reverse flow" value={mw(k.feeder_reverse_flow_mw)} />
          <Kpi label="Grid import" value={mw(k.import_mw)} />
          <Kpi label="Grid export" value={mw(k.export_mw)} />
          <Kpi label="Load" value={mw(k.load_mw)} />
          <Kpi label="Latency" value={s ? `${fmt(s.latency_ms, 0)} ms` : '—'} />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <div className="border-r border-line">
            {network.data && s && <NetworkDiagram network={network.data} step={s.step} vMin={c.v_min} vMax={inp.v_max} lineMax={c.line_loading_max}
              pvBuses={pvBuses} battery={inp.battery_available ? { bus: config.battery.bus } : null} height={420} />}
            <DiagramLegend />
          </div>
          <div>
            <Section title={`Live violations (${s?.violations.filter((v) => v.hard).length ?? 0})`}>
              <ViolationList violations={(s?.violations ?? []).filter((v) => v.hard)} />
            </Section>
            {violated && !prev.data && <div className="px-3 py-2"><Spinner label="computing single-step heal preview…" /></div>}
            {violated && prev.data?.preview && (
              <Section title="Single-step heal preview">
                <div className="px-3 py-2 text-[12px] space-y-1">
                  <div className="flex items-center gap-2"><StatusBadge status={prev.data.preview.status} /> <span className="text-ink-3">{prev.data.preview.label}</span></div>
                  <div className="num">battery {fmt(prev.data.preview.battery_p_mw, 2)} MW · curtail {pct(prev.data.preview.curtail_pct)}{prev.data.preview.required_curtail_pct !== null ? ` (required ${pct(prev.data.preview.required_curtail_pct)})` : ''} · max V {pu(prev.data.preview.max_v)} · max line {pct(prev.data.preview.max_line)}</div>
                  <ul className="text-ink-3 text-[11px]">{prev.data.preview.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </div>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
