import type { ApplyResult, NetworkSummary, Constraints } from '../../types/api'
import { NetworkDiagram } from '../grid/NetworkDiagram'
import { LoadingChart, VoltageProfileChart, SocChart } from '../../components/charts'
import { Section, StatusBadge } from '../../components/Status'
import { fmt, signed } from '../../utils/format'

const DELTAS: [string, string, number][] = [
  ['max_v', 'Max V (pu)', 3], ['min_v', 'Min V (pu)', 3], ['max_line_pct', 'Max line %', 1], ['max_trafo_pct', 'Max trafo %', 1],
  ['losses_mwh', 'Losses MWh', 3], ['curtailed_mwh', 'Curtailed MWh', 2], ['renewable_utilization_pct', 'Renewable use %', 1],
  ['n_violation_steps', 'Violation steps', 0],
]

export function BeforeAfter({ result, network, c, pvBuses, battery }: { result: ApplyResult; network: NetworkSummary; c: Constraints; pvBuses: number[]; battery: { bus: number } | null }) {
  const b = result.before, a = result.after
  const worst = b.summary.worst_step
  const k = Math.max(0, b.steps.findIndex((s) => s.label === worst))
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-line">
        <span className="font-medium">{result.candidate.name}</span>
        <StatusBadge status={result.verified ? 'SAFE' : 'VIOLATION'} label={result.verified ? 'VERIFIED FEASIBLE' : 'NOT FEASIBLE'} />
        <span className="text-[12px] text-ink-3">{result.verification}</span>
      </div>
      <table className="w-full max-w-3xl text-[12px] border-b border-line">
        <thead><tr className="text-[10px] uppercase tracking-wider text-ink-3 text-left">
          <th className="px-3 py-1 font-normal">Metric</th><th className="font-normal text-right">Before</th><th className="font-normal text-right">After</th><th className="font-normal text-right pr-3">Δ</th></tr></thead>
        <tbody>
          {DELTAS.map(([key, label, nd]) => (
            <tr key={key} className="border-t border-line/60">
              <td className="px-3 py-1 text-ink-2">{label}</td>
              <td className="num text-right">{fmt((b.metrics as unknown as Record<string, number>)[key], nd)}</td>
              <td className="num text-right">{fmt((a.metrics as unknown as Record<string, number>)[key], nd)}</td>
              <td className="num text-right pr-3">{signed(result.deltas[key], nd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="border-r border-line">
          <div className="px-3 pt-2 text-[11px] uppercase tracking-wider text-ink-3">Before · {b.steps[k].label} <StatusBadge status={b.steps[k].status} /></div>
          <NetworkDiagram network={network} step={b.steps[k]} switchStates={b.switch_states} vMin={c.v_min} vMax={c.v_max} lineMax={c.line_loading_max} pvBuses={pvBuses} battery={battery} height={330} title="Before" />
        </div>
        <div>
          <div className="px-3 pt-2 text-[11px] uppercase tracking-wider text-ink-3">After · {a.steps[k].label} <StatusBadge status={a.steps[k].status} /></div>
          <NetworkDiagram network={network} step={a.steps[k]} switchStates={a.switch_states} vMin={c.v_min} vMax={c.v_max} lineMax={c.line_loading_max} pvBuses={pvBuses} battery={battery} height={330} title="After" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 border-t border-line">
        <Section title={`Voltage profile · ${b.steps[k].label}`} className="border-r border-line"><VoltageProfileChart step={a.steps[k]} compare={b.steps[k]} vMin={c.v_min} vMax={c.v_max} /></Section>
        <Section title="Max line loading over window"><LoadingChart steps={a.steps} compare={b.steps} lineMax={c.line_loading_max} /></Section>
      </div>
      {battery && a.metrics.battery_throughput_mwh > 0 && <Section title="Battery SOC (after)"><SocChart steps={a.steps} /></Section>}
    </div>
  )
}
