import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGridSession } from '../hooks/useGridSession'
import { PlanMap } from '../features/atlas/PlanMap'
import { currentTheme, setTheme, type Theme } from '../app/theme'
import type { NetworkSummary, StepRecord } from '../types/api'
import { fmt } from '../utils/format'

/* ATLAS — an editorial "field report" presentation of the same simulations as PLAY.
   Sentences are assembled from backend figures; nothing is computed here but wording. */

const SCENARIOS = [
  { id: 'S1', label: 'An ordinary day' },
  { id: 'S2', label: 'A solar surge' },
  { id: 'S6', label: 'Extreme sun' },
]
const REMEDIES = [
  { key: 'battery', name: 'Store it in the battery', note: 'charge the 2 MW, 4 MWh battery with the surplus' },
  { key: 'switching', name: 'Reroute the feeders', note: 'open and close switches so the second feeder takes a share' },
  { key: 'reactive', name: 'Ask the inverters for help', note: 'solar inverters absorb reactive power to pull voltage down' },
  { key: 'curtailment', name: 'Trim the solar', note: 'turn panels down, never by more than a fifth' },
  { key: 'auto', name: 'The best combination', note: 'every lever together, cheapest first, trimming solar last' },
]
const CONSUMER: Record<string, string> = {
  residential_society: 'Residential society', neighborhood: 'Neighbourhood', hospital: 'Hospital', office: 'Office block',
  commercial_building: 'Shopping centre', small_factory: 'Small factory', school: 'School', bungalow: 'Bungalow',
}
const SHORT: Record<string, string> = {
  battery: 'battery', switching: 'rerouted', reactive: 'inverters', curtailment: 'trimmed solar', battery_curtail: 'battery and trim',
  reactive_curtail: 'inverters and trim', switching_battery: 'reroute and battery', all_levers: 'every lever',
}
const TYPE_WORDS: Record<string, string> = {
  LINE_OVERLOAD: 'overloaded', TRAFO_OVERLOAD: 'overloaded', OVERVOLTAGE: 'voltage too high', UNDERVOLTAGE: 'voltage too low',
  NON_CONVERGENCE: 'no power-flow solution', ISLANDED_BUS: 'cut off', REVERSE_FLOW: 'reverse flow over limit',
}
/** Strip the machine prefix from backend explanations; the verdict is already shown in words. */
const plain = (t: string) => t.replace(/^NO FEASIBLE SOLUTION UNDER CURRENT CONSTRAINTS:\s*/, '')
const CONDITION = ['failed', 'critical', 'in danger', 'warning', 'strained', 'healthy']

function busiestLine(step: StepRecord, net: NetworkSummary) {
  let best = -1, idx = -1
  step.line_loading.forEach((v, i) => { if (v > best) { best = v; idx = i } })
  const l = net.lines[idx]
  return l ? { name: `line ${l.from_bus}–${l.to_bus}`, load: best } : null
}

function Situation({ step, net, vmax, lineMax }: { step: StepRecord; net: NetworkSummary; vmax: number; lineMax: number }) {
  const bl = busiestLine(step, net)
  const surplus = step.pv_dispatched_mw > step.feeder_load_mw
  const over = bl && bl.load > lineMax
  return (
    <p className="text-[18px] leading-8">
      At <span className="fig">{step.label}</span> the rooftop panels were producing <span className="fig">{fmt(step.pv_dispatched_mw, 2)} MW</span>
      {step.curtail_pct > 0 && <> (after trimming <span className="fig">{fmt(step.curtail_pct, 1)}%</span>)</>} while homes and shops on the feeders
      drew <span className="fig">{fmt(step.feeder_load_mw, 2)} MW</span>.{' '}
      {surplus ? 'The surplus flowed back towards the substation' : 'Power flowed out from the substation as usual'}
      {bl && <>, and the busiest cable, {bl.name}, carried <span className="fig" style={{ color: over ? 'var(--a-red)' : undefined }}>{fmt(bl.load, 0)}%</span> of its rating{over ? ' — more than it is built for' : ''}</>}.{' '}
      Voltages ranged from <span className="fig">{fmt(step.min_v, 3)}</span> to{' '}
      <span className="fig" style={{ color: (step.max_v ?? 0) > vmax ? 'var(--a-red)' : undefined }}>{fmt(step.max_v, 3)} pu</span>
      {(step.max_v ?? 0) > vmax ? `, above the ${vmax} pu limit.` : ', inside the permitted band.'}
    </p>
  )
}

function DayStrip({ steps, k, onPick, limit }: { steps: StepRecord[]; k: number; onPick: (i: number) => void; limit: number }) {
  const W = 760, H = 120, L = 40, R = 30, T = 12, B = 24
  const vals = steps.map((s) => s.max_line ?? 0)
  const top = Math.max(limit * 1.25, ...vals) * 1.05
  const x = (i: number) => L + (i / Math.max(1, steps.length - 1)) * (W - L - R)
  const y = (v: number) => T + (1 - v / top) * (H - T - B)
  const path = vals.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const cur = steps[k]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Busiest cable loading through the day; click to choose a time">
      <line x1={L} y1={y(limit)} x2={W - R} y2={y(limit)} stroke="var(--a-red)" strokeWidth={1} />
      <text x={W - R} y={y(limit) - 5} textAnchor="end" fontSize={11} fill="var(--a-red)" fontStyle="italic">rating {limit}%</text>
      <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--a-rule)" />
      {steps.map((s, i) => (i % 4 === 0 ? <text key={i} x={x(i)} y={H - 6} textAnchor={i === steps.length - 1 ? 'end' : 'middle'} fontSize={11} className="fig" fill="var(--a-ink-3)">{s.label}</text> : null))}
      <path d={path} fill="none" stroke="var(--a-ink)" strokeWidth={1.6} strokeLinejoin="round" />
      {cur && <>
        <line x1={x(k)} y1={T} x2={x(k)} y2={H - B} stroke="var(--a-ink-3)" strokeDasharray="2 3" />
        <circle cx={x(k)} cy={y(vals[k])} r={4.5} fill="var(--a-ink)" stroke="var(--a-paper)" strokeWidth={2} />
        <text x={x(k) + 8} y={y(vals[k]) - 8 < T + 10 ? y(vals[k]) + 18 : y(vals[k]) - 8} fontSize={12} className="fig" fill="var(--a-ink)">{fmt(vals[k], 0)}% at {cur.label}</text>
      </>}
      {steps.map((s, i) => (
        <rect key={`h${i}`} x={x(i) - (W - L - R) / steps.length / 2} y={T} width={(W - L - R) / steps.length} height={H - T - B} fill="transparent"
          className="cursor-pointer" onClick={() => onPick(i)}><title>{`${s.label}: busiest cable ${fmt(s.max_line, 0)}%`}</title></rect>
      ))}
    </svg>
  )
}

export default function AtlasPage() {
  const g = useGridSession()
  const { net, sid, setSid, sc, cfg, run, k, setK, applied, view, setView, banner, busy, act, payload, steps, step, c, pvBuses, verdict, health } = g
  const [theme, setT] = useState<Theme>(currentTheme())
  const flip = () => { const n: Theme = theme === 'dark' ? 'light' : 'dark'; setTheme(n); setT(n) }
  const date = cfg ? new Date(`${cfg.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''
  const verdictWord = (key: string) => {
    if (busy === key) return <span className="italic text-[var(--a-ink-3)]">simulating…</span>
    const ev = g.evalQ.data
    const v = key === 'auto'
      ? (!ev || ev.status === 'NO_ACTION_NEEDED' ? null : ev.status === 'FEASIBLE' ? 'works' : 'short')
      : verdict(key)
    if (!v) return <span className="text-[var(--a-ink-3)]">—</span>
    if (key === 'auto' && v === 'short') return <span className="smallcaps" style={{ color: 'var(--a-red)' }}>no remedy exists</span>
    return <span className="smallcaps" style={{ color: v === 'works' ? 'var(--a-green)' : v === 'short' ? 'var(--a-red)' : 'var(--a-ink-3)' }}>
      {v === 'works' ? 'works' : v === 'short' ? 'falls short' : 'not available'}</span>
  }
  const outcomeWord = banner?.kind === 'ok' ? (banner.title === 'ALREADY HEALTHY' ? 'Nothing to fix.' : 'Stabilised.')
    : banner?.title === 'NO FEASIBLE SOLUTION' ? 'No feasible remedy.' : banner?.kind === 'bad' ? 'Not enough.' : banner?.kind === 'na' ? 'Not available.' : banner?.kind === 'busy' ? 'Working it out…' : ''

  return (
    <div className="atlas">
      <div className="mx-auto max-w-[1360px] px-10 pt-6 pb-16">
        {/* masthead */}
        <div className="flex items-baseline justify-between text-[14px] text-[var(--a-ink-2)]">
          <span className="smallcaps">GridTwin · field report</span>
          <nav className="flex gap-5">
            <Link to="/">Play</Link><span className="text-[var(--a-ink)]">Atlas</span><Link to="/builder">Engineer view</Link>
            <button className="link" onClick={flip}>{theme === 'dark' ? 'Day print' : 'Night print'}</button>
          </nav>
        </div>
        <div className="border-t-2 border-b rule mt-3 py-4 flex items-end justify-between gap-8" style={{ borderTopColor: 'var(--a-ink)' }}>
          <div>
            <h1 className="display text-[52px] leading-[1.05]">{sc ? SCENARIOS.find((s) => s.id === sid)?.label : '…'} on the feeder</h1>
            <p className="italic text-[var(--a-ink-2)] mt-2 text-[17px]">
              {date}, {cfg?.start}–{cfg?.end}{run.data && <> · rooftop solar <span className="fig">{fmt(run.data.scenario.installed_pv_mw, 1)} MW</span></>} · the day's sunlight measured at a real plant in India, scaled to this feeder
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="smallcaps text-[13px] text-[var(--a-ink-3)]">Condition</div>
            <div className="display text-[30px]" style={{ color: health >= 4 ? 'var(--a-green)' : health === 3 ? 'var(--a-ochre)' : 'var(--a-red)' }}>{CONDITION[health]}</div>
            <div className="flex gap-1 justify-end mt-1" aria-label={`Condition ${health} of 5`}>
              {[1, 2, 3, 4, 5].map((i) => <span key={i} className="block w-5 h-[3px]" style={{ background: i <= health ? 'var(--a-ink)' : 'var(--a-rule)' }} />)}
            </div>
          </div>
        </div>
        <div className="flex gap-6 py-3 border-b rule text-[16px]">
          <span className="smallcaps text-[var(--a-ink-3)] pt-0.5">Read the day as</span>
          {SCENARIOS.map((s) => (
            <button key={s.id} onClick={() => setSid(s.id)} className="link" aria-pressed={sid === s.id}
              style={sid === s.id ? { textDecorationColor: 'var(--a-ink)', textDecorationThickness: 2, fontWeight: 600 } : { color: 'var(--a-ink-2)' }}>{s.label}</button>
          ))}
        </div>

        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-12 mt-6">
          {/* map column */}
          <div>
            <div className="flex items-baseline justify-between">
              <h2 className="display text-[22px]">The network at <span className="fig">{step?.label ?? '—'}</span></h2>
              {applied && (
                <div className="text-[15px] flex gap-3">
                  <span className="text-[var(--a-ink-3)] italic">showing</span>
                  <button className="link" onClick={() => setView('before')} style={view === 'before' ? { fontWeight: 600, textDecorationColor: 'var(--a-ink)' } : { color: 'var(--a-ink-2)' }}>before</button>
                  <button className="link" onClick={() => setView('after')} style={view === 'after' ? { fontWeight: 600, textDecorationColor: 'var(--a-ink)' } : { color: 'var(--a-ink-2)' }}>after: {SHORT[applied.candidate.key] ?? applied.candidate.key}</button>
                </div>
              )}
            </div>
            <div className="border-t rule mt-2 pt-2">
              {net.data && c && cfg && run.data ? (
                <PlanMap network={net.data} step={step} c={c} switchStates={payload?.switch_states} consumerBus={cfg.target_bus}
                  consumerLabel={CONSUMER[cfg.consumer_profile] ?? 'Consumer'} batteryBus={cfg.battery.enabled ? cfg.battery.bus : null} pvBuses={pvBuses} />
              ) : <p className="italic text-[var(--a-ink-3)] py-24 text-center">Drawing the feeder and running the power flow…</p>}
            </div>
            <div className="border-t rule mt-2 pt-3">
              <h3 className="smallcaps text-[14px] text-[var(--a-ink-2)]">Busiest cable through the day — click a moment to read it</h3>
              {steps.length > 0 && c && <DayStrip steps={steps} k={Math.min(k, steps.length - 1)} onPick={setK} limit={c.line_loading_max} />}
            </div>
          </div>

          {/* text column */}
          <div>
            <h2 className="display text-[22px]">The situation</h2>
            <div className="border-t rule mt-2 pt-3">
              {step && net.data && c ? <Situation step={step} net={net.data} vmax={c.v_max} lineMax={c.line_loading_max} /> : <p className="italic">…</p>}
            </div>

            <h2 className="display text-[22px] mt-8">Remedies considered</h2>
            <p className="italic text-[var(--a-ink-3)] text-[15px]">Each one is applied to a copy of the network and replayed through every quarter-hour of the day.</p>
            <ol className="mt-2 border-t rule">
              {REMEDIES.map((r, i) => (
                <li key={r.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] gap-x-3 py-3 border-b rule items-baseline">
                  <span className="fig text-[var(--a-ink-3)]">{i + 1}.</span>
                  <div>
                    <div className={r.key === 'auto' ? 'font-semibold' : ''}>{r.name}</div>
                    <div className="italic text-[15px] text-[var(--a-ink-2)] leading-5">{r.note}</div>
                  </div>
                  <div className="text-right text-[15px] whitespace-nowrap">
                    {verdictWord(r.key)}
                    <div><button className="link text-[15px]" disabled={!!busy || !run.data} onClick={() => act(r.key)}>try it →</button></div>
                  </div>
                </li>
              ))}
            </ol>

            {banner && (
              <div className="mt-6" role="status" aria-live="polite">
                <div className="display text-[40px] leading-tight" style={{ color: banner.kind === 'ok' ? 'var(--a-green)' : banner.kind === 'busy' || banner.kind === 'na' ? 'var(--a-ink-2)' : 'var(--a-red)' }}>{outcomeWord}</div>
                <p className="mt-2 text-[16px] leading-7">{plain(banner.reason)}</p>
                {banner.detail && <p className="mt-2 italic text-[var(--a-ink-2)] text-[15px]">{banner.detail}</p>}
              </div>
            )}

            <h2 className="display text-[22px] mt-8">Recorded breaches{view === 'after' && applied ? ', after the remedy' : ''}</h2>
            <ul className="mt-2 border-t rule text-[15px]">
              {(payload?.summary.violations ?? []).filter((v) => v.hard).slice(0, 6).map((v, i) => {
                const n = v.steps?.length ?? 0
                const span = n ? (n > 1 ? `${v.steps![0]}–${v.steps![n - 1]}` : v.steps![0]) : ''
                const val = v.type.includes('VOLTAGE') ? `${fmt(v.value, 3)} pu` : `${fmt(v.value, 0)}% of rating`
                return (
                  <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1.5 border-b" style={{ borderColor: 'var(--a-rule-2)' }}>
                    <span>{v.name.replace('-', '–')} <span className="italic text-[var(--a-ink-2)]">{TYPE_WORDS[v.type] ?? v.type.toLowerCase()}</span>, <span className="fig" style={{ color: 'var(--a-red)' }}>{val}</span></span>
                    <span className="fig text-[var(--a-ink-3)] text-right">{span} <span className="italic" style={{ fontFamily: 'inherit' }}>({n} × 15 min)</span></span>
                  </li>
                )
              })}
              {payload && payload.summary.violations.filter((v) => v.hard).length === 0 && (
                <li className="py-2 italic text-[var(--a-green)]">None — every cable and bus stayed within its limits all day.</li>
              )}
            </ul>
          </div>
        </div>

        {/* colophon */}
        <p className="mt-12 pt-3 border-t rule text-[13px] text-[var(--a-ink-3)] italic max-w-[110ch]">
          Sunlight: real generation measured at Kaggle plant 1 in India, scaled to the installed rooftop capacity. Households and businesses:
          synthetic demand profiles. Network: the CIGRE medium-voltage benchmark feeder — representative, not a real Indian feeder. Every figure
          on this page comes from an AC power-flow simulation.
        </p>
      </div>
    </div>
  )
}
