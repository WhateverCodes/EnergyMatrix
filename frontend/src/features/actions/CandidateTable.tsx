import { Check, Star, X } from 'lucide-react'
import type { Candidate } from '../../types/api'
import { fmt, mwh, pct, pu } from '../../utils/format'

/** Renders every candidate exactly as returned by /api/actions/evaluate — no values computed here. */
export function CandidateTable({ candidates, onApply, applying }: { candidates: Candidate[]; onApply?: (key: string) => void; applying?: string | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]" aria-label="Corrective action candidates">
        <thead>
          <tr className="text-ink-3 text-[10px] uppercase tracking-wider text-left border-b border-line">
            <th className="px-3 py-1.5 font-normal">#</th><th className="font-normal">Candidate</th><th className="font-normal">Feasible</th>
            <th className="font-normal text-right">Max V</th><th className="font-normal text-right">Min V</th>
            <th className="font-normal text-right">Max line</th><th className="font-normal text-right">Trafo</th>
            <th className="font-normal text-right">Losses</th><th className="font-normal text-right">Curtailed</th>
            <th className="font-normal text-right">Batt. thr.</th><th className="font-normal text-right">Sw. ops</th>
            <th className="font-normal text-right">Viol. steps</th><th className="font-normal text-right pr-3">J</th><th />
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const m = c.metrics
            return (
              <tr key={c.key} data-testid={`cand-${c.key}`} title={c.explanation}
                className={`border-b border-line/60 ${c.recommended ? 'bg-accent/10 outline outline-1 outline-accent/60 -outline-offset-1' : ''} ${!c.available ? 'text-ink-3' : ''}`}>
                <td className="px-3 py-1.5 num text-ink-3">{c.rank}</td>
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-1">{c.recommended && <Star size={12} className="text-accent-ink" aria-label="recommended" />}{c.name}</span>
                  {c.recommended && <span className="ml-2 text-[10px] text-accent-ink uppercase tracking-wider">recommended</span>}
                </td>
                <td>
                  {!c.available ? <span className="text-ink-3">n/a — {c.unavailable_reason}</span>
                    : c.feasible ? <span className="text-ok inline-flex items-center gap-1"><Check size={13} /> yes</span>
                      : <span className="text-crit inline-flex items-center gap-1"><X size={13} /> no</span>}
                </td>
                <td className="num text-right">{m ? pu(m.max_v).replace(' pu', '') : '—'}</td>
                <td className="num text-right">{m ? pu(m.min_v).replace(' pu', '') : '—'}</td>
                <td className="num text-right">{m ? pct(m.max_line_pct) : '—'}</td>
                <td className="num text-right">{m ? pct(m.max_trafo_pct) : '—'}</td>
                <td className="num text-right">{m ? mwh(m.losses_mwh, 3) : '—'}</td>
                <td className="num text-right">{m ? `${pct(m.curtailed_pct)} · ${fmt(m.curtailed_mwh, 2)}` : '—'}</td>
                <td className="num text-right">{m ? fmt(m.battery_throughput_mwh, 2) : '—'}</td>
                <td className="num text-right">{m ? m.switch_ops : '—'}</td>
                <td className="num text-right">{m ? `${m.n_violation_steps}/${m.n_steps}` : '—'}</td>
                <td className="num text-right pr-3">{c.J === null ? '—' : fmt(c.J, 2)}</td>
                <td className="pr-3">
                  {onApply && c.available && c.key !== 'none' && (
                    <button onClick={() => onApply(c.key)} disabled={!!applying}
                      className={`px-2 h-6 text-[11px] border ${c.recommended ? 'border-accent text-accent-ink' : 'border-line-strong text-ink-2'} disabled:opacity-40`}>
                      {applying === c.key ? '…' : 'Apply'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
