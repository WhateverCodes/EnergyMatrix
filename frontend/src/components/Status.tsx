import { AlertOctagon, AlertTriangle, CheckCircle2, CircleSlash, Info, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

// Status is never colour alone: every badge carries an icon and a text label.
const STYLES: Record<string, { cls: string; icon: ReactNode; label?: string }> = {
  SAFE: { cls: 'text-ok border-ok/50', icon: <CheckCircle2 size={13} />, label: 'SAFE' },
  FEASIBLE: { cls: 'text-ok border-ok/50', icon: <CheckCircle2 size={13} /> },
  NO_ACTION_NEEDED: { cls: 'text-ok border-ok/50', icon: <CheckCircle2 size={13} />, label: 'NO ACTION NEEDED' },
  PLAN_HELD: { cls: 'text-ok border-ok/50', icon: <CheckCircle2 size={13} />, label: 'PLAN HELD' },
  VIOLATION: { cls: 'text-crit border-crit/60', icon: <AlertOctagon size={13} /> },
  NON_CONVERGENCE: { cls: 'text-crit border-crit/60', icon: <AlertOctagon size={13} />, label: 'NON-CONVERGENCE' },
  NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS: { cls: 'text-crit border-crit/60', icon: <AlertOctagon size={13} />, label: 'NO FEASIBLE SOLUTION' },
  PLAN_FAILED_ON_ACTUALS: { cls: 'text-crit border-crit/60', icon: <AlertOctagon size={13} />, label: 'PLAN FAILED ON ACTUALS' },
  UNAVAILABLE: { cls: 'text-ink-3 border-line-strong', icon: <CircleSlash size={13} /> },
  WARNING: { cls: 'text-warn border-warn/50', icon: <AlertTriangle size={13} /> },
  INFO: { cls: 'text-ink-2 border-line-strong', icon: <Info size={13} /> },
  HIGH: { cls: 'text-crit border-crit/60', icon: <AlertOctagon size={13} /> },
  MEDIUM: { cls: 'text-serious border-serious/60', icon: <AlertTriangle size={13} /> },
  LOW: { cls: 'text-warn border-warn/50', icon: <AlertTriangle size={13} /> },
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STYLES[status] ?? { cls: 'text-ink-2 border-line-strong', icon: <Info size={13} /> }
  return (
    <span className={`inline-flex items-center gap-1 border-2 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide rounded ${s.cls}`}>
      {s.icon}
      {label ?? s.label ?? status.replace(/_/g, ' ')}
    </span>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-2">
      <Loader2 size={14} className="animate-spin" /> {label}
    </span>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  const e = error as { code?: string; message?: string; details?: unknown }
  return (
    <div role="alert" className="border border-crit/60 bg-crit/10 px-3 py-2 text-[12px]">
      <div className="flex items-center gap-2 text-crit font-medium"><AlertOctagon size={14} /> {e.code ?? 'ERROR'}</div>
      <div className="text-ink-2 mt-1">{e.message ?? String(error)}</div>
      {e.details ? <pre className="num text-[11px] text-ink-3 mt-1 whitespace-pre-wrap">{JSON.stringify(e.details)}</pre> : null}
    </div>
  )
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'crit' | 'warn' | 'ok' }) {
  const toneCls = tone === 'crit' ? 'text-crit' : tone === 'warn' ? 'text-warn' : 'text-ink'
  const icon = tone === 'crit' ? <AlertOctagon size={12} className="text-crit" /> : tone === 'warn' ? <AlertTriangle size={12} className="text-warn" /> : null
  return (
    <div className="px-3 py-2 border-r border-line last:border-r-0 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-ink-3 flex items-center gap-1">{icon}{label}</div>
      <div className={`num text-[17px] leading-6 ${toneCls}`}>{value}</div>
      {sub ? <div className="text-[10px] text-ink-3 truncate">{sub}</div> : null}
    </div>
  )
}

export function Section({ title, right, children, className = '' }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`chunk m-2 overflow-hidden ${className}`}>
      <header className="flex items-center justify-between px-3 h-9 border-b-3 border-ink0 bg-surface-2">
        <h2 className="pixel text-[11px] text-accent-ink">{title}</h2>
        {right}
      </header>
      <div>{children}</div>
    </section>
  )
}
