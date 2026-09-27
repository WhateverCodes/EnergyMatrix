import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Save, Search } from 'lucide-react'
import { useScenario } from '../app/ScenarioContext'
import { ErrorBox, Section, Spinner, StatusBadge } from '../components/Status'
import { CandidateTable } from '../features/actions/CandidateTable'
import { InfeasiblePanel } from '../features/actions/InfeasiblePanel'
import { BeforeAfter } from '../features/actions/BeforeAfter'
import { useDebounced } from '../hooks/useDebounced'
import { api } from '../services/api'
import type { Weights } from '../types/api'

const W: [keyof Weights, string, number][] = [
  ['w_curt', 'Curtailment (per MWh)', 50], ['w_batt', 'Battery throughput (per MWh)', 20], ['w_sw', 'Switch operation (each)', 20],
  ['w_loss', 'Losses (per MWh)', 20], ['w_q', 'Reactive (per MVArh)', 5],
]

export default function ActionsPage() {
  const { config, evaluation, setEvaluation, applied, setApplied, run } = useScenario()
  const nav = useNavigate()
  const network = useQuery({ queryKey: ['network'], queryFn: api.network })
  const [weights, setWeights] = useState<Weights | null>(null)
  const dw = useDebounced(weights, 350)
  const evalM = useMutation({ mutationFn: (w?: Weights) => api.evaluate(config!, w), onSuccess: (e) => { setEvaluation(e); if (!weights) setWeights(e.weights) } })
  const applyM = useMutation({ mutationFn: (key: string) => api.apply(config!, key), onSuccess: setApplied })
  const [name, setName] = useState('')
  const saveM = useMutation({ mutationFn: () => api.save(name || config!.name, config!, applied?.candidate.key ?? evaluation?.recommended) })
  const location = useLocation()
  const autorun = (location.state as { autorun?: boolean } | null)?.autorun
  useEffect(() => {
    if (autorun && config && !evaluation && !evalM.isPending) evalM.mutate(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun, config])
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const same = dw && evaluation && (Object.keys(dw) as (keyof Weights)[]).every((k) => dw[k] === evaluation.weights[k])
    if (dw && evaluation && !same) evalM.mutate(dw)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dw])

  if (!config) return <div className="p-6 text-ink-2">No scenario. <button className="text-accent-ink underline" onClick={() => nav('/builder')}>Open the Scenario Builder</button>.</div>
  const pvBuses = [...new Set((network.data?.sgens ?? []).filter((g) => g.type === 'PV').map((g) => g.bus))]

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-line bg-surface">
        <button onClick={() => evalM.mutate(weights ?? undefined)} disabled={evalM.isPending}
          className="btn inline-flex items-center gap-2 px-3 h-9 bg-accent text-ink0 disabled:opacity-40">
          <Search size={14} /> FIND CORRECTIVE ACTIONS
        </button>
        {evalM.isPending && <Spinner label="simulating every candidate over every step…" />}
        <span className="text-[12px] text-ink-3">{config.name} · {config.date} {config.start}–{config.end}</span>
        {evaluation && <span className="ml-auto"><StatusBadge status={evaluation.status} /></span>}
      </div>
      {evalM.error ? <div className="p-3"><ErrorBox error={evalM.error} /></div> : null}
      {!evaluation && !evalM.isPending && (
        <p className="px-3 py-6 text-ink-2 max-w-3xl">
          Every candidate — battery, feeder reconfiguration, reactive support, limited curtailment and their combinations — is applied to its own copy of the network and re-simulated over every timestep of the window. Feasible means every step passed every limit.
          {run && run.status === 'SAFE' ? ' The baseline run was already safe.' : ''}
        </p>
      )}
      {evaluation && (
        <>
          {evaluation.status === 'NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS'
            ? <div className="p-3 border-b border-line"><InfeasiblePanel evaluation={evaluation} /></div>
            : <div className="px-3 py-2 border-b border-line text-[13px] leading-5">{evaluation.explanation}</div>}
          <div>
            <Section title={`Candidates (${evaluation.candidates.length}) — ranked: feasible first, then lowest J`}>
              <CandidateTable candidates={evaluation.candidates} onApply={(k) => applyM.mutate(k)} applying={applyM.isPending ? applyM.variables : null} />
              <div className="px-3 py-2 text-[11px] text-ink-3">J = w_curt·E_curtailed + w_batt·E_battery + w_sw·N_switch + w_loss·E_losses + w_q·E_reactive, among feasible candidates only. Hover a row for its explanation.</div>
            </Section>
            <Section title="Penalty weights (re-rank feasible candidates)">
              <div className="grid grid-cols-2 md:grid-cols-5">
              {weights && W.map(([k, label, max]) => (
                <label key={k} className="grid grid-cols-[1fr_auto] gap-1 px-3 py-1.5 border-r border-line/60 last:border-r-0">
                  <span className="text-[12px] text-ink-2">{label}</span><span className="num">{weights[k]}</span>
                  <input aria-label={label} type="range" min={0} max={max} step={k === 'w_q' ? 0.1 : 0.5} value={weights[k]} className="col-span-2"
                    onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
                </label>
              ))}
              </div>
              <p className="px-3 py-2 text-[11px] text-ink-3 border-t border-line/60">Changing weights re-ranks the stored simulation results on the backend; feasibility never changes.</p>
            </Section>
          </div>
        </>
      )}
      {applyM.error ? <div className="p-3"><ErrorBox error={applyM.error} /></div> : null}
      {applied && network.data && (
        <Section title="Before / after — re-simulated">
          <BeforeAfter result={applied} network={network.data} c={config.constraints} pvBuses={pvBuses} battery={config.battery.enabled ? { bus: config.battery.bus } : null} />
        </Section>
      )}
      {evaluation && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 border-t border-line">
          <input type="text" aria-label="Scenario name" placeholder={config.name} value={name} onChange={(e) => setName(e.target.value)} className="w-64" />
          <button onClick={() => saveM.mutate()} disabled={saveM.isPending} className="inline-flex items-center gap-2 btn px-3 h-9 bg-surface-2 text-ink">
            <Save size={14} /> SAVE SCENARIO
          </button>
          {saveM.data && <span className="text-ok text-[12px]">Saved #{saveM.data.id} · {saveM.data.feasibility.replace(/_/g, ' ')}</span>}
          {saveM.error ? <ErrorBox error={saveM.error} /> : null}
        </div>
      )}
    </div>
  )
}
