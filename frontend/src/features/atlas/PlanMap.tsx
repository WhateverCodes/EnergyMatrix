import type { Constraints, NetworkSummary, StepRecord } from '../../types/api'

/* Plan-view map in a printed-cartography style. Geometry = real CIGRE bus coordinates, rotated so the
   substation sits on the left (x' = 16 - y, y' = x). Styling = backend results for the shown step. */

const U = 64 // px per geo unit
const PAD = { l: 70, r: 110, t: 56, b: 70 }

export interface PlanMapProps {
  network: NetworkSummary
  step: StepRecord | null
  c: Constraints
  switchStates?: Record<string, boolean>
  consumerBus: number
  consumerLabel: string
  batteryBus: number | null
  pvBuses: number[]
}

const px = (b: { x: number; y: number }) => ({ x: PAD.l + (16 - b.y) * U, y: PAD.t + (b.x - 1) * U })

function Sun({ x, y }: { x: number; y: number }) {
  return (
    <g stroke="var(--a-ochre)" strokeWidth={1.2} fill="none">
      <circle cx={x} cy={y} r={3.4} fill="var(--a-paper)" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4
        return <line key={i} x1={x + Math.cos(a) * 5.5} y1={y + Math.sin(a) * 5.5} x2={x + Math.cos(a) * 8} y2={y + Math.sin(a) * 8} />
      })}
    </g>
  )
}

export function PlanMap({ network, step, c, switchStates, consumerBus, consumerLabel, batteryBus, pvBuses }: PlanMapProps) {
  const bus = Object.fromEntries(network.buses.map((b) => [b.id, b]))
  const P = (id: number) => px(bus[id])
  const W = PAD.l + 13 * U + PAD.r, H = PAD.t + 9 * U + PAD.b
  const isOpen = (lineId: number) => network.switches.some((s) => s.et === 'l' && s.element === lineId &&
    !((switchStates && s.switchable && s.name in switchStates) ? switchStates[s.name] : s.closed))

  type Seg = { key: string; a: number; b: number; load?: number; p?: number; open: boolean; label: string; limit: number; trafo?: boolean }
  const segs: Seg[] = [
    ...network.trafos.map((t) => ({ key: `t${t.id}`, a: t.hv_bus, b: t.lv_bus, load: step?.trafo_loading[t.id], p: step?.trafo_p_hv[t.id], open: false,
      label: `Transformer ${t.lv_bus === 1 ? 'A' : 'B'}`, limit: c.trafo_loading_max, trafo: true })),
    ...network.lines.map((l) => ({ key: `l${l.id}`, a: l.from_bus, b: l.to_bus, load: step?.line_loading[l.id], p: step?.line_p_from[l.id], open: isOpen(l.id),
      label: `Line ${l.from_bus}–${l.to_bus}`, limit: c.line_loading_max })),
  ]
  const callouts = segs.filter((s) => !s.open && s.load !== undefined && s.load > s.limit).sort((u, v) => (v.load ?? 0) - (u.load ?? 0)).slice(0, 3)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label="Plan of the feeder: cables weighted by loading, red callouts mark overloads">
      {/* graticule */}
      <g stroke="var(--a-rule-2)" strokeWidth={1}>
        {Array.from({ length: 14 }, (_, i) => <line key={`v${i}`} x1={PAD.l + i * U} y1={PAD.t - 20} x2={PAD.l + i * U} y2={PAD.t + 9 * U + 20} />)}
        {Array.from({ length: 10 }, (_, i) => <line key={`h${i}`} x1={PAD.l - 20} y1={PAD.t + i * U} x2={PAD.l + 13 * U + 20} y2={PAD.t + i * U} />)}
      </g>

      {/* cables */}
      {segs.map((s) => {
        const A = P(s.a), B = P(s.b)
        const over = !s.open && s.load !== undefined && s.load > s.limit
        const busy = !s.open && s.load !== undefined && s.load > 0.8 * s.limit
        const col = s.open ? 'var(--a-ink-3)' : over ? 'var(--a-red)' : busy ? 'var(--a-ochre)' : 'var(--a-cable)'
        const w = s.open ? 1 : over ? 3.6 : busy ? 2.4 : 1.4
        const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
        const dir = s.open || s.p === undefined || Math.abs(s.p) < 0.02 ? 0 : s.p > 0 ? 1 : -1
        const ang = (Math.atan2(B.y - A.y, B.x - A.x) * 180) / Math.PI + (dir < 0 ? 180 : 0)
        return (
          <g key={s.key}>
            <title>{`${s.label}: ${s.open ? 'switched out' : `${s.load?.toFixed(0) ?? '—'}% of rating, ${s.p !== undefined ? Math.abs(s.p).toFixed(2) : '—'} MW`}`}</title>
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="transparent" strokeWidth={14} />
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={col} strokeWidth={w} strokeDasharray={s.open ? '4 5' : undefined} strokeLinecap="round" />
            {dir !== 0 && <path d="M -4 -3.5 L 3 0 L -4 3.5" fill="none" stroke={col} strokeWidth={1.3} transform={`translate(${mid.x},${mid.y}) rotate(${ang})`} />}
            {s.trafo && (
              <g fill="var(--a-paper)" stroke="var(--a-cable)" strokeWidth={1.2}>
                <circle cx={mid.x - 4} cy={mid.y} r={6} /><circle cx={mid.x + 4} cy={mid.y} r={6} fillOpacity={0} />
              </g>
            )}
          </g>
        )
      })}

      {/* switches */}
      {network.switches.filter((s) => s.switchable && s.et === 'l').map((s) => {
        const l = network.lines.find((x) => x.id === s.element)!
        const A = P(l.from_bus), B = P(l.to_bus)
        const t = s.bus === l.from_bus ? 0.25 : 0.75
        const q = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t }
        const closed = switchStates && s.name in switchStates ? switchStates[s.name] : s.closed
        return (
          <g key={`s${s.id}`}>
            <title>{`Switch ${s.name}: ${closed ? 'closed' : 'open'}`}</title>
            <rect x={q.x - 3.5} y={q.y - 3.5} width={7} height={7} fill={closed ? 'var(--a-cable)' : 'var(--a-paper)'} stroke="var(--a-cable)" strokeWidth={1.2} />
          </g>
        )
      })}

      {/* buses and lettering */}
      {network.buses.map((b) => {
        const p = P(b.id)
        const v = step?.bus_vm[b.id]
        const bad = step?.violations.some((x) => x.hard && x.element === 'bus' && x.id === b.id)
        const near = v != null && b.vn_kv < 100 && (v > c.v_max - 0.01 || v < c.v_min + 0.01)
        const name = b.id === 0 ? '110 kV grid' : b.id === 1 ? 'Substation A' : b.id === 12 ? 'Substation B' : `Bus ${b.id}`
        const below = b.x > 7.5
        return (
          <g key={b.id}>
            <title>{`${name}${v != null ? ` — ${v.toFixed(3)} pu` : ''}`}</title>
            {bad && <circle cx={p.x} cy={p.y} r={10} fill="none" stroke="var(--a-red)" strokeWidth={1.4} />}
            {!bad && near && <circle cx={p.x} cy={p.y} r={9} fill="none" stroke="var(--a-ochre)" strokeWidth={1.2} />}
            {b.id === 0 || b.id === 1 || b.id === 12
              ? <rect x={p.x - 5} y={p.y - 5} width={10} height={10} fill="var(--a-ink)" />
              : <circle cx={p.x} cy={p.y} r={4.2} fill="var(--a-ink)" />}
            {pvBuses.includes(b.id) && <Sun x={p.x - 13} y={p.y - 12} />}
            <text x={p.x + 9} y={below ? p.y + 20 : p.y - 10} fontSize={13} fontStyle="italic" fill="var(--a-ink)"
              style={{ fontFamily: '"Source Serif 4 Variable", Georgia, serif' }}>{name}</text>
            {b.id === consumerBus && (
              <text x={p.x + 9} y={below ? p.y + 50 : p.y + 31} fontSize={12} fontStyle="italic" fill="var(--a-ink-2)">{consumerLabel.toLowerCase()}</text>
            )}
            {v != null && b.vn_kv < 100 && (
              <text x={p.x + 9} y={below ? p.y + 35 : p.y + 16} fontSize={11} fill={bad ? 'var(--a-red)' : 'var(--a-ink-3)'} className="fig">{v.toFixed(3)} pu</text>
            )}
            {batteryBus === b.id && (
              <g transform={`translate(${p.x - 34},${p.y + 12})`}>
                <rect width={22} height={11} fill="var(--a-paper)" stroke="var(--a-cable)" strokeWidth={1.2} />
                <rect x={1.5} y={1.5} height={8} width={19 * Math.max(0, Math.min(1, (step?.soc_pct ?? 0) / 100))} fill="var(--a-green)" />
                <rect x={22} y={3.5} width={2} height={4} fill="var(--a-cable)" />
                <text x={11} y={24} textAnchor="middle" fontSize={11} fontStyle="italic" fill="var(--a-ink-2)">battery {step?.soc_pct != null ? `${step.soc_pct.toFixed(0)}%` : ''}</text>
              </g>
            )}
          </g>
        )
      })}

      {/* callouts: lettered beside each overloaded cable, with a paper halo for legibility */}
      {callouts.map((s) => {
        const A = P(s.a), B = P(s.b)
        const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
        const horiz = Math.abs(B.x - A.x) >= Math.abs(B.y - A.y)
        const tx = horiz ? mid.x : mid.x + 14, ty = horiz ? mid.y - 30 : mid.y
        const halo = { paintOrder: 'stroke' as const, stroke: 'var(--a-paper)', strokeWidth: 5, strokeLinejoin: 'round' as const }
        return (
          <g key={`c${s.key}`}>
            <line x1={mid.x} y1={mid.y} x2={horiz ? mid.x : mid.x + 10} y2={horiz ? mid.y - 25 : mid.y} stroke="var(--a-red)" strokeWidth={1} />
            <text x={tx} y={ty} textAnchor={horiz ? 'middle' : 'start'} fontSize={13} fontStyle="italic" fill="var(--a-red)" style={halo}>
              {s.label} <tspan className="fig" fontStyle="normal" fontSize={12}>{s.load!.toFixed(0)}%</tspan>
            </text>
          </g>
        )
      })}
      {/* title block */}
      <g transform={`translate(${PAD.l - 20},${H - 22})`}>
        <text fontSize={11} fill="var(--a-ink-3)" className="smallcaps" style={{ fontVariantCaps: 'all-small-caps', letterSpacing: '0.08em' }}>
          Plan of feeders A and B · CIGRE MV benchmark, representative · not to scale · substation at left, cable weight shows loading
        </text>
      </g>
    </svg>
  )
}
