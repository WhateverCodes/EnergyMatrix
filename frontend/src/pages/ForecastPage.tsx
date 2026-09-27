import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Play } from 'lucide-react'
import { api } from '../services/api'
import { useScenario } from '../app/ScenarioContext'
import { ErrorBox, Section, Spinner, StatusBadge } from '../components/Status'
import { fmt, pct } from '../utils/format'
import type { Predictive } from '../types/api'

const AX = { stroke: 'var(--color-line-strong)', tick: { fill: 'var(--color-ink-3)', fontSize: 10, fontFamily: 'JetBrains Mono' } }
const TIP = {
  contentStyle: { background: 'var(--color-surface-2)', border: '1px solid var(--color-line-strong)', borderRadius: 2, fontSize: 11 },
  itemStyle: { color: 'var(--color-ink)', fontFamily: 'JetBrains Mono', padding: 0 }, labelStyle: { color: 'var(--color-ink-2)' },
}
// Legend text stays in ink tokens; the swatch beside it carries the series colour.
const LEG = { wrapperStyle: { fontSize: 11 }, iconSize: 10, formatter: (v: string) => <span style={{ color: 'var(--color-ink-2)' }}>{v}</span> }
const f4 = (v: unknown) => (Array.isArray(v) ? v.map((x) => Number(x).toFixed(3)).join(' – ') : typeof v === 'number' ? v.toFixed(3) : String(v))
const MODEL_LABEL: Record<string, string> = {
  persistence_day: 'Persistence (same time yesterday)', persistence_last: 'Persistence (last value)',
  rolling_mean: 'Rolling mean (1 h)', hgb: 'HistGradientBoosting (P50)',
}

function Backtest() {
  const [horizon, setHorizon] = useState(4)
  const [date, setDate] = useState<string | undefined>(undefined)
  const q = useQuery({ queryKey: ['backtest', horizon, date], queryFn: () => api.backtest(horizon, date), placeholderData: (p) => p })
  const b = q.data
  const data = b ? b.series.timestamps.map((t, i) => ({
    t, actual: b.series.actual[i], day: b.series.persistence_day[i], last: b.series.persistence_last[i],
    p50: b.series.hgb[i], band: [b.series.hgb_p10[i], b.series.hgb_p90[i]],
  })) : []
  return (
    <Section title="Backtest — generation forecast (time-ordered split, daylight steps only)"
      right={q.isFetching ? <Spinner label="training / scoring" /> : null}>
      {q.error ? <div className="p-3"><ErrorBox error={q.error} /></div> : null}
      {b && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_460px]">
          <div className="border-r border-line">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-line text-[12px]">
              <span className="text-ink-3">Test day</span>
              <select aria-label="Backtest day" value={b.series.date} onChange={(e) => setDate(e.target.value)}>
                {b.series.available_dates.map((d) => <option key={d}>{d}</option>)}
              </select>
              <span className="text-ink-3">Horizon</span>
              <select aria-label="Horizon" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                {b.horizons_steps.map((h) => <option key={h} value={h}>{h} step{h > 1 ? 's' : ''} ({h * 15} min)</option>)}
              </select>
              <span className="ml-auto"><StatusBadge status={b.dataset.is_real ? 'INFO' : 'WARNING'} label={b.dataset.is_real ? `REAL DATA · ${b.dataset.name}` : `SYNTHETIC · ${b.dataset.name}`} /></span>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis dataKey="t" {...AX} interval={7} />
                <YAxis {...AX} width={44} domain={[0, 1.05]} label={{ value: 'pu of capacity', angle: -90, position: 'insideLeft', fill: 'var(--color-ink-3)', fontSize: 10 }} />
                <Tooltip {...TIP} formatter={f4} />
                <Legend {...LEG} />
                <Area dataKey="band" name="ML P10–P90" stroke="none" fill="var(--color-s-alt)" fillOpacity={0.2} isAnimationActive={false} />
                <Line dataKey="actual" name="Actual" stroke="var(--color-s-demand)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="p50" name="ML P50" stroke="var(--color-s-alt)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="day" name="Persistence (yesterday)" stroke="var(--color-s-battery)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="last" name="Persistence (last value)" stroke="var(--color-s-solar)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div>
            <table className="w-full text-[12px]" aria-label="Backtest metrics">
              <thead><tr className="text-[10px] uppercase tracking-wider text-ink-3 text-left">
                <th className="px-3 py-1.5 font-normal">Model (P50)</th><th className="font-normal text-right px-2">MAE</th><th className="font-normal text-right px-2">RMSE</th>
                <th className="font-normal text-right px-2">nMAE</th><th className="font-normal text-right pr-3 pl-2">P10–P90</th></tr></thead>
              <tbody>
                {Object.entries(b.metrics).map(([k, m]) => (
                  <tr key={k} className={`border-t border-line/60 ${k === 'hgb' ? 'text-ink' : 'text-ink-2'}`}>
                    <td className="px-3 py-1.5">{MODEL_LABEL[k] ?? k}{k === b.best_baseline ? <span className="ml-1 text-[10px] text-ink-3">best baseline</span> : null}</td>
                    <td className="num text-right px-2">{fmt(m.mae, 4)}</td><td className="num text-right px-2">{fmt(m.rmse, 4)}</td>
                    <td className="num text-right px-2">{pct(m.nmae_pct)}</td><td className="num text-right pr-3 pl-2">{m.p10_p90_coverage_pct !== undefined ? pct(m.p10_p90_coverage_pct) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 border-t border-line text-[12px]">
              <StatusBadge status={b.ml_beats_best_baseline ? 'SAFE' : 'WARNING'} label={b.ml_beats_best_baseline ? 'ML BEATS BASELINE' : 'ML DOES NOT BEAT BASELINE'} />
              <p className="mt-1 text-ink-2">{b.verdict}</p>
              <p className="mt-1 text-ink-3 text-[11px]">Split: {b.split.method}, train until {b.split.train_until} · {b.split.test_daylight_samples} daylight test samples.</p>
              <ul className="mt-1 text-ink-3 text-[11px] list-disc pl-4">{b.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              <p className="mt-1 text-ink-3 text-[11px]">Demand is not ML-forecast: consumer profiles are deterministic synthetic schedules; predictive mode injects a configurable demand error instead.</p>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

function PredictiveResult({ r }: { r: Predictive }) {
  const data = [
    ...r.history.labels.map((t, i) => ({ t, observed: r.history.pu[i] })),
    ...r.horizon_labels.map((t, i) => ({ t, actual: r.actual_pu[i], p50: r.forecast.p50[i], band: [r.forecast.p10[i], r.forecast.p90[i]] })),
  ]
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-line">
        <StatusBadge status={r.outcome} />
        <span className="text-[12px] text-ink-2">Forecast issued at <span className="num text-ink">{r.t0}</span> for {r.horizon_labels[0]}–{r.horizon_labels[r.horizon_labels.length - 1]} · model {MODEL_LABEL[r.model] ?? r.model} · plan on {r.plan_on.toUpperCase()}</span>
      </div>
      {r.why && <p className="px-3 py-2 border-b border-line text-[13px]">{r.why}</p>}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="border-r border-line">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="t" {...AX} />
              <YAxis {...AX} width={44} domain={[0, 1.05]} />
              <Tooltip {...TIP} formatter={f4} />
              <Legend {...LEG} />
              <ReferenceLine x={r.t0} stroke="var(--color-accent)" label={{ value: 't0', fill: 'var(--color-ink-3)', fontSize: 10, position: 'insideTopLeft' }} />
              <Area dataKey="band" name="Forecast P10–P90" stroke="none" fill="var(--color-s-alt)" fillOpacity={0.2} isAnimationActive={false} />
              <Line dataKey="observed" name="Observed before t0" stroke="var(--color-ink-3)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="actual" name="Actual (revealed after)" stroke="var(--color-s-demand)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="p50" name="Forecast P50" stroke="var(--color-s-alt)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 border-t border-line text-[12px]">
            {(['p50', 'p90'] as const).map((q) => (
              <div key={q} className="px-3 py-2 border-r border-line last:border-r-0">
                <div className="text-[10px] uppercase tracking-wider text-ink-3">Twin on forecast {q.toUpperCase()}</div>
                <StatusBadge status={r.predicted[q].status} />
                <div className="text-ink-3 mt-1 num text-[11px]">{r.predicted[q].violating_steps.length ? `predicted violations: ${r.predicted[q].violating_steps.join(', ')}` : 'no violations predicted'}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="px-3 py-2 border-b border-line text-[12px]">
            <div className="text-[10px] uppercase tracking-wider text-ink-3">Pre-emptive plan (frozen)</div>
            <div className="mt-1"><span className="text-ink">{r.plan.candidate === 'none' ? 'No action' : r.plan.candidate.replace(/_/g, ' ')}</span> <span className="text-ink-3">— planning status {r.plan.planning_status.replace(/_/g, ' ')}</span></div>
            <p className="text-ink-3 text-[11px] mt-1">{r.plan.explanation}</p>
          </div>
          <table className="w-full text-[12px]" aria-label="Replay on actuals">
            <thead><tr className="text-[10px] uppercase tracking-wider text-ink-3 text-left">
              <th className="px-3 py-1 font-normal">Step</th><th className="font-normal">Replay on actuals</th><th className="font-normal text-right">Batt. MW</th>
              <th className="font-normal text-right">Curtail</th><th className="font-normal text-right">Max V</th><th className="font-normal text-right pr-3">Max line</th></tr></thead>
            <tbody>
              {r.replay.steps.map((s) => (
                <tr key={s.label} className="border-t border-line/60">
                  <td className="px-3 py-1 num">{s.label}</td><td><StatusBadge status={s.status} /></td>
                  <td className="num text-right">{fmt(s.battery_p_mw, 2)}</td><td className="num text-right">{pct(s.curtail_pct)}</td>
                  <td className="num text-right">{fmt(s.max_v, 3)}</td><td className="num text-right pr-3">{pct(s.max_line)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-ink-3 border-t border-line">{r.demand_forecast} · {r.model_training} · {r.honesty.forecast}{r.honesty.cloud_event ? ` · ${r.honesty.cloud_event}` : ''}</p>
        </div>
      </div>
    </div>
  )
}

function PredictivePanel() {
  const { config } = useScenario()
  const lib = useQuery({ queryKey: ['library'], queryFn: api.library })
  const predictiveScenarios = (lib.data ?? []).filter((s) => s.mode === 'predictive')
  const [source, setSource] = useState('S7')
  const [t0, setT0] = useState('')
  const [model, setModel] = useState('')
  const [planOn, setPlanOn] = useState('')
  const [demErr, setDemErr] = useState(0)
  const m = useMutation({ mutationFn: api.predictive })
  const run = () => m.mutate({
    ...(source === 'current' ? { config } : { scenario_id: source }),
    ...(t0 ? { t0 } : {}), ...(model ? { model } : {}), ...(planOn ? { plan_on: planOn } : {}), demand_error_pct: demErr,
  })
  const times = Array.from({ length: 41 }, (_, i) => { const mm = 7 * 60 + i * 15; return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}` })
  const sel = predictiveScenarios.find((s) => s.id === source)
  return (
    <Section title="Predictive operation — forecast → twin → plan → replay on actuals">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-line text-[12px]">
        <select aria-label="Predictive scenario" value={source} onChange={(e) => setSource(e.target.value)}>
          {predictiveScenarios.map((s) => <option key={s.id} value={s.id}>{s.id} — {s.title}</option>)}
          {config && <option value="current">Current scenario ({config.name})</option>}
        </select>
        <span className="text-ink-3">t0</span>
        <select aria-label="Issue time" value={t0} onChange={(e) => setT0(e.target.value)}>
          <option value="">{sel?.predictive?.t0 ?? '12:00'} (default)</option>{times.map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="text-ink-3">model</span>
        <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">{sel?.predictive?.model ?? 'hgb'} (default)</option>
          {Object.keys(MODEL_LABEL).map((k) => <option key={k} value={k}>{MODEL_LABEL[k]}</option>)}
        </select>
        <span className="text-ink-3">plan on</span>
        <select aria-label="Plan on" value={planOn} onChange={(e) => setPlanOn(e.target.value)}>
          <option value="">{sel?.predictive?.plan_on ?? 'p50'} (default)</option><option value="p50">P50</option><option value="p90">P90</option>
        </select>
        <span className="text-ink-3">demand error</span>
        <input type="number" aria-label="Demand error" className="w-16 num" min={-50} max={50} value={demErr} onChange={(e) => setDemErr(Number(e.target.value))} /><span className="text-ink-3">%</span>
        <button onClick={run} disabled={m.isPending} className="inline-flex items-center gap-2 px-3 h-7 bg-accent text-bg font-medium disabled:opacity-40"><Play size={13} /> RUN PREDICTIVE</button>
        {m.isPending && <Spinner label="forecasting, planning, replaying…" />}
      </div>
      {sel && source !== 'current' && <p className="px-3 py-2 text-[12px] text-ink-2 border-b border-line">{sel.description}</p>}
      {m.error ? <div className="p-3"><ErrorBox error={m.error} /></div> : null}
      {m.data && <PredictiveResult r={m.data} />}
    </Section>
  )
}

export default function ForecastPage() {
  return (
    <div>
      <Backtest />
      <PredictivePanel />
    </div>
  )
}
