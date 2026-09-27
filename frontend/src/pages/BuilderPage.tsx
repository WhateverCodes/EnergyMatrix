import { useMutation, useQuery } from '@tanstack/react-query'
import { Play, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useScenario } from '../app/ScenarioContext'
import { ErrorBox, Kpi, Section, Spinner, StatusBadge } from '../components/Status'
import { GenDemandChart } from '../components/charts'
import { useBootstrap } from '../hooks/useBootstrap'
import { useDebounced } from '../hooks/useDebounced'
import { api } from '../services/api'
import type { ScenarioConfig, StepRecord } from '../types/api'
import { fmt, mwh } from '../utils/format'

const FEEDER_BUSES = Array.from({ length: 14 }, (_, i) => i + 1)

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid grid-cols-[130px_1fr] items-center gap-2 px-3 py-1.5 border-b border-line/60">
      <span className="text-ink-2 text-[12px]">{label}</span>
      <span className="flex items-center gap-2 min-w-0">{children}</span>
      {hint ? <span className="col-start-2 text-[10px] text-ink-3 -mt-1">{hint}</span> : null}
    </label>
  )
}

function Slider({ value, min, max, step, onChange, unit, aria }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string; aria: string }) {
  return (
    <>
      <input type="range" aria-label={aria} className="flex-1" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="num w-16 text-right text-ink">{value}{unit}</span>
    </>
  )
}

const times = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)

export default function BuilderPage() {
  const lib = useBootstrap()
  const { config, setConfig, libraryId, setLibraryId, setRun } = useScenario()
  const nav = useNavigate()
  const datasets = useQuery({ queryKey: ['datasets'], queryFn: api.datasets })
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles })
  const debounced = useDebounced(config, 400)
  const summary = useQuery({ queryKey: ['build', debounced], queryFn: () => api.build(debounced!), enabled: !!debounced, retry: false })
  const run = useMutation({ mutationFn: api.run, onSuccess: (r) => { setRun(r); nav('/grid') } })

  if (!config) return <div className="p-6"><Spinner label="Loading scenario library…" /></div>
  const up = (patch: Partial<ScenarioConfig>) => { setLibraryId(null); setConfig({ ...config, ...patch }) }
  const solar = datasets.data?.filter((d) => d.source_type === 'solar') ?? []
  const dsId = config.dataset_id ?? solar.find((d) => d.id === 'kaggle_plant1')?.id ?? solar[0]?.id
  const dsMeta = solar.find((d) => d.id === dsId)
  const s = summary.data
  const pseudoSteps: StepRecord[] = s ? s.labels.map((l, i) => ({ label: l, pv_avail_mw: s.generation_mw[i], pv_dispatched_mw: s.generation_mw[i], feeder_load_mw: s.demand_feeder_mw[i] }) as StepRecord) : []

  return (
    <div className="flex flex-col">
      {/* library bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-line bg-surface">
        <span className="text-[11px] uppercase tracking-wider text-ink-3">Library scenario</span>
        <select aria-label="Library scenario" value={libraryId ?? ''} onChange={(e) => {
          const sc = lib.data?.find((x) => x.id === e.target.value)
          if (sc) { setConfig(sc.config as ScenarioConfig); setLibraryId(sc.id) }
        }}>
          <option value="">Custom</option>
          {lib.data?.map((x) => <option key={x.id} value={x.id}>{x.id} — {x.title}</option>)}
        </select>
        {libraryId && <span className="text-ink-3 text-[12px] truncate max-w-[60ch]">{lib.data?.find((x) => x.id === libraryId)?.description}</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 border-b border-line">
        {/* Generation */}
        <div className="border-r border-line">
          <Section title="Generation">
            <Field label="Source type"><span className="text-ink">Solar PV (wind held at 0 MW)</span></Field>
            <Field label="Dataset" hint={dsMeta?.label}>
              <select aria-label="Dataset" className="flex-1 min-w-0" value={dsId ?? ''} onChange={(e) => up({ dataset_id: e.target.value })}>
                {solar.map((d) => <option key={d.id} value={d.id}>{d.is_real ? 'REAL' : 'SYNTHETIC'} · {d.name}</option>)}
              </select>
            </Field>
            <Field label="Date">
              <select aria-label="Date" value={config.date} onChange={(e) => up({ date: e.target.value })}>
                {(dsMeta?.available_dates ?? [config.date]).map((d) => <option key={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Window">
              <select aria-label="Start" value={config.start} onChange={(e) => up({ start: e.target.value })}>{times.map((t) => <option key={t}>{t}</option>)}</select>
              <span className="text-ink-3">to</span>
              <select aria-label="End" value={config.end} onChange={(e) => up({ end: e.target.value })}>{times.map((t) => <option key={t}>{t}</option>)}</select>
            </Field>
            <Field label="Rooftop PV" hint={`× CIGRE nominal PV (0.21 MW) spread over buses 3–11 · installed ${s ? fmt(s.installed_pv_mw, 2) + ' MW' : '…'}`}>
              <Slider aria="PV multiplier" value={config.pv_multiplier} min={0} max={100} step={1} unit="×" onChange={(v) => up({ pv_multiplier: v })} />
            </Field>
            <Field label="PV cluster (MW)">
              <input type="number" aria-label="Cluster MW" className="w-20 num" min={0} max={20} step={0.5} value={config.rooftop_cluster_mw} onChange={(e) => up({ rooftop_cluster_mw: Number(e.target.value) })} />
              <span className="text-ink-3">at bus</span>
              <select aria-label="Cluster bus" value={config.rooftop_cluster_bus} onChange={(e) => up({ rooftop_cluster_bus: Number(e.target.value) })}>{FEEDER_BUSES.map((b) => <option key={b}>{b}</option>)}</select>
            </Field>
          </Section>
        </div>

        {/* Consumption */}
        <div className="border-r border-line">
          <Section title="Consumption" right={<span className="text-[10px] text-ink-3">SYNTHETIC CONSUMER SCENARIO</span>}>
            <div className="grid grid-cols-4 gap-px bg-line border-b border-line">
              {profiles.data?.map((p) => {
                const on = p.key === config.consumer_profile
                const pts = p.hourly_shape.map((v, i) => `${(i / 23) * 60},${18 - v * 16}`).join(' ')
                return (
                  <button key={p.key} aria-pressed={on} title={p.description} onClick={() => up({ consumer_profile: p.key })}
                    className={`bg-surface p-2 text-left ${on ? 'outline outline-1 outline-accent -outline-offset-1' : 'hover:bg-surface-2'}`}>
                    <div className={`text-[11px] ${on ? 'text-ink' : 'text-ink-2'}`}>{p.name}</div>
                    <svg width="60" height="20" className="mt-1"><polyline points={pts} fill="none" stroke="var(--color-s-demand)" strokeWidth={1.5} /></svg>
                    <div className="num text-[10px] text-ink-3">{p.base_kw}–{p.peak_kw} kW</div>
                  </button>
                )
              })}
            </div>
            <Field label="Target load bus">
              <select aria-label="Target bus" value={config.target_bus} onChange={(e) => up({ target_bus: Number(e.target.value) })}>{FEEDER_BUSES.map((b) => <option key={b}>{b}</option>)}</select>
            </Field>
            <Field label="Consumer scale"><Slider aria="Consumer scale" value={config.consumer_scale} min={0} max={5} step={0.1} unit="×" onChange={(v) => up({ consumer_scale: v })} /></Field>
            <Field label="All demand"><Slider aria="Demand scale" value={Math.round(config.demand_scale * 100)} min={50} max={150} step={5} unit="%" onChange={(v) => up({ demand_scale: v / 100 })} /></Field>
          </Section>
        </div>

        {/* Network */}
        <div>
          <Section title="Network">
            <Field label="Feeder"><span className="text-ink">CIGRE MV benchmark (representative)</span></Field>
            <Field label="Battery">
              <input type="checkbox" aria-label="Battery enabled" checked={config.battery.enabled} onChange={(e) => up({ battery: { ...config.battery, enabled: e.target.checked } })} />
              <span className="text-ink-3">at bus</span>
              <select aria-label="Battery bus" value={config.battery.bus} onChange={(e) => up({ battery: { ...config.battery, bus: Number(e.target.value) } })}>{FEEDER_BUSES.map((b) => <option key={b}>{b}</option>)}</select>
            </Field>
            <Field label="Battery size">
              <input type="number" aria-label="Battery MW" className="w-16 num" min={0} step={0.5} value={config.battery.p_max_mw} onChange={(e) => up({ battery: { ...config.battery, p_max_mw: Number(e.target.value) } })} /><span className="text-ink-3">MW</span>
              <input type="number" aria-label="Battery MWh" className="w-16 num" min={0.5} step={0.5} value={config.battery.e_max_mwh} onChange={(e) => up({ battery: { ...config.battery, e_max_mwh: Number(e.target.value) } })} /><span className="text-ink-3">MWh</span>
            </Field>
            <Field label="Initial SOC"><Slider aria="Initial SOC" value={config.battery.soc_init_pct} min={10} max={90} step={5} unit="%" onChange={(v) => up({ battery: { ...config.battery, soc_init_pct: v } })} /></Field>
            <Field label="Voltage limits">
              <input type="number" aria-label="V min" className="w-20 num" step={0.01} value={config.constraints.v_min} onChange={(e) => up({ constraints: { ...config.constraints, v_min: Number(e.target.value) } })} />
              <input type="number" aria-label="V max" className="w-20 num" step={0.01} value={config.constraints.v_max} onChange={(e) => up({ constraints: { ...config.constraints, v_max: Number(e.target.value) } })} /><span className="text-ink-3">pu</span>
            </Field>
            <Field label="Line loading max"><Slider aria="Line loading max" value={config.constraints.line_loading_max} min={60} max={120} step={5} unit="%" onChange={(v) => up({ constraints: { ...config.constraints, line_loading_max: v } })} /></Field>
            <Field label="Curtailment cap"><Slider aria="Curtailment cap" value={config.constraints.max_curtailment_pct} min={0} max={100} step={5} unit="%" onChange={(v) => up({ constraints: { ...config.constraints, max_curtailment_pct: v } })} /></Field>
          </Section>
        </div>
      </div>

      {/* summary bar from backend */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] border-b border-line">
        <div className="min-w-0">
          <div className="flex border-b border-line">
            <Kpi label="Installed PV" value={s ? `${fmt(s.installed_pv_mw, 2)} MW` : '…'} />
            <Kpi label="PV energy" value={s ? mwh(s.energy.generation_mwh) : '…'} />
            <Kpi label="Feeder demand" value={s ? mwh(s.energy.demand_feeder_mwh) : '…'} sub="excl. substation aggregate" />
            <Kpi label="Peak feeder surplus" value={s ? `${fmt(s.peak_net_surplus_feeder_mw, 2)} MW` : '…'} />
            <Kpi label="Steps" value={s ? String(s.labels.length) : '…'} sub="15-min" />
          </div>
          {summary.error ? <div className="p-3"><ErrorBox error={summary.error} /></div> : null}
          {s && <GenDemandChart steps={pseudoSteps} height={170} />}
        </div>
        <div className="flex lg:flex-col gap-2 p-3 border-l border-line justify-center">
          <button disabled={!s} onClick={() => summary.refetch()}
            className="inline-flex items-center gap-2 btn px-3 h-9 bg-surface-2 text-ink disabled:opacity-40">
            <Zap size={14} /> Build scenario
          </button>
          <button disabled={!s || run.isPending} onClick={() => run.mutate(config)}
            className="btn inline-flex items-center gap-2 px-3 h-9 bg-accent text-on-accent border-transparent disabled:opacity-40">
            <Play size={14} /> {run.isPending ? 'Running…' : 'Run digital twin'}
          </button>
          {run.error ? <ErrorBox error={run.error} /> : null}
          {summary.isFetching && <Spinner label="building" />}
          {s && <StatusBadge status="INFO" label={`${s.labels[0]}–${s.labels[s.labels.length - 1]}`} />}
        </div>
      </div>
    </div>
  )
}
