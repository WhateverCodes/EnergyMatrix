import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useScenario } from '../app/ScenarioContext'
import { ErrorBox, Section, Spinner, StatusBadge } from '../components/Status'
import { NetworkDiagram } from '../features/grid/NetworkDiagram'
import { api } from '../services/api'
import { fmt } from '../utils/format'

// Sequential single-hue ramp (validated reference blue, light -> dark) for hosting capacity.
const RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281']

function Datasets() {
  const qc = useQueryClient()
  const ds = useQuery({ queryKey: ['datasets'], queryFn: api.datasets })
  const [file, setFile] = useState<File | null>(null)
  const [f, setF] = useState({ timestamp_col: 'timestamp', value_col: 'power_kw', unit: 'kW', source_type: 'solar', name: 'My rooftop PV', location: 'Unknown' })
  const up = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append('file', file!); Object.entries(f).forEach(([k, v]) => fd.append(k, v)); return api.upload(fd) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['datasets'] }),
  })
  const rep = up.data?.report
  return (
    <Section title="Datasets">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {ds.data?.map((d) => (
          <div key={d.id} className="p-3 text-[12px] space-y-1 border-b border-r border-line">
            <div className="flex items-center gap-2"><span className="font-medium text-ink">{d.name}</span>
              <StatusBadge status={d.source === 'User upload' ? 'WARNING' : d.is_real ? 'INFO' : 'WARNING'}
                label={d.source === 'User upload' ? 'UPLOADED · UNVERIFIED' : d.is_real ? 'REAL' : 'SYNTHETIC'} /></div>
            <div className="text-ink-3">{d.description}</div>
            <div className="grid grid-cols-[90px_1fr] gap-x-2 text-ink-2">
              <span className="text-ink-3">Type</span><span>{d.source_type}</span>
              <span className="text-ink-3">Location</span><span>{d.location}</span>
              <span className="text-ink-3">Resolution</span><span>{d.resolution_min} min</span>
              <span className="text-ink-3">Coverage</span><span className="num">{d.coverage_start?.slice(0, 10)} → {d.coverage_end?.slice(0, 10)}</span>
              <span className="text-ink-3">Records</span><span className="num">{d.records}</span>
              <span className="text-ink-3">Capacity est.</span><span className="num">{d.capacity_kw ? `${fmt(d.capacity_kw, 0)} kW` : '—'}</span>
              <span className="text-ink-3">Variables</span><span>{d.variables.join(', ')}</span>
              <span className="text-ink-3">Source</span><span>{d.source}</span>
            </div>
            {d.notes?.length ? <ul className="text-[11px] text-ink-3 list-disc pl-4">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-line flex flex-wrap items-end gap-3 text-[12px]">
        <label className="flex flex-col gap-1"><span className="text-ink-3">CSV file</span><input aria-label="CSV file" type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        {(['timestamp_col', 'value_col', 'name', 'location'] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1"><span className="text-ink-3">{k.replace('_', ' ')}</span>
            <input type="text" aria-label={k} className="w-36" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
        ))}
        <label className="flex flex-col gap-1"><span className="text-ink-3">unit</span>
          <select aria-label="unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option>W</option><option>kW</option><option>MW</option></select></label>
        <label className="flex flex-col gap-1"><span className="text-ink-3">type</span>
          <select aria-label="source type" value={f.source_type} onChange={(e) => setF({ ...f, source_type: e.target.value })}><option>solar</option><option>load</option></select></label>
        <button disabled={!file || up.isPending} onClick={() => up.mutate()} className="inline-flex items-center gap-2 btn px-3 h-9 bg-surface-2 text-ink disabled:opacity-40"><Upload size={14} /> Upload & validate</button>
      </div>
      {up.error ? <div className="px-3 pb-3"><ErrorBox error={up.error} /></div> : null}
      {rep && (
        <div className="px-3 pb-3 text-[12px]">
          <StatusBadge status={rep.ok ? 'SAFE' : 'VIOLATION'} label={rep.ok ? `VALID · ${rep.dataset_id}` : 'REJECTED'} />
          <span className="ml-2 num text-ink-2">rows in {rep.rows_in} → out {rep.rows_out} · missing {rep.missing_values} · interpolated {rep.gaps_interpolated} · long-gap steps {rep.long_gap_steps}</span>
          <ul className="mt-1 text-crit">{rep.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          <ul className="mt-1 text-warn">{rep.warnings.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
    </Section>
  )
}

function Saved() {
  const hist = useQuery({ queryKey: ['history'], queryFn: api.history })
  const [sel, setSel] = useState<number[]>([])
  const cmp = useQuery({ queryKey: ['compare', sel], queryFn: () => api.compare(sel[0], sel[1]), enabled: sel.length === 2 })
  const toggle = (id: number) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id].slice(-2))
  return (
    <Section title="Saved scenarios — select two to compare" right={hist.isFetching ? <Spinner label="" /> : null}>
      <table className="w-full text-[12px]">
        <thead><tr className="text-[10px] uppercase tracking-wider text-ink-3 text-left">
          <th className="px-3 py-1 font-normal" /><th className="font-normal">#</th><th className="font-normal">Name</th><th className="font-normal">Outcome</th>
          <th className="font-normal">Intervention</th><th className="font-normal">Generation data</th><th className="font-normal pr-3">Saved</th></tr></thead>
        <tbody>
          {hist.data?.map((h) => (
            <tr key={h.id} className="border-t border-line/60">
              <td className="px-3 py-1"><input type="checkbox" aria-label={`compare ${h.name}`} checked={sel.includes(h.id)} onChange={() => toggle(h.id)} /></td>
              <td className="num text-ink-3">{h.id}</td><td>{h.name}</td><td><StatusBadge status={h.feasibility} /></td>
              <td>{h.selected_intervention?.replace(/_/g, ' ') ?? '—'}</td><td className="text-ink-3">{h.labels.generation}</td>
              <td className="num text-ink-3 pr-3">{h.created_at.replace('T', ' ')}</td>
            </tr>
          ))}
          {hist.data?.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-ink-3">Nothing saved yet — save from Heal & Verify.</td></tr>}
        </tbody>
      </table>
      {cmp.data && (
        <table className="w-full max-w-3xl text-[12px] border-t border-line" aria-label="Scenario comparison">
          <thead><tr className="text-[10px] uppercase tracking-wider text-ink-3 text-left">
            <th className="px-3 py-1 font-normal">Metric (final, else baseline)</th><th className="font-normal text-right">#{cmp.data.a.id} {cmp.data.a.name}</th><th className="font-normal text-right pr-3">#{cmp.data.b.id} {cmp.data.b.name}</th></tr></thead>
          <tbody>{cmp.data.rows.map((r) => (
            <tr key={r.metric} className="border-t border-line/60"><td className="px-3 py-1 text-ink-2">{r.metric.replace(/_/g, ' ')}</td>
              <td className="num text-right">{fmt(r.a, 3)}</td><td className="num text-right pr-3">{fmt(r.b, 3)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Section>
  )
}

function Hosting() {
  const { config } = useScenario()
  const net = useQuery({ queryKey: ['network'], queryFn: api.network })
  const hc = useQuery({ queryKey: ['hosting', config], queryFn: () => api.hosting(config!), enabled: !!config })
  if (!config) return null
  // Scale the ramp to the largest value below the search cap so capped buses don't flatten the rest.
  const vals = (hc.data?.buses ?? []).filter((b) => b.binding).map((b) => b.hosting_mw)
  const max = Math.max(1, ...vals)
  const overlay = Object.fromEntries((hc.data?.buses ?? []).map((b) => [b.bus, {
    fill: RAMP[Math.min(RAMP.length - 1, Math.floor((b.hosting_mw / max) * RAMP.length))], label: `+${fmt(b.hosting_mw, 1)} MW`,
  }]))
  return (
    <Section title={`PV hosting capacity — ${config.name}`} right={hc.isFetching ? <Spinner label="bisection per bus" /> : null}>
      {hc.error ? <div className="p-3"><ErrorBox error={hc.error} /></div> : null}
      {hc.data && net.data && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="border-r border-line">
            <NetworkDiagram network={net.data} step={null} busOverlay={overlay} height={400} title="Hosting capacity per bus" />
            <div className="flex items-center gap-2 px-3 pb-2 text-[11px] text-ink-3">
              <span>less</span>{RAMP.map((c) => <span key={c} className="inline-block w-5 h-2" style={{ background: c }} />)}<span>more added PV before first violation</span>
            </div>
          </div>
          <div>
            <p className="px-3 py-2 text-[12px] text-ink-2 border-b border-line">{hc.data.method}. Worst case: PV at {hc.data.worst_case.max_pv_step} ({fmt(hc.data.worst_case.existing_pv_mw, 2)} MW existing) with load at {hc.data.worst_case.min_load_step} ({fmt(hc.data.worst_case.load_mw, 2)} MW).</p>
            <table className="w-full text-[12px]" aria-label="Hosting capacity">
              <thead><tr className="text-[10px] uppercase tracking-wider text-ink-3 text-left"><th className="px-3 py-1 font-normal">Bus</th><th className="font-normal text-right">Added PV</th><th className="font-normal px-3">Binding constraint</th></tr></thead>
              <tbody>{hc.data.buses.map((b) => (
                <tr key={b.bus} className="border-t border-line/60"><td className="px-3 py-1">{b.name}</td><td className="num text-right">{fmt(b.hosting_mw, 2)} MW</td>
                  <td className="px-3 text-ink-2">{b.binding ? `${b.binding.replace(/_/g, ' ')} · ${b.binding_element}` : (b.note ?? '—')}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  )
}

export default function LibraryPage() {
  return <div><Datasets /><Saved /><Hosting /></div>
}
