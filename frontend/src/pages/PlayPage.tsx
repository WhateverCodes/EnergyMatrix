import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Pause, Play, X } from 'lucide-react'
import { IsoScene, type Building } from '../features/play/IsoScene'
import { CUSTOM, useGridSession } from '../hooks/useGridSession'
import { fmt } from '../utils/format'

/* PLAY view. Everything shown comes from the backend: the baseline QSTS run, the evaluation of every
   corrective action, and the re-simulated "after" state of the action the user picks. */

const SCENARIOS = [
  { id: 'S1', label: 'Normal day', blurb: 'A clear day with a moderate amount of rooftop solar. Nothing should go wrong.' },
  { id: 'S2', label: 'Solar surge', blurb: 'Much more rooftop solar. Around noon the feeder has to carry more power back than its cables are rated for. A battery is available.' },
  { id: 'S6', label: 'Extreme sun', blurb: 'Twice the solar again, the battery already full and solar trimming capped at 20%. Watch what the grid can and cannot fix.' },
] as const

const ACTIONS = [
  { key: 'battery', title: 'Use the battery', desc: 'Store surplus solar in the 2 MW / 4 MWh battery.' },
  { key: 'switching', title: 'Reroute power', desc: 'Open and close feeder switches so the other feeder shares the load.' },
  { key: 'reactive', title: 'Inverter voltage control', desc: 'Solar inverters absorb reactive power to pull voltage down.' },
  { key: 'curtailment', title: 'Trim solar (max 20%)', desc: 'Turn solar output down a little, never by more than a fifth.' },
] as const

const KIND: Record<string, Building> = {
  residential_society: 'tower', neighborhood: 'tower', hospital: 'hospital', office: 'office',
  commercial_building: 'office', small_factory: 'factory', school: 'school', bungalow: 'house',
}
const SHORT: Record<string, string> = {
  battery: 'battery', switching: 'rerouted', reactive: 'inverter control', curtailment: 'trimmed solar',
  battery_curtail: 'battery + trim', reactive_curtail: 'inverters + trim', switching_battery: 'reroute + battery', all_levers: 'all levers',
}
const PROFILE_NAME: Record<string, string> = {
  residential_society: 'residential society', neighborhood: 'neighbourhood', hospital: 'hospital', office: 'office',
  commercial_building: 'commercial building', small_factory: 'small factory', school: 'school', bungalow: 'bungalow',
}
const HEALTH_LABEL = ['Failed', 'Critical', 'Danger', 'Warning', 'Strained', 'Healthy']
const healthTone = (h: number) => (h >= 4 ? 'var(--color-ok)' : h === 3 ? 'var(--color-warn)' : 'var(--color-crit)')

function Card({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`chunk overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <h2 className="text-[13px] font-medium text-ink-2">{title}</h2>{right}
      </div>
      {children}
    </section>
  )
}

export function HealthBar({ health }: { health: number }) {
  return (
    <div aria-label={`Grid health ${health} of 5: ${HEALTH_LABEL[health]}`} role="meter" aria-valuemin={0} aria-valuemax={5} aria-valuenow={health} className="px-4 pb-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[24px] leading-7 font-semibold tracking-tight" style={{ color: healthTone(health) }}>{HEALTH_LABEL[health]}</span>
        <span className="num text-[12px] text-ink-3">{health}/5</span>
      </div>
      <div className="flex gap-1 mt-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i <= health ? healthTone(health) : 'var(--color-slot)' }} />
        ))}
      </div>
    </div>
  )
}

function Readout({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="px-4 py-2 border-t border-line flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-ink-2">{label}</span>
      <span className="text-right">
        <span className={`num text-[15px] font-medium ${bad ? 'text-crit' : 'text-ink'}`}>{value}</span>
        {sub && <span className={`block text-[12px] leading-4 ${bad ? 'text-crit' : 'text-ink-3'}`}>{sub}</span>}
      </span>
    </div>
  )
}

function Verdict({ v }: { v: 'works' | 'short' | 'na' | null }) {
  if (!v) return null
  const [txt, col] = v === 'works' ? ['Works', 'var(--color-ok)'] : v === 'short' ? ['Not enough', 'var(--color-crit)'] : ['Not available', 'var(--color-ink-3)']
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap" style={{ color: col }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: col }} />{txt}
    </span>
  )
}

export default function PlayPage() {
  const g = useGridSession()
  const { net, sid, setSid, cfg, run, evalQ, k, setK, playing, setPlaying, selected, setSelected, applied, view, setView,
    banner, setBanner, busy, log, act, payload, steps, step, c, pvBuses, verdict, health, isCustom, customConfig } = g
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }) }, [log])
  const scen = SCENARIOS.find((s) => s.id === sid)
  const tabs: { id: string; label: string }[] = [...SCENARIOS, ...(customConfig ? [{ id: CUSTOM, label: 'Your scenario' }] : [])]
  // plain restatement of the settings the user chose in the builder (no computed values)
  const customBlurb = customConfig ? (() => {
    const d = new Date(`${customConfig.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const b = customConfig.battery
    return `Built in the scenario builder: ${d}, ${customConfig.start}–${customConfig.end}, rooftop solar ${customConfig.pv_multiplier}×`
      + (run.data && isCustom ? ` (${fmt(run.data.scenario.installed_pv_mw, 1)} MW)` : '')
      + (customConfig.rooftop_cluster_mw > 0 ? ` plus a ${customConfig.rooftop_cluster_mw} MW solar cluster at bus ${customConfig.rooftop_cluster_bus}` : '')
      + `, ${PROFILE_NAME[customConfig.consumer_profile] ?? customConfig.consumer_profile} ×${customConfig.consumer_scale} at bus ${customConfig.target_bus}`
      + (customConfig.demand_scale !== 1 ? `, demand ${Math.round(customConfig.demand_scale * 100)}%` : '')
      + (b.enabled ? `, battery starting at ${b.soc_init_pct}%` : ', no battery')
      + (customConfig.constraints.max_curtailment_pct !== 20 ? `, solar trimming capped at ${customConfig.constraints.max_curtailment_pct}%` : '') + '.'
  })() : ''

  const outcome = banner ? {
    title: banner.kind === 'busy' ? 'Simulating…' : banner.title === 'GRID STABILIZED' ? 'Grid stabilized' : banner.title === 'ALREADY HEALTHY' ? 'Already healthy'
      : banner.title === 'NO FEASIBLE SOLUTION' ? 'No feasible solution' : banner.title === 'NOT ENOUGH' ? 'Not enough' : banner.title === 'NOT AVAILABLE' ? 'Not available' : banner.title,
    col: banner.kind === 'ok' ? 'var(--color-ok)' : banner.kind === 'bad' ? 'var(--color-crit)' : banner.kind === 'busy' ? 'var(--color-accent)' : 'var(--color-ink-3)',
    reason: banner.reason.replace(/^NO FEASIBLE SOLUTION UNDER CURRENT CONSTRAINTS:\s*/, 'Under the current limits: '),
  } : null

  return (
    <div className="flex flex-col gap-4 px-5 py-4" style={{ height: '100%', minHeight: 720 }}>
      {/* scenario selector */}
      <div className="flex flex-wrap items-center gap-5">
        <div className="inline-flex p-1 rounded-[10px] bg-surface border border-line" role="tablist" aria-label="Scenario">
          {tabs.map((s) => (
            <button key={s.id} role="tab" aria-selected={sid === s.id} aria-pressed={sid === s.id} onClick={() => setSid(s.id)}
              className={`px-4 h-9 rounded-md text-[14px] ${sid === s.id ? 'bg-accent text-on-accent font-medium' : 'text-ink-2 hover:text-ink'}`}>
              {s.label}
            </button>
          ))}
        </div>
        {isCustom
          ? <p className="text-[14px] text-ink-2 max-w-[90ch]">{customBlurb} <Link to="/builder" className="text-accent-ink underline underline-offset-2">Edit in the builder</Link></p>
          : scen && <p className="text-[14px] text-ink-2 max-w-[80ch]">{scen.blurb}</p>}
      </div>

      <div className="flex-1 grid grid-cols-[272px_minmax(0,1fr)_320px] gap-4 min-h-0">
        {/* LEFT */}
        <div className="flex flex-col gap-4 min-h-0">
          <Card title="Grid health"><HealthBar health={health} /></Card>
          <Card title="Right now" right={<span className="num text-[13px] text-ink-2">{step?.label ?? '--:--'}</span>}>
            {step && c ? <>
              <Readout label="Solar power" value={`${fmt(step.pv_dispatched_mw, 2)} MW`} sub={step.curtail_pct > 0 ? `${fmt(step.curtail_pct, 1)}% trimmed` : 'all solar used'} />
              <Readout label="Demand" value={`${fmt(step.feeder_load_mw, 2)} MW`} sub="homes and shops" />
              <Readout label="Highest voltage" value={`${fmt(step.max_v, 3)} pu`} sub={(step.max_v ?? 0) > c.v_max ? `above the ${c.v_max} limit` : `limit ${c.v_max}`} bad={(step.max_v ?? 0) > c.v_max} />
              <Readout label="Lowest voltage" value={`${fmt(step.min_v, 3)} pu`} sub={(step.min_v ?? 1) < c.v_min ? `below the ${c.v_min} limit` : `limit ${c.v_min}`} bad={(step.min_v ?? 1) < c.v_min} />
              <Readout label="Busiest cable" value={`${fmt(step.max_line, 0)}%`} sub={(step.max_line ?? 0) > c.line_loading_max ? 'over its rating' : 'of its rating'} bad={(step.max_line ?? 0) > c.line_loading_max} />
              {cfg?.battery.enabled && <Readout label="Battery" value={`${fmt(step.soc_pct, 0)}%`} sub={step.battery_p_mw > 0.001 ? `charging ${fmt(step.battery_p_mw, 2)} MW` : step.battery_p_mw < -0.001 ? `discharging ${fmt(-step.battery_p_mw, 2)} MW` : 'idle'} />}
            </> : <div className="px-4 pb-4 text-ink-3 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Running the power flow…</div>}
          </Card>
          <Card title="Reading the map" className="text-[13px]">
            <ul className="px-4 pb-3 space-y-1.5 text-ink-2 text-[12.5px] leading-[18px]">
              <li className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-1 rounded-full" style={{ background: 'var(--color-wire-ok)' }} />normal</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-1 rounded-full bg-warn" />busy</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 h-1 rounded-full bg-crit" />overloaded</span>
              </li>
              <li>Moving dots show which way power flows; faster means more.</li>
              <li>The tint under a building is its voltage; a red mark means it is outside the limit.</li>
              <li>Trees are decoration. The wind turbine is held at 0 MW in this study.</li>
            </ul>
          </Card>
        </div>

        {/* CENTER: scene + log */}
        <div className="flex flex-col gap-4 min-h-0">
          <section className="chunk relative flex flex-col flex-1 min-h-0 overflow-hidden" style={{ background: 'var(--color-board)' }}>
            <div className="flex items-center gap-3 px-4 pt-3">
              <span className="text-[13px] font-medium text-ink-2">Feeder map</span>
              <span className="text-[12px] text-ink-3">CIGRE MV benchmark, representative</span>
              {applied && (
                <div className="ml-auto inline-flex p-0.5 rounded-lg bg-surface border border-line">
                  {(['before', 'after'] as const).map((v) => (
                    <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                      className={`px-3 h-7 rounded-md text-[13px] ${view === v ? 'bg-accent text-on-accent font-medium' : 'text-ink-2'}`}>
                      {v === 'before' ? 'Before' : `After: ${SHORT[applied.candidate.key] ?? applied.candidate.key}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 relative">
              {net.data && c && cfg && run.data ? (
                <IsoScene network={net.data} step={step} c={c} switchStates={payload?.switch_states}
                  consumerBus={cfg.target_bus} consumerKind={KIND[cfg.consumer_profile] ?? 'tower'}
                  batteryBus={cfg.battery.enabled ? cfg.battery.bus : null} pvBuses={pvBuses}
                  pvShare={run.data.scenario.installed_pv_mw > 0 && step ? step.pv_avail_mw / run.data.scenario.installed_pv_mw : 0}
                  selected={selected} onSelect={setSelected} />
              ) : (
                <div className="h-full flex items-center justify-center text-ink-2 gap-2"><Loader2 className="animate-spin" size={18} /> Building the town and running the power flow…</div>
              )}
              {outcome && (
                <div role="status" className="pop absolute left-4 top-3 w-[min(92%,460px)] chunk" style={{ boxShadow: '0 12px 32px rgb(0 0 0 / 0.14)' }}>
                  <div className="flex items-start gap-3 px-4 py-3 border-l-4 rounded-l-[12px]" style={{ borderLeftColor: outcome.col }}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-[17px] font-semibold" style={{ color: outcome.col }}>
                        {banner?.kind === 'busy' && <Loader2 className="animate-spin" size={16} />}{outcome.title}
                      </div>
                      <p className="mt-1 text-[13px] text-ink-2 leading-5">{outcome.reason}</p>
                      {banner?.detail && <p className="mt-1.5 text-[12px] text-ink-3">{banner.detail}</p>}
                    </div>
                    {banner?.kind !== 'busy' && <button aria-label="Close" onClick={() => setBanner(null)} className="text-ink-3 hover:text-ink mt-0.5"><X size={16} /></button>}
                  </div>
                </div>
              )}
              {selected !== null && step && net.data && (
                <div className="absolute left-4 bottom-3 chunk px-4 py-2.5 text-[13px] min-w-[220px]">
                  <div className="font-medium">{net.data.buses[selected].name}</div>
                  <div className="num text-ink-2">{fmt(step.bus_vm[selected], 4)} pu</div>
                  <div className="text-ink-3 text-[12px]">{net.data.loads.filter((l) => l.bus === selected).map((l) => l.name).join(', ') || 'no load'}</div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 px-4 py-2.5 border-t border-line bg-surface">
              <button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} className="btn w-9 h-9 flex items-center justify-center bg-surface text-ink">
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <span className="text-[12px] text-ink-3">Time of day</span>
              <input aria-label="Time of day" type="range" min={0} max={Math.max(0, steps.length - 1)} value={Math.min(k, Math.max(0, steps.length - 1))}
                onChange={(e) => { setPlaying(false); setK(Number(e.target.value)) }} className="flex-1" />
              <span className="num text-[18px] text-ink w-14 text-right">{step?.label ?? '--:--'}</span>
            </div>
          </section>
          <Card title="Operator log" className="h-[150px] shrink-0 flex flex-col">
            <div ref={logRef} className="px-4 pb-3 overflow-y-auto flex-1 space-y-1 text-[13px]" aria-live="polite">
              {log.map((l, i) => (
                <div key={i} className="flex gap-3">
                  <span className="num text-ink-3 w-11 shrink-0">{l.t}</span>
                  <span className={l.tone === 'bad' ? 'text-crit' : l.tone === 'ok' ? 'text-ok' : 'text-ink-2'}>{l.text}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* RIGHT: actions */}
        <div className="flex flex-col gap-4 min-h-0">
          <Card title="Corrective actions" right={evalQ.isFetching ? <span className="text-[12px] text-ink-3 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> checking</span> : null}>
            <p className="px-4 -mt-1 pb-2 text-[12px] text-ink-3">Each one is re-simulated over every 15-minute step before it counts.</p>
            <div className="border-t border-line">
              {ACTIONS.map(({ key, title, desc }) => (
                <button key={key} onClick={() => act(key)} disabled={!!busy || !run.data}
                  className="w-full text-left px-4 py-3 border-b border-line hover:bg-surface-2 disabled:opacity-50 flex items-start gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[14px] font-medium text-ink">{title}</span>
                      {busy === key ? <Loader2 size={14} className="animate-spin text-ink-3" /> : <Verdict v={verdict(key)} />}
                    </span>
                    <span className="block text-[13px] text-ink-3 leading-5 mt-0.5">{desc}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="p-4">
              <button onClick={() => act('auto')} disabled={!!busy || !run.data}
                className="btn w-full bg-accent text-on-accent h-10 text-[14px] flex items-center justify-center gap-2 border-transparent">
                {busy === 'auto' && <Loader2 size={16} className="animate-spin" />} Auto-fix: find the best combination
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
