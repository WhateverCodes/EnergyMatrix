import { AlertOctagon } from 'lucide-react'
import type { Evaluation } from '../../types/api'
import { fmt } from '../../utils/format'

/** Shown ONLY when the backend reports NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS. */
export function InfeasiblePanel({ evaluation }: { evaluation: Evaluation }) {
  if (evaluation.status !== 'NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS' || !evaluation.infeasibility) return null
  const inf = evaluation.infeasibility
  const mi = inf.minimum_intervention
  return (
    <section role="alert" aria-label="No feasible solution" className="border border-crit/70 bg-crit/[0.07]">
      <header className="flex items-center gap-2 px-3 h-9 border-b border-crit/40 text-crit font-semibold tracking-wide">
        <AlertOctagon size={16} /> NO FEASIBLE SOLUTION UNDER CURRENT CONSTRAINTS
      </header>
      <p className="px-3 py-2 text-[12px] text-ink-2">{evaluation.explanation}</p>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] border-t border-crit/30">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-ink-3 text-left">
            <th className="px-3 py-1 font-normal">Candidate</th><th className="font-normal">First failure</th><th className="font-normal">Binding constraint</th><th className="font-normal px-3">Why</th></tr></thead>
          <tbody>
            {inf.candidates.map((c) => (
              <tr key={c.key} className="border-t border-crit/20 align-top">
                <td className="px-3 py-1.5">{c.name}</td>
                <td className="num">{c.available ? `${c.first_failing_step} (${c.n_failing_steps} steps)` : 'not available'}</td>
                <td className="num text-[11px]">{c.binding_constraint ? `${c.binding_constraint.type} · ${c.binding_constraint.name} ${fmt(c.binding_constraint.value, 3)} vs ${fmt(c.binding_constraint.limit, 3)}` : '—'}</td>
                <td className="px-3 text-ink-2 text-[11px]"><ul>{c.why.map((w, i) => <li key={i}>{w}</li>)}</ul></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-l border-crit/30 p-3 space-y-2" data-testid="minimum-intervention">
          <div className="text-[10px] uppercase tracking-wider text-ink-3">Minimum intervention outside current limits</div>
          {mi.required_curtailment_pct !== undefined && (
            <div>
              <div className="num text-[26px] leading-8 text-crit">{fmt(mi.required_curtailment_pct, 1)}%</div>
              <div className="text-[12px] text-ink-2">curtailment required at {mi.required_curtailment_step} vs <span className="num">{fmt(mi.cap_pct, 0)}%</span> cap
                {mi.required_curtailment_with ? ` (with ${mi.required_curtailment_with.replace(/_/g, ' ')})` : ''}</div>
            </div>
          )}
          {mi.load_reduction && (
            <div>
              <div className="num text-[22px] leading-7 text-crit">{mi.load_reduction.mw === null ? 'not fixable' : `${fmt(mi.load_reduction.mw, 3)} MW`}</div>
              <div className="text-[12px] text-ink-2">load reduction ({mi.load_reduction.scope}) at {mi.load_reduction.step}</div>
            </div>
          )}
          <div className="text-[11px] text-ink-3">{mi.note}</div>
        </div>
      </div>
    </section>
  )
}
