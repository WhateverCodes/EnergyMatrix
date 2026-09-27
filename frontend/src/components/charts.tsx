import {
  Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { StepRecord } from '../types/api'

// Mark specs (dataviz): 2px lines, hairline recessive grid, legend for >= 2 series, text in ink tokens.
const AX = { stroke: 'var(--color-line-strong)', tick: { fill: 'var(--color-ink-3)', fontSize: 10, fontFamily: 'JetBrains Mono' } }
const GRID = <CartesianGrid stroke="var(--color-line)" strokeWidth={1} vertical={false} />
const TIP = {
  contentStyle: { background: 'var(--color-surface-2)', border: '1px solid var(--color-line-strong)', borderRadius: 2, fontSize: 11 },
  labelStyle: { color: 'var(--color-ink-2)' }, itemStyle: { color: 'var(--color-ink)', fontFamily: 'JetBrains Mono', padding: 0 },
  cursor: { stroke: 'var(--color-ink-3)', strokeWidth: 1 },
}
// Legend text stays in ink tokens; the swatch beside it carries the series colour.
const LEG = { wrapperStyle: { fontSize: 11 }, iconSize: 10, formatter: (v: string) => <span style={{ color: 'var(--color-ink-2)' }}>{v}</span> }
const numFmt = (nd: number) => (v: unknown) => (typeof v === 'number' ? v.toFixed(nd) : String(v))

export function GenDemandChart({ steps, height = 190, cursor }: { steps: StepRecord[]; height?: number; cursor?: string }) {
  const data = steps.map((s) => ({ t: s.label, avail: s.pv_avail_mw, disp: s.pv_dispatched_mw, load: s.feeder_load_mw }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        {GRID}
        <XAxis dataKey="t" {...AX} interval="preserveStartEnd" />
        <YAxis {...AX} width={44} unit="" label={{ value: 'MW', angle: -90, position: 'insideLeft', fill: 'var(--color-ink-3)', fontSize: 10 }} />
        <Tooltip {...TIP} formatter={numFmt(3)} />
        <Legend {...LEG} />
        <Area type="monotone" dataKey="avail" name="PV available" stroke="var(--color-s-solar)" fill="var(--color-s-solar)" fillOpacity={0.1} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="disp" name="PV dispatched" stroke="var(--color-s-alt)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="load" name="Feeder demand (excl. substation aggregate)" stroke="var(--color-s-demand)" strokeWidth={2} dot={false} isAnimationActive={false} />
        {cursor && <ReferenceLine x={cursor} stroke="var(--color-accent)" strokeWidth={1} />}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// Feeder 1 main path from the substation, then the lateral and feeder 2 — ordered by position along the feeder.
const PROFILE_ORDER = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 7, 12, 13, 14]

export function VoltageProfileChart({ step, vMin, vMax, compare, height = 190 }:
  { step: StepRecord | null; vMin: number; vMax: number; compare?: StepRecord | null; height?: number }) {
  const data = PROFILE_ORDER.map((b) => ({ bus: `B${b}`, v: step?.bus_vm[b] ?? null, c: compare?.bus_vm[b] ?? null }))
  const vals = data.flatMap((d) => [d.v, d.c]).filter((x): x is number => x !== null)
  const lo = Math.min(vMin - 0.01, ...vals), hi = Math.max(vMax + 0.01, ...vals)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        {GRID}
        <XAxis dataKey="bus" {...AX} />
        <YAxis {...AX} width={44} domain={[Math.floor(lo * 100) / 100, Math.ceil(hi * 100) / 100]} tickFormatter={(v) => v.toFixed(2)} />
        <Tooltip {...TIP} formatter={numFmt(4)} />
        {compare !== undefined && <Legend {...LEG} />}
        <ReferenceLine y={vMax} stroke="var(--color-crit)" strokeWidth={1} label={{ value: `V max ${vMax}`, fill: 'var(--color-ink-3)', fontSize: 10, position: 'insideTopRight' }} />
        <ReferenceLine y={vMin} stroke="var(--color-crit)" strokeWidth={1} label={{ value: `V min ${vMin}`, fill: 'var(--color-ink-3)', fontSize: 10, position: 'insideBottomRight' }} />
        {compare !== undefined && <Line dataKey="c" name="Before" stroke="var(--color-ink-3)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />}
        <Line dataKey="v" name={compare !== undefined ? 'After' : 'Voltage (pu)'} stroke="var(--color-s-demand)" strokeWidth={2} dot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function LoadingChart({ steps, lineMax, compare, height = 170, cursor }:
  { steps: StepRecord[]; lineMax: number; compare?: StepRecord[]; height?: number; cursor?: string }) {
  const data = steps.map((s, i) => ({ t: s.label, line: s.max_line, trafo: s.max_trafo, before: compare?.[i]?.max_line ?? null }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        {GRID}
        <XAxis dataKey="t" {...AX} interval="preserveStartEnd" />
        <YAxis {...AX} width={44} label={{ value: '%', angle: -90, position: 'insideLeft', fill: 'var(--color-ink-3)', fontSize: 10 }} />
        <Tooltip {...TIP} formatter={numFmt(1)} />
        <Legend {...LEG} />
        <ReferenceLine y={lineMax} stroke="var(--color-crit)" strokeWidth={1} label={{ value: 'limit', fill: 'var(--color-ink-3)', fontSize: 10, position: 'insideTopRight' }} />
        {compare && <Line dataKey="before" name="Max line % (before)" stroke="var(--color-ink-3)" strokeWidth={2} dot={false} isAnimationActive={false} />}
        <Line dataKey="line" name={compare ? 'Max line % (after)' : 'Max line loading %'} stroke="var(--color-s-demand)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="trafo" name="Max transformer %" stroke="var(--color-s-battery)" strokeWidth={2} dot={false} isAnimationActive={false} />
        {cursor && <ReferenceLine x={cursor} stroke="var(--color-accent)" strokeWidth={1} />}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function SocChart({ steps, height = 150, cursor }: { steps: StepRecord[]; height?: number; cursor?: string }) {
  const data = steps.map((s) => ({ t: s.label, soc: s.soc_pct, p: s.battery_p_mw }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        {GRID}
        <XAxis dataKey="t" {...AX} interval="preserveStartEnd" />
        <YAxis {...AX} width={44} domain={[0, 100]} label={{ value: 'SOC %', angle: -90, position: 'insideLeft', fill: 'var(--color-ink-3)', fontSize: 10 }} />
        <Tooltip {...TIP} formatter={numFmt(2)} />
        <Line dataKey="soc" name="Battery SOC %" stroke="var(--color-s-battery)" strokeWidth={2} dot={false} isAnimationActive={false} />
        {cursor && <ReferenceLine x={cursor} stroke="var(--color-accent)" strokeWidth={1} />}
      </LineChart>
    </ResponsiveContainer>
  )
}
