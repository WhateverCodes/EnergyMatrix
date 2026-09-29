import type { NetworkSummary, StepRecord, Constraints } from '../../types/api'
import type { Selection } from './NetworkDiagram'
import { StatusBadge } from '../../components/Status'
import { fmt } from '../../utils/format'

export function Inspector({ sel, step, network, c }: { sel: Selection; step: StepRecord | null; network: NetworkSummary; c: Constraints }) {
  if (!sel || !step) return <p className="px-3 py-2 text-ink-3 text-[12px]">Click a bus, line or transformer to inspect it.</p>
  const viol = step.violations.filter((v) => v.element === sel.kind && v.id === sel.id)
  const row = (k: string, v: string) => (
    <div className="grid grid-cols-[110px_1fr] px-3 py-1 border-b border-line/60"><span className="text-ink-3">{k}</span><span className="num">{v}</span></div>
  )
  let body: React.ReactNode = null
  if (sel.kind === 'bus') {
    const b = network.buses.find((x) => x.id === sel.id)!
    const loads = network.loads.filter((l) => l.bus === sel.id)
    const pv = network.sgens.filter((g) => g.bus === sel.id && g.type === 'PV')
    body = <>
      {row('Element', `${b.name} (${b.vn_kv} kV)`)}
      {row('Voltage', `${fmt(step.bus_vm[sel.id], 4)} pu`)}
      {b.vn_kv < 100 && row('Limits', `${c.v_min} – ${c.v_max} pu`)}
      {row('Loads', loads.length ? loads.map((l) => l.name).join(', ') : '—')}
      {row('PV (CIGRE)', pv.length ? pv.map((g) => g.name).join(', ') : '—')}
    </>
  } else if (sel.kind === 'line') {
    const l = network.lines.find((x) => x.id === sel.id)!
    const p = step.line_p_from[sel.id]
    body = <>
      {row('Element', `${l.name} · ${l.length_km} km`)}
      {row('Loading', `${fmt(step.line_loading[sel.id], 1)} % (limit ${c.line_loading_max} %)`)}
      {row('Thermal rating', `${l.max_i_ka} kA`)}
      {row('P flow (from end)', `${fmt(p, 3)} MW ${p < 0 ? `(towards bus ${l.from_bus})` : `(towards bus ${l.to_bus})`}`)}
    </>
  } else {
    const t = network.trafos.find((x) => x.id === sel.id)!
    const p = step.trafo_p_hv[sel.id]
    body = <>
      {row('Element', `${t.name} · ${t.sn_mva} MVA`)}
      {row('Loading', `${fmt(step.trafo_loading[sel.id], 1)} % (limit ${c.trafo_loading_max} %)`)}
      {row('P at 110 kV', `${fmt(p, 3)} MW ${p < 0 ? '(REVERSE flow to 110 kV)' : '(import)'}`)}
    </>
  }
  return (
    <div className="text-[12px]">
      {body}
      <div className="px-3 py-2 flex flex-wrap gap-1">
        {viol.length ? viol.map((v, i) => <StatusBadge key={i} status={v.hard ? v.severity : v.severity} label={`${v.type} ${v.severity}`} />) : <StatusBadge status="SAFE" label="WITHIN LIMITS" />}
      </div>
    </div>
  )
}
