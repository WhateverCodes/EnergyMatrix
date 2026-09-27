import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BatteryCharging, Gauge, Loader2, Pause, Play, Split, SunDim, Wand2, X } from 'lucide-react'
import { IsoBoard, type Building } from '../features/play/IsoBoard'
import { api } from '../services/api'
import { useScenario } from '../app/ScenarioContext'
import type { ApplyResult, Evaluation, LibraryScenario, QstsPayload, RunResult, ScenarioConfig } from '../types/api'
import { fmt } from '../utils/format'

/* PLAY view. Everything shown comes from the backend: the baseline QSTS run, the evaluation of every
   corrective action, and the re-simulated "after" state of the action the player picks. */

const SCENARIOS = [
  { id: 'S1', label: 'NORMAL DAY', hint: 'Moderate rooftop solar' },
  { id: 'S2', label: 'SOLAR SURGE', hint: 'Lots of sun, battery ready' },
  { id: 'S6', label: 'EXTREME SUN', hint: 'Huge solar, battery full' },
] as const

const ACTIONS = [
  { key: 'battery', title: 'USE BATTERY', desc: 'Soak up surplus solar in the 2 MW / 4 MWh battery', Icon: BatteryCharging },
  { key: 'switching', title: 'REROUTE POWER', desc: 'Flip feeder switches so the other feeder shares the load', Icon: Split },
  { key: 'reactive', title: 'INVERTER VOLTS', desc: 'Solar inverters absorb reactive power to pull voltage down', Icon: Gauge },
  { key: 'curtailment', title: 'TRIM SOLAR ≤20%', desc: 'Turn solar output down a little — never more than 20%', Icon: SunDim },
] as const

const KIND: Record<string, Building> = {
  residential_society: 'tower', neighborhood: 'tower', hospital: 'hospital', office: 'office',
  commercial_building: 'office', small_factory: 'factory', school: 'school', bungalow: 'house',
}
const SHORT: Record<string, string> = {
  battery: 'BATTERY', switching: 'REROUTE', reactive: 'INVERTER VOLTS', curtailment: 'TRIM SOLAR',
  battery_curtail: 'BATTERY + TRIM', reactive_curtail: 'INVERTERS + TRIM', switching_battery: 'REROUTE + BATTERY', all_levers: 'ALL LEVERS',
}
const HEALTH_COL = ['#FF5D5D', '#FF5D5D', '#FF5D5D', '#FFC857', '#6EE7A8', '#6EE7A8']
const HEALTH_LABEL = ['FAILED', 'CRITICAL', 'DANGER', 'WARNING', 'STRAINED', 'HEALTHY']

type Banner = { kind: 'ok' | 'bad' | 'na' | 'busy'; title: string; reason: string; detail?: string }
type LogLine = { t: string; tone: 'ok' | 'bad' | 'warn' | 'info'; text: string }

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`chunk overflow-hidden ${className}`}>
      <h2 className="pixel text-[11px] text-accent-ink px-3 pt-2 pb-1">{title}</h2>
      {children}
    </section>
  )
}

export function HealthBar({ health }: { health: number }) {
  return (
    <div aria-label={`Grid health ${health} of 5: ${HEALTH_LABEL[health]}`} role="meter" aria-valuemin={0} aria-valuemax={5} aria-valuenow={health}>
      <div className="flex gap-1.5 px-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-7 flex-1 chunk-sm" style={{ background: i <= health ? HEALTH_COL[health] : 'var(--color-slot)' }} />
        ))}
      </div>
      <div className="px-3 pt-2 pb-3 flex items-baseline justify-between">
        <span className={`text-2xl font-bold tracking-wide ${health >= 4 ? 'text-ok' : health === 3 ? 'text-warn' : 'text-crit'}`}>{HEALTH_LABEL[health]}</span>
        <span className="pixel text-[10px] text-ink-3">{health}/5</span>
      </div>
    </div>
  )
}

function Readout({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="px-3 py-1.5 border-t-2 border-ink0 flex items-baseline justify-between gap-2">
      <span className="pixel text-[10px] text-ink-3">{label}</span>
      <span className="text-right">
        <span className={`num text-[17px] font-semibold ${bad ? 'text-crit' : 'text-ink'}`}>{bad ? '▲ ' : ''}{value}</span>
        {sub && <span className="block text-[11px] text-ink-3 leading-3">{sub}</span>}
      </span>
    </div>
  )
}

export default function PlayPage() {
  const qc = useQueryClient()
  const { setConfig, setLibraryId } = useScenario()
  const lib = useQuery({ queryKey: ['library'], queryFn: api.library })
  const net = useQuery({ queryKey: ['network'], queryFn: api.network })
  const [sid, setSid] = useState<string>('S1')
  const sc: LibraryScenario | undefined = lib.data?.find((s) => s.id === sid)
  const cfg = sc?.config as ScenarioConfig | undefined
  const run = useQuery({ queryKey: ['play-run', sid], queryFn: () => api.run(cfg!), enabled: !!cfg, staleTime: Infinity })
  // evaluate every corrective action in the background as soon as the baseline is known
  const evalQ = useQuery({ queryKey: ['play-eval', sid], queryFn: () => api.evaluate(cfg!), enabled: !!cfg && !!run.data, staleTime: Infinity })

  const [k, setK] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [applied, setApplied] = useState<ApplyResult | null>(null)
  const [view, setView] = useState<'before' | 'after'>('before')
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<LogLine[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const push = (lines: LogLine[]) => setLog((l) => [...l, ...lines].slice(-80))

  // new scenario -> reset, share config with the engineer pages, write the opening log
  useEffect(() => {
    if (!cfg) return
    setLibraryId(sid)
    setConfig(cfg)
    setApplied(null); setView('before'); setBanner(null); setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, cfg])
  useEffect(() => {
    const r = run.data
    if (!r || !sc) return
    const worst = Math.max(0, r.steps.findIndex((s) => s.label === r.summary.worst_step))
    setK(r.summary.worst_step ? worst : Math.floor(r.steps.length / 2))
    const hard = r.summary.violations.filter((v) => v.hard)
    push([
      { t: r.steps[0].label, tone: 'info', text: `Scenario loaded: ${sc.title}. ${r.scenario.installed_pv_mw.toFixed(1)} MW rooftop solar installed.` },
      { t: r.steps[0].label, tone: hard.length ? 'bad' : 'ok', text: `Simulated ${r.steps.length} steps (15 min each): grid ${r.summary.health_label}.` },
      ...hard.slice(0, 4).map((v) => ({ t: v.steps?.[0] ?? '', tone: 'bad' as const,
        text: `${v.type.replace(/_/g, ' ')} at ${v.name}: ${fmt(v.value, v.type.includes('VOLTAGE') ? 3 : 1)} vs limit ${fmt(v.limit, v.type.includes('VOLTAGE') ? 2 : 0)} (${v.steps?.length ?? 0} steps)` })),
      ...(hard.length ? [{ t: '', tone: 'warn' as const, text: 'Pick an action on the right — each one is simulated over every step.' }] : []),
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.data])
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }) }, [log])

  const payload: (QstsPayload | RunResult) | undefined = view === 'after' && applied ? applied.after : run.data
  const steps = payload?.steps ?? []
  useEffect(() => {
    if (!playing || !steps.length) return
    const id = setInterval(() => setK((x) => (x + 1) % steps.length), 700)
    return () => clearInterval(id)
  }, [playing, steps.length])
  const step = steps[Math.min(k, steps.length - 1)] ?? null
  const c = cfg?.constraints

  const pvBuses = useMemo(() => [...new Set((net.data?.sgens ?? []).filter((g) => g.type === 'PV').map((g) => g.bus))], [net.data])

  async function act(key: string) {
    if (!cfg || busy) return
    setBusy(key)
    setBanner({ kind: 'busy', title: 'SIMULATING…', reason: 'Re-running AC power flow over every 15-minute step with this action applied.' })
    try {
      const ev: Evaluation = await qc.fetchQuery({ queryKey: ['play-eval', sid], queryFn: () => api.evaluate(cfg), staleTime: Infinity })
      const t = step?.label ?? ''
      if (ev.status === 'NO_ACTION_NEEDED') {
        setBanner({ kind: 'ok', title: 'ALREADY HEALTHY', reason: ev.explanation })
        push([{ t, tone: 'ok', text: 'No action needed — the grid is within every limit.' }])
        return
      }
      let key2 = key
      if (key === 'auto') key2 = ev.recommended ?? 'all_levers'
      const cand = ev.candidates.find((x) => x.key === key2)
      if (!cand || !cand.available) {
        setBanner({ kind: 'na', title: 'NOT AVAILABLE', reason: cand?.unavailable_reason ?? 'This action is not available in this scenario.' })
        push([{ t, tone: 'warn', text: `${cand?.name ?? key}: not available — ${cand?.unavailable_reason ?? ''}` }])
        return
      }
      const res = await api.apply(cfg, key2)
      setApplied(res); setView('after')
      const worst = res.before.summary.worst_step
      const wi = res.after.steps.findIndex((s) => s.label === worst)
      if (wi >= 0) setK(wi)
      if (res.verified) {
        setBanner({ kind: 'ok', title: 'GRID STABILIZED', reason: key === 'auto' ? ev.explanation : cand.explanation })
        push([{ t, tone: 'ok', text: `${cand.name}: every step now within limits (verified by re-simulation).` }])
      } else if (key === 'auto') {
        setBanner({ kind: 'bad', title: 'NO FEASIBLE SOLUTION', reason: ev.explanation })
        push([{ t, tone: 'bad', text: `No combination works under current limits. ${ev.infeasibility?.minimum_intervention.required_curtailment_pct !== undefined ? `Would need ${fmt(ev.infeasibility.minimum_intervention.required_curtailment_pct, 1)}% solar trimmed vs ${fmt(ev.infeasibility.minimum_intervention.cap_pct, 0)}% cap.` : ''}` }])
      } else {
        const f = cand.failure
        const bc = f?.binding_constraint
        const reason = [f?.why?.[0], bc ? `Still ${bc.type.replace(/_/g, ' ').toLowerCase()} at ${bc.name}: ${fmt(bc.value, bc.type.includes('VOLTAGE') ? 3 : 1)} vs ${fmt(bc.limit, bc.type.includes('VOLTAGE') ? 2 : 0)}.` : ''].filter(Boolean).join(' ')
        setBanner({
          kind: 'bad', title: 'NOT ENOUGH', reason,
          detail: ev.status === 'NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS' ? 'No action fixes this scenario — try AUTO-FIX to see the minimum intervention needed.' : `${cand.metrics?.n_violation_steps} of ${cand.metrics?.n_steps} steps still violate. Try another action or AUTO-FIX.`,
        })
        push([{ t, tone: 'bad', text: `${cand.name}: not enough — ${f?.why?.[0] ?? 'violations remain'}` }])
      }
    } catch (e) {
      setBanner({ kind: 'bad', title: 'ERROR', reason: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const candState = (key: string) => {
    const ev = evalQ.data
    if (!ev || ev.status === 'NO_ACTION_NEEDED') return null
    const cnd = ev.candidates.find((x) => x.key === key)
    if (!cnd) return null
    if (!cnd.available) return { txt: 'N/A', col: '#948CAB' }
    return cnd.feasible ? { txt: 'WORKS', col: '#6EE7A8' } : { txt: 'NOT ENOUGH', col: '#FF5D5D' }
  }

  const health = step?.health ?? payload?.summary.health ?? 5
  const bannerCol = banner?.kind === 'ok' ? '#6EE7A8' : banner?.kind === 'bad' ? '#FF5D5D' : banner?.kind === 'busy' ? '#FFC857' : '#948CAB'

  return (
    <div className="flex flex-col gap-3 p-3" style={{ height: 'calc(100vh - 62px)', minHeight: 760 }}>
      {/* scenario buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="pixel text-[11px] text-ink-3">SCENARIO</span>
        {SCENARIOS.map((s) => (
          <button key={s.id} onClick={() => setSid(s.id)} aria-pressed={sid === s.id}
            className={`btn px-4 h-11 text-[15px] ${sid === s.id ? 'bg-accent text-ink0' : 'bg-surface text-ink'}`}>
            {s.label}<span className={`block text-[10px] font-medium -mt-1 ${sid === s.id ? 'text-ink0/70' : 'text-ink-3'}`}>{s.hint}</span>
          </button>
        ))}
        {sc && <p className="text-[13px] text-ink-2 max-w-[62ch] leading-4 ml-2">{sc.description}</p>}
      </div>

      <div className="flex-1 grid grid-cols-[280px_minmax(0,1fr)_310px] gap-3 min-h-0">
        {/* LEFT: health + readouts + legend */}
        <div className="flex flex-col gap-3 min-h-0">
          <Panel title="GRID HEALTH">
            <HealthBar health={health} />
          </Panel>
          <Panel title={`RIGHT NOW · ${step?.label ?? '--:--'}`}>
            {step && c ? <>
              <Readout label="SUN POWER" value={`${fmt(step.pv_dispatched_mw, 2)} MW`} sub={step.curtail_pct > 0 ? `${fmt(step.curtail_pct, 1)}% trimmed` : 'all solar used'} />
              <Readout label="TOWN DEMAND" value={`${fmt(step.feeder_load_mw, 2)} MW`} sub="homes & shops on the feeders" />
              <Readout label="HIGHEST VOLTAGE" value={`${fmt(step.max_v, 3)} pu`} sub={`safe up to ${c.v_max}`} bad={(step.max_v ?? 0) > c.v_max} />
              <Readout label="LOWEST VOLTAGE" value={`${fmt(step.min_v, 3)} pu`} sub={`safe down to ${c.v_min}`} bad={(step.min_v ?? 1) < c.v_min} />
              <Readout label="BUSIEST WIRE" value={`${fmt(step.max_line, 0)}%`} sub={`of its limit (${c.line_loading_max}%)`} bad={(step.max_line ?? 0) > c.line_loading_max} />
              {cfg?.battery.enabled && <Readout label="BATTERY" value={`${fmt(step.soc_pct, 0)}%`} sub={step.battery_p_mw > 0.001 ? `charging ${fmt(step.battery_p_mw, 2)} MW` : step.battery_p_mw < -0.001 ? `discharging ${fmt(-step.battery_p_mw, 2)} MW` : 'idle'} />}
            </> : <div className="px-3 pb-3 text-ink-3 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> running power flow…</div>}
          </Panel>
          <Panel title="HOW TO READ THE MAP" className="text-[12px]">
            <ul className="px-3 pb-3 space-y-1.5 text-ink-2">
              <li className="grid grid-cols-3 gap-1">
                <span className="flex items-center gap-1.5"><span className="w-6 h-2.5 chunk-sm bg-ok" />OK</span>
                <span className="flex items-center gap-1.5"><span className="w-6 h-2.5 chunk-sm bg-warn" />busy</span>
                <span className="flex items-center gap-1.5"><span className="w-6 h-2.5 chunk-sm bg-crit" />overload</span>
              </li>
              <li>Moving dots = power flowing (faster = more MW).</li>
              <li>Ground ring = voltage at that spot. <span className="text-crit font-bold">!</span> = over the limit.</li>
              <li>Yellow squares = switches (hollow = open).</li>
            </ul>
          </Panel>
        </div>

        {/* CENTER: board + operator log */}
        <div className="flex flex-col gap-3 min-h-0">
        <div className="chunk relative flex flex-col flex-1 min-h-0 overflow-hidden" style={{ background: 'var(--color-board)' }}>
          <div className="flex items-center gap-2 px-3 pt-2">
            <span className="pixel text-[11px] text-accent-ink">FEEDER MAP · CIGRE MV (REPRESENTATIVE)</span>
            {applied && (
              <div className="ml-auto flex">
                {(['before', 'after'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                    className={`btn px-3 h-8 text-[12px] ${view === v ? 'bg-accent text-ink0' : 'bg-surface text-ink-2'} ${v === 'after' ? 'ml-2' : ''}`}>
                    {v === 'before' ? 'BEFORE' : `AFTER: ${SHORT[applied.candidate.key] ?? applied.candidate.key}`}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 relative">
            {net.data && c && cfg && run.data ? (
              <IsoBoard network={net.data} step={step} c={c} switchStates={payload?.switch_states}
                consumerBus={cfg.target_bus} consumerKind={KIND[cfg.consumer_profile] ?? 'tower'}
                batteryBus={cfg.battery.enabled ? cfg.battery.bus : null} pvBuses={pvBuses}
                pvShare={run.data.scenario.installed_pv_mw > 0 && step ? step.pv_avail_mw / run.data.scenario.installed_pv_mw : 0}
                selected={selected} onSelect={setSelected} />
            ) : (
              <div className="h-full flex items-center justify-center text-ink-2 gap-2"><Loader2 className="animate-spin" /> Building the city and running the power flow…</div>
            )}
            {banner && (
              <div role="status" className="pop absolute left-1/2 top-4 -translate-x-1/2 w-[min(92%,640px)] chunk p-0" style={{ borderColor: '#0F0E17' }}>
                <div className="flex items-center gap-3 px-4 py-3" style={{ background: bannerCol }}>
                  {banner.kind === 'busy' && <Loader2 className="animate-spin text-ink0" />}
                  <span className="text-[28px] leading-8 font-bold text-ink0 tracking-wide">{banner.title}</span>
                  {banner.kind !== 'busy' && <button aria-label="Close" onClick={() => setBanner(null)} className="ml-auto text-ink0"><X /></button>}
                </div>
                <p className="px-4 py-2.5 text-[13px] text-ink leading-5">{banner.reason}</p>
                {banner.detail && <p className="px-4 pb-3 text-[13px] text-ink-2">{banner.detail}</p>}
              </div>
            )}
            {selected !== null && step && net.data && (
              <div className="absolute left-3 bottom-3 chunk px-3 py-2 text-[13px] min-w-[220px]">
                <div className="pixel text-[10px] text-accent-ink">{net.data.buses[selected].name.toUpperCase()}</div>
                <div className="num">{fmt(step.bus_vm[selected], 4)} pu</div>
                <div className="text-ink-3 text-[12px]">{net.data.loads.filter((l) => l.bus === selected).map((l) => l.name).join(', ') || 'no load'}</div>
              </div>
            )}
          </div>
          {/* time scrubber */}
          <div className="flex items-center gap-3 px-3 py-2 border-t-3 border-ink0 bg-surface">
            <button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} className="btn bg-accent text-ink0 w-10 h-9 flex items-center justify-center">
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <span className="pixel text-[10px] text-ink-3">TIME</span>
            <input aria-label="Time of day" type="range" min={0} max={Math.max(0, steps.length - 1)} value={Math.min(k, Math.max(0, steps.length - 1))}
              onChange={(e) => { setPlaying(false); setK(Number(e.target.value)) }} className="flex-1" />
            <span className="num text-[22px] text-accent-ink w-20 text-right">{step?.label ?? '--:--'}</span>
          </div>
        </div>
          <Panel title="OPERATOR LOG" className="h-[168px] shrink-0 flex flex-col">
            <div ref={logRef} className="px-3 pb-3 overflow-y-auto flex-1 space-y-1 num text-[12px]" aria-live="polite">
              {log.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-ink-3 w-10 shrink-0">{l.t}</span>
                  <span className={l.tone === 'bad' ? 'text-crit' : l.tone === 'ok' ? 'text-ok' : l.tone === 'warn' ? 'text-warn' : 'text-ink-2'}>{l.text}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* RIGHT: actions */}
        <div className="flex flex-col gap-3 min-h-0">
          <Panel title="ACTIONS · EACH ONE IS SIMULATED">
            <div className="px-3 pb-3 space-y-2.5">
              {ACTIONS.map(({ key, title, desc, Icon }) => {
                const st = candState(key)
                return (
                  <button key={key} onClick={() => act(key)} disabled={!!busy || !run.data}
                    className="btn w-full text-left bg-surface-2 text-ink px-3 py-2 flex items-start gap-3">
                    <span className="chunk-sm bg-accent text-ink0 w-9 h-9 flex items-center justify-center shrink-0">
                      {busy === key ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[14px] leading-4">{title}</span>
                        {st && <span className="pixel text-[9px] px-1.5 py-0.5 chunk-sm text-ink0 whitespace-nowrap shrink-0" style={{ background: st.col }}>{st.txt}</span>}
                      </span>
                      <span className="block text-[12px] font-normal text-ink-3 leading-4 mt-0.5">{desc}</span>
                    </span>
                  </button>
                )
              })}
              <button onClick={() => act('auto')} disabled={!!busy || !run.data}
                className="btn w-full bg-accent text-ink0 h-12 text-[16px] flex items-center justify-center gap-2">
                {busy === 'auto' ? <Loader2 className="animate-spin" /> : <Wand2 size={18} />} AUTO-FIX (BEST COMBO)
              </button>
              {evalQ.isFetching && <p className="text-[11px] text-ink-3 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> pre-computing every option…</p>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
