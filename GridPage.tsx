import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pause, Play, ShieldCheck } from 'lucide-react'
import { useScenario } from '../app/ScenarioContext'
import { Kpi, Section, StatusBadge } from '../components/Status'
import { GenDemandChart, LoadingChart, SocChart, VoltageProfileChart } from '../components/charts'
import { NetworkDiagram, DiagramLegend, type Selection } from '../features/grid/NetworkDiagram'
import { Inspector } from '../features/grid/Inspector'
import { fmt, mwh, pct, pu } from '../utils/format'

export function ViolationList({ violations }: { violations: { type: string; name: string; value: number | null; limit: number | null; severity: string; steps?: string[] }[] }) {
  if (!violations.length) return <p className="px-3 py-2 text-ok text-[12px] flex items-center gap-1"><ShieldCheck size={14} /> No hard-limit violations.</p>
  return (
    <table className="w-full text-[12px]">
      <thead><tr className="text-ink-3 text-left text-[10px] uppercase tracking-wider">
        <th className="px-3 py-1 font-normal">Severity</th><th className="font-normal">Type</th><th className="font-normal">Element</th>
        <th className="font-normal text-right">Worst</th><th className="font-normal text-right">Limit</th><th className="font-normal px-3">Steps</th></tr></thead>
      <tbody>
        {violations.map((v, i) => (
          <tr key={i} className="border-t border-line/60">
            <td className="px-3 py-1"><StatusBadge status={v.severity} /></td>
            <td>{v.type.replace(/_/g, ' ')}</td><td>{v.name}</td>
            <td className="num text-right">{fmt(v.value, 3)}</td><td className="num text-right text-ink-3">{fmt(v.limit, 3)}</td>
            <td className="px-3 text-ink-3 num text-[11px]">{v.steps ? (v.steps.length > 3 ? `${v.steps[0]}–${v.steps[v.steps.length - 1]} (${v.steps.length})` : v.steps.join(', ')) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function GridPage() {
  const { run, config } = useScenario()
  const nav = useNavigate()
  const [k, setK] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [sel, setSel] = useState<Selection>(null)
  const worstIdx = useMemo(() => (run ? Math.max(0, run.steps.findIndex((s) => s.label === run.summary.worst_step)) : 0), [run])
  useEffect(() => { setK(worstIdx) }, [worstIdx])
  useEffect(() => {
    if (!playing || !run) return
    const id = setInterval(() => setK((x) => (x + 1) % run.steps.length), 600)
    return () => clearInterval(id)
  }, [playing, run])

  if (!run || !config) {
    return <div className="p-6 text-ink-2">No simulation yet. <button className="text-accent-ink underline" onClick={() => nav('/builder')}>Build and run a scenario</button> first.</div>
  }
  const step = run.steps[k]
  const c = config.constraints
  const m = run.metrics
  const pvBuses = [...new Set(run.network.sgens.filter((g) => g.type === 'PV').map((g) => g.bus).concat(config.rooftop_cluster_mw > 0 ? [config.rooftop_cluster_bus] : []))]
  const hard = run.summary.violations.filter((v) => v.hard)

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="border-r border-line">
        <div className="flex items-center gap-3 px-3 h-10 border-b border-line bg-surface">
          <StatusBadge status={run.status} />
          <span className="text-ink-3 text-[12px]">{config.name} · {config.date}</span>
          <span className="ml-auto text-[11px] text-ink-3">step</span>
          <span className="num text-accent-ink">{step.label}</span>
          <StatusBadge status={step.status} />
        </div>
        <NetworkDiagram network={run.network} step={step} switchStates={run.switch_states} vMin={c.v_min} vMax={c.v_max}
          lineMax={c.line_loading_max} battery={run.battery} pvBuses={pvBuses} selected={sel} onSelect={setSel} height={470} />
        <div className="flex items-center gap-3 px-3 py-2 border-t border-line">
          <button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} className="p-1 border border-line-strong">{playing ? <Pause size={14} /> : <Play size={14} />}</button>
          <input aria-label="Time step" type="range" min={0} max={run.steps.length - 1} value={k} onChange={(e) => { setPlaying(false); setK(Number(e.target.value)) }} className="flex-1" />
          <span className="num w-12 text-right">{step.label}</span>
        </div>
        <DiagramLegend />
        <Section title="Inspector"><Inspector sel={sel} step={step} network={run.network} c={c} /></Section>
      </div>
      <div className="min-w-0">
        <div className="grid grid-cols-3 sm:grid-cols-6 border-b border-line">
          <Kpi label="Max V" value={pu(m.max_v)} tone={m.max_v !== null && m.max_v > c.v_max ? 'crit' : undefined} />
          <Kpi label="Min V" value={pu(m.min_v)} tone={m.min_v !== null && m.min_v < c.v_min ? 'crit' : undefined} />
          <Kpi label="Max line" value={pct(m.max_line_pct)} tone={m.max_line_pct !== null && m.max_line_pct > c.line_loading_max ? 'crit' : undefined} />
          <Kpi label="Trafo" value={pct(m.max_trafo_pct)} />
          <Kpi label="Losses" value={mwh(m.losses_mwh, 3)} sub={pct(m.losses_pct, 2) + ' of load'} />
          <Kpi label="Viol. steps" value={`${m.n_violation_steps}/${m.n_steps}`} tone={m.n_violation_steps ? 'crit' : 'ok'} />
        </div>
        <Section title="Generation vs demand"><GenDemandChart steps={run.steps} cursor={step.label} /></Section>
        <Section title={`Voltage profile along feeder · ${step.label}`}><VoltageProfileChart step={step} vMin={c.v_min} vMax={c.v_max} /></Section>
        <Section title="Max loading over time"><LoadingChart steps={run.steps} lineMax={c.line_loading_max} cursor={step.label} /></Section>
        {run.battery && <Section title="Battery SOC (idle in baseline)"><SocChart steps={run.steps} cursor={step.label} /></Section>}
        <Section title={`Violations over window (${hard.length})`}
          right={hard.length ? <button onClick={() => nav('/actions')} className="text-[11px] text-accent-ink">Find corrective actions →</button> : null}>
          <ViolationList violations={hard} />
          {run.summary.info.length > 0 && (
            <p className="px-3 py-2 text-[11px] text-ink-3 border-t border-line/60">
              INFO: reverse power flow at {[...new Set(run.summary.info.map((v) => v.name))].join(', ')} (peak {fmt(m.peak_feeder_reverse_flow_mw, 2)} MW at feeder head) — not a violation unless a reverse-flow limit is set.
            </p>
          )}
        </Section>
      </div>
    </div>
  )
}
