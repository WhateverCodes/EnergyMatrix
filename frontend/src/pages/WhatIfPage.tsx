import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Play, Sparkles, X } from 'lucide-react'
import { useScenario } from '../app/ScenarioContext'
import { ErrorBox, Kpi, Section, Spinner, StatusBadge } from '../components/Status'
import { ViolationList } from './GridPage'
import { api } from '../services/api'
import type { WhatIfEdit } from '../types/api'
import { fmt, pct, pu } from '../utils/format'

const EXAMPLES = [
  'Increase solar by 150% and take the battery offline',
  'Demand drops 20% and PV up 120%',
  'A cloud passes at 12:30 for 45 minutes cutting 70% of PV',
  'Take line 3-8 out of service',
  'Move the consumer to bus 6 and make it a hospital',
  'Double the solar, battery full, cap curtailment at 30%',
]

const UNIT: Record<string, string> = {
  pv_pct: '% of base', demand_pct: '% of base', battery_soc_pct: '% SOC', curtailment_cap_pct: '% cap', v_max: 'pu',
  target_bus: 'bus', line_out: 'line index', consumer_scale: '×',
}

function numericValue(e: WhatIfEdit): number | null {
  return typeof e.value === 'number' ? e.value : null
}

export default function WhatIfPage() {
  const { config, setConfig, setLibraryId } = useScenario()
  const nav = useNavigate()
  const [text, setText] = useState(EXAMPLES[0])
  const [edits, setEdits] = useState<WhatIfEdit[] | null>(null)
  const [useLlm, setUseLlm] = useState(false)
  const [rephrase, setRephrase] = useState(false)
  const parseM = useMutation({ mutationFn: () => api.whatifParse(text, useLlm), onSuccess: (r) => setEdits(r.edits) })
  const runM = useMutation({ mutationFn: () => api.whatifRun(config!, edits ?? [], rephrase) })
  if (!config) return <div className="p-6 text-ink-2">No scenario. <button className="text-accent-ink underline" onClick={() => nav('/builder')}>Open the Scenario Builder</button>.</div>
  const p = parseM.data
  const r = runM.data
  const m = r?.baseline.metrics
  return (
    <div>
      <Section title={`What-If Lab — base scenario: ${config.name}`}>
        <div className="p-3 space-y-2">
          <textarea aria-label="What-if question" rows={2} className="w-full" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap gap-2 items-center">
            {EXAMPLES.map((x) => <button key={x} onClick={() => setText(x)} className="text-[11px] px-2 h-6 border border-line-strong text-ink-3 hover:text-ink">{x}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => parseM.mutate()} className="inline-flex items-center gap-2 px-3 h-8 border border-accent text-accent-ink"><Sparkles size={14} /> PARSE</button>
            <label className="text-[12px] text-ink-2 inline-flex items-center gap-1" title={p && !p.llm_available ? 'Set ANTHROPIC_API_KEY and install anthropic to enable' : ''}>
              <input type="checkbox" checked={useLlm} disabled={p ? !p.llm_available : false} onChange={(e) => setUseLlm(e.target.checked)} /> LLM parser{p && !p.llm_available ? ' (no API key — rule parser)' : ''}
            </label>
            {parseM.isPending && <Spinner label="parsing" />}
          </div>
          {parseM.error ? <ErrorBox error={parseM.error} /> : null}
        </div>
      </Section>
      {edits && (
        <Section title={`Parsed parameters (${p?.parser ?? 'rules'} parser) — edit before running`}>
          <div className="p-3 flex flex-wrap gap-2">
            {edits.length === 0 && <span className="text-ink-3 text-[12px]">No parameters recognised.</span>}
            {edits.map((e, i) => (
              <span key={i} className="inline-flex items-center gap-2 border border-line-strong bg-surface-2 px-2 h-7 text-[12px]" data-testid="chip">
                <span className="text-ink-2">{e.label}</span>
                {numericValue(e) !== null && (
                  <input aria-label={`${e.param} value`} type="number" className="w-20 num" value={numericValue(e)!}
                    onChange={(ev) => setEdits(edits.map((x, j) => j === i ? { ...x, value: Number(ev.target.value) } : x))} />
                )}
                {numericValue(e) !== null && <span className="text-ink-3 text-[11px]">{UNIT[e.param] ?? ''}</span>}
                <button aria-label={`remove ${e.label}`} onClick={() => setEdits(edits.filter((_, j) => j !== i))} className="text-ink-3 hover:text-crit"><X size={12} /></button>
              </span>
            ))}
          </div>
          {p?.unparsed.length ? <p className="px-3 pb-2 text-[12px] text-warn">Not understood (ignored): {p.unparsed.map((u) => `“${u}”`).join(', ')}</p> : null}
          {p?.notes.map((n) => <p key={n} className="px-3 pb-2 text-[11px] text-ink-3">{n}</p>)}
          <div className="flex items-center gap-3 px-3 pb-3">
            <button onClick={() => runM.mutate()} disabled={!edits.length || runM.isPending} className="btn inline-flex items-center gap-2 px-3 h-9 bg-accent text-ink0 disabled:opacity-40"><Play size={14} /> RUN TWIN</button>
            <label className="text-[12px] text-ink-2 inline-flex items-center gap-1"><input type="checkbox" checked={rephrase} onChange={(e) => setRephrase(e.target.checked)} /> LLM plain-language rephrase (numbers verified)</label>
            {runM.isPending && <Spinner label="simulating baseline and every corrective action…" />}
          </div>
          {runM.error ? <div className="px-3 pb-3"><ErrorBox error={runM.error} /></div> : null}
        </Section>
      )}
      {r && m && (
        <Section title="Result" right={<button onClick={() => { setLibraryId(null); setConfig(r.config); nav('/actions', { state: { autorun: true } }) }} className="text-[11px] text-accent-ink inline-flex items-center gap-1">Open in Heal & Verify <ArrowRight size={12} /></button>}>
          <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-line">
            <span className="text-[11px] text-ink-3 uppercase tracking-wider">Baseline</span><StatusBadge status={r.baseline.status} />
            <span className="text-[11px] text-ink-3 uppercase tracking-wider ml-4">Corrective actions</span><StatusBadge status={r.evaluation_status} />
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 border-b border-line">
            <Kpi label="Max V" value={pu(m.max_v)} /><Kpi label="Min V" value={pu(m.min_v)} /><Kpi label="Max line" value={pct(m.max_line_pct)} />
            <Kpi label="Trafo" value={pct(m.max_trafo_pct)} /><Kpi label="Viol. steps" value={`${m.n_violation_steps}/${m.n_steps}`} />
            <Kpi label="Recommended J" value={r.recommended ? fmt(r.recommended.J, 2) : '—'} sub={r.recommended?.name ?? 'none'} />
          </div>
          <p className="px-3 py-2 text-[13px] border-b border-line">{r.explanation.text} <span className="text-[10px] text-ink-3 uppercase ml-1">[{r.explanation.source === 'llm' ? 'LLM rephrase · numbers verified' : 'template'}]</span></p>
          <ViolationList violations={r.baseline.violations.filter((v) => v.hard)} />
        </Section>
      )}
    </div>
  )
}
