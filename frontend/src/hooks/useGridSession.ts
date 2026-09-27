import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { useScenario } from '../app/ScenarioContext'
import type { ApplyResult, Evaluation, LibraryScenario, QstsPayload, RunResult, ScenarioConfig } from '../types/api'
import { fmt } from '../utils/format'

/* Shared state machine for the PLAY and ATLAS views: scenario -> baseline QSTS run -> background
   evaluation of every corrective action -> apply the chosen one (re-simulated) -> outcome + log.
   Both views only present what the backend returned. */

export type Banner = { kind: 'ok' | 'bad' | 'na' | 'busy'; title: string; reason: string; detail?: string }
export type LogLine = { t: string; tone: 'ok' | 'bad' | 'warn' | 'info'; text: string }

export function useGridSession() {
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
    const say = (v: (typeof hard)[number]) => {
      const n = v.steps?.length ?? 0
      const dur = `for ${n} × 15 min`
      if (v.type === 'LINE_OVERLOAD' || v.type === 'TRAFO_OVERLOAD') return `${v.name} is overloaded: ${fmt(v.value, 0)}% of its rating, ${dur}.`
      if (v.type === 'OVERVOLTAGE') return `Voltage too high at ${v.name}: ${fmt(v.value, 3)} pu (limit ${fmt(v.limit, 2)}), ${dur}.`
      if (v.type === 'UNDERVOLTAGE') return `Voltage too low at ${v.name}: ${fmt(v.value, 3)} pu (limit ${fmt(v.limit, 2)}), ${dur}.`
      return `${v.type.replace(/_/g, ' ').toLowerCase()} at ${v.name}, ${dur}.`
    }
    push([
      { t: r.steps[0].label, tone: 'info', text: `${sc.title}. ${r.scenario.installed_pv_mw.toFixed(1)} MW of rooftop solar installed.` },
      { t: r.steps[0].label, tone: hard.length ? 'bad' : 'ok', text: hard.length ? `Simulated the day in ${r.steps.length} quarter-hours: ${hard.length} limit ${hard.length === 1 ? 'breach' : 'breaches'} found.` : `Simulated the day in ${r.steps.length} quarter-hours: every limit respected.` },
      ...hard.slice(0, 4).map((v) => ({ t: v.steps?.[0] ?? '', tone: 'bad' as const, text: say(v) })),
      ...(hard.length ? [{ t: '', tone: 'warn' as const, text: 'Choose a corrective action on the right to try it.' }] : []),
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.data])

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
        push([{ t, tone: 'ok', text: 'Nothing to fix: the grid stays within every limit.' }])
        return
      }
      let key2 = key
      if (key === 'auto') key2 = ev.recommended ?? 'all_levers'
      const cand = ev.candidates.find((x) => x.key === key2)
      if (!cand || !cand.available) {
        setBanner({ kind: 'na', title: 'NOT AVAILABLE', reason: cand?.unavailable_reason ?? 'This action is not available in this scenario.' })
        push([{ t, tone: 'warn', text: `${cand?.name ?? key} is not available: ${cand?.unavailable_reason ?? ''}.` }])
        return
      }
      const res = await api.apply(cfg, key2)
      setApplied(res); setView('after')
      const worst = res.before.summary.worst_step
      const wi = res.after.steps.findIndex((s) => s.label === worst)
      if (wi >= 0) setK(wi)
      if (res.verified) {
        setBanner({ kind: 'ok', title: 'GRID STABILIZED', reason: key === 'auto' ? ev.explanation : cand.explanation })
        push([{ t, tone: 'ok', text: `${cand.name} works: every quarter-hour is now within limits (re-simulated).` }])
      } else if (key === 'auto') {
        setBanner({ kind: 'bad', title: 'NO FEASIBLE SOLUTION', reason: ev.explanation })
        push([{ t, tone: 'bad', text: `No combination works under the current limits. ${ev.infeasibility?.minimum_intervention.required_curtailment_pct !== undefined ? `It would take ${fmt(ev.infeasibility.minimum_intervention.required_curtailment_pct, 1)}% solar trimming against a ${fmt(ev.infeasibility.minimum_intervention.cap_pct, 0)}% cap.` : ''}` }])
      } else {
        const f = cand.failure
        const bc = f?.binding_constraint
        const reason = [f?.why?.[0], bc ? `Still ${bc.type.replace(/_/g, ' ').toLowerCase()} at ${bc.name}: ${fmt(bc.value, bc.type.includes('VOLTAGE') ? 3 : 1)} vs ${fmt(bc.limit, bc.type.includes('VOLTAGE') ? 2 : 0)}.` : ''].filter(Boolean).join(' ')
        setBanner({
          kind: 'bad', title: 'NOT ENOUGH', reason,
          detail: ev.status === 'NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS' ? 'No action fixes this scenario — try AUTO-FIX to see the minimum intervention needed.' : `${cand.metrics?.n_violation_steps} of ${cand.metrics?.n_steps} steps still violate. Try another action or AUTO-FIX.`,
        })
        push([{ t, tone: 'bad', text: `${cand.name} is not enough: ${f?.why?.[0] ?? 'some limits are still broken'}.` }])
      }
    } catch (e) {
      setBanner({ kind: 'bad', title: 'ERROR', reason: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  /** Pre-computed verdict for an action (null until the background evaluation arrives). */
  const verdict = (key: string): 'works' | 'short' | 'na' | null => {
    const ev = evalQ.data
    if (!ev || ev.status === 'NO_ACTION_NEEDED') return null
    const cnd = ev.candidates.find((x) => x.key === key)
    if (!cnd) return null
    if (!cnd.available) return 'na'
    return cnd.feasible ? 'works' : 'short'
  }

  const health = step?.health ?? payload?.summary.health ?? 5
  return { lib, net, sid, setSid, sc, cfg, run, evalQ, k, setK, playing, setPlaying, selected, setSelected, applied, view, setView,
    banner, setBanner, busy, log, act, payload, steps, step, c, pvBuses, verdict, health }
}

