import type { ReactNode } from 'react'
import type { Constraints, NetworkSummary, StepRecord } from '../../types/api'

/* Isometric city board. Geometry = real CIGRE bus coordinates (net.bus.geo) projected isometrically.
   Colours = backend results for the current step (voltage per bus, loading per wire).
   Particles move in the sign of the backend's P flow; speed scales with |P| (visual only). */

const TW = 84 // tile width (px) per geo unit
const TH = 42
const INK = '#0F0E17'
const C = {
  sun: '#FFC857', ok: '#6EE7A8', bad: '#FF5D5D', tower: '#9D8CD6', roof: '#E8A87C', batt: '#7FD1E8',
  wall: '#F3E6CF', wallR: '#D9C7A8', panel: '#2E3A6B', ground: '#3B355A', ground2: '#36304F', warn: '#FFC857',
}

type P2 = { x: number; y: number }
const gx = (x: number) => x
const gy = (y: number) => 16 - y
export const iso = (x: number, y: number): P2 => ({ x: (gx(x) - gy(y)) * TW / 2, y: (gx(x) + gy(y)) * TH / 2 })
const pts = (a: P2[]) => a.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f)
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`
}

/** Isometric box centred on ground point p: w (along x), d (along y), h (height), px units. */
function Box({ p, w, d, h, color, top, children }: { p: P2; w: number; d: number; h: number; color: string; top?: string; children?: ReactNode }) {
  const hw = w / 2, hd = d / 2
  const A = { x: p.x - hw + hd, y: p.y - (hw + hd) / 2 }
  const B = { x: p.x + hw + hd, y: p.y + (hw - hd) / 2 }
  const Cc = { x: p.x + hw - hd, y: p.y + (hw + hd) / 2 }
  const D = { x: p.x - hw - hd, y: p.y + (hd - hw) / 2 }
  const up = (q: P2) => ({ x: q.x, y: q.y - h })
  return (
    <g strokeLinejoin="round">
      <polygon points={pts([D, Cc, up(Cc), up(D)])} fill={shade(color, 0.82)} stroke={INK} strokeWidth={2.5} />
      <polygon points={pts([Cc, B, up(B), up(Cc)])} fill={shade(color, 0.64)} stroke={INK} strokeWidth={2.5} />
      <polygon points={pts([up(A), up(B), up(Cc), up(D)])} fill={top ?? color} stroke={INK} strokeWidth={2.5} />
      {children}
    </g>
  )
}

function Roof({ p, w, h, color }: { p: P2; w: number; h: number; color: string }) {
  // hip roof (pyramid) sitting on a w x w box of height h
  const hw = w / 2
  const A = { x: p.x, y: p.y - hw - h }, B = { x: p.x + 2 * hw, y: p.y - h }
  const Cc = { x: p.x, y: p.y + hw - h }, D = { x: p.x - 2 * hw, y: p.y - h }
  const apex = { x: p.x, y: p.y - h - 16 }
  return (
    <g strokeLinejoin="round" stroke={INK} strokeWidth={2.5}>
      <polygon points={pts([A, B, apex])} fill={shade(color, 0.9)} />
      <polygon points={pts([D, A, apex])} fill={shade(color, 1.0)} />
      <polygon points={pts([D, Cc, apex])} fill={color} />
      <polygon points={pts([Cc, B, apex])} fill={shade(color, 0.72)} />
    </g>
  )
}

function SolarPanel({ p, lit }: { p: P2; lit: number }) {
  // tilted panel on a small frame next to the building; the lit bars show output share (0..1)
  const q = { x: p.x + 22, y: p.y + 4 }
  const poly = [{ x: q.x - 14, y: q.y - 6 }, { x: q.x + 2, y: q.y - 14 }, { x: q.x + 16, y: q.y - 7 }, { x: q.x, y: q.y + 1 }]
  return (
    <g>
      <line x1={q.x} y1={q.y + 1} x2={q.x} y2={q.y + 7} stroke={INK} strokeWidth={2.5} />
      <polygon points={pts(poly)} fill={C.panel} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={poly[0].x + (poly[1].x - poly[0].x) * t + 0} y1={poly[0].y + (poly[1].y - poly[0].y) * t}
          x2={poly[3].x + (poly[2].x - poly[3].x) * t} y2={poly[3].y + (poly[2].y - poly[3].y) * t}
          stroke={C.sun} strokeWidth={1.6} opacity={0.25 + 0.75 * lit} />
      ))}
    </g>
  )
}

function Pylon({ p }: { p: P2 }) {
  return (
    <g stroke={INK} strokeWidth={2.5} strokeLinejoin="round" fill="none">
      <polygon points={pts([{ x: p.x - 16, y: p.y + 4 }, { x: p.x, y: p.y - 70 }, { x: p.x + 16, y: p.y + 4 }])} fill="#8A86A3" fillOpacity={0.35} />
      <line x1={p.x - 24} y1={p.y - 48} x2={p.x + 24} y2={p.y - 48} />
      <line x1={p.x - 18} y1={p.y - 30} x2={p.x + 18} y2={p.y - 30} />
      <line x1={p.x - 10} y1={p.y - 14} x2={p.x + 10} y2={p.y - 30} />
      <line x1={p.x + 10} y1={p.y - 14} x2={p.x - 10} y2={p.y - 30} />
    </g>
  )
}

export type Building = 'grid' | 'substation' | 'house' | 'tower' | 'factory' | 'school' | 'hospital' | 'office'

export interface BoardProps {
  network: NetworkSummary
  step: StepRecord | null
  c: Constraints
  switchStates?: Record<string, boolean>
  consumerBus: number
  consumerKind: Building
  batteryBus: number | null
  pvBuses: number[]
  pvShare: number // current PV output / installed (from backend step), 0..1
  selected: number | null
  onSelect: (bus: number | null) => void
}

function busColor(v: number | null | undefined, c: Constraints) {
  if (v == null) return '#6B6585'
  if (v > c.v_max || v < c.v_min) return C.bad
  if (v > c.v_max - 0.01 || v < c.v_min + 0.01) return C.warn
  return C.ok
}
function wireColor(load: number | undefined, max: number) {
  if (load === undefined) return '#6B6585'
  if (load > max) return C.bad
  if (load > 0.8 * max) return C.warn
  return C.ok
}

export function IsoBoard({ network, step, c, switchStates, consumerBus, consumerKind, batteryBus, pvBuses, pvShare, selected, onSelect }: BoardProps) {
  const bus = Object.fromEntries(network.buses.map((b) => [b.id, b]))
  const P = (id: number) => iso(bus[id].x, bus[id].y)
  const open = (lineId: number) => network.switches.some((s) => s.et === 'l' && s.element === lineId &&
    !((switchStates && s.switchable && s.name in switchStates) ? switchStates[s.name] : s.closed))

  // ground tiles covering the feeder area
  const tiles: ReactNode[] = []
  for (let a = 0; a <= 11; a++) for (let b = -1; b <= 14; b++) {
    const q = { x: (a - b) * TW / 2, y: (a + b) * TH / 2 }
    tiles.push(<polygon key={`${a},${b}`} points={pts([{ x: q.x, y: q.y - TH / 2 }, { x: q.x + TW / 2, y: q.y }, { x: q.x, y: q.y + TH / 2 }, { x: q.x - TW / 2, y: q.y }])}
      fill={(a + b) % 2 ? C.ground : C.ground2} stroke="#2A2540" strokeWidth={1} />)
  }

  type Wire = { key: string; a: number; b: number; load?: number; p?: number; open: boolean; name: string; isTrafo?: boolean }
  const wires: Wire[] = [
    ...network.trafos.map((t) => ({ key: `t${t.id}`, a: t.hv_bus, b: t.lv_bus, load: step?.trafo_loading[t.id], p: step?.trafo_p_hv[t.id], open: false, name: t.name, isTrafo: true })),
    ...network.lines.map((l) => ({ key: `l${l.id}`, a: l.from_bus, b: l.to_bus, load: step?.line_loading[l.id], p: step?.line_p_from[l.id], open: open(l.id), name: l.name })),
  ]
  const lineMax = c.line_loading_max

  const buildings = network.buses.map((b) => {
    const kind: Building = b.id === 0 ? 'grid' : (b.id === 1 || b.id === 12) ? 'substation' : b.id === consumerBus ? consumerKind : 'house'
    return { b, kind, p: P(b.id), depth: iso(b.x, b.y).y }
  }).sort((u, v) => u.depth - v.depth)

  // label placement: nudge a label upward while it overlaps one already placed (simple collision avoidance)
  const labelTop: Record<number, number> = {}
  const placed: { x: number; y: number }[] = []
  const baseTop = (kind: Building) => kind === 'grid' ? 82 : kind === 'substation' ? 54 : kind === 'tower' || kind === 'office' ? 80 : kind === 'hospital' ? 68 : kind === 'factory' || kind === 'school' ? 58 : 52
  for (const { b, kind, p } of [...buildings].sort((u, v) => v.depth - u.depth)) {
    let y = p.y - baseTop(kind)
    for (let guard = 0; guard < 8 && placed.some((q) => Math.abs(q.x - p.x) < 66 && Math.abs(q.y - y) < 20); guard++) y -= 20
    placed.push({ x: p.x, y })
    labelTop[b.id] = p.y - y
  }

  const xs = network.buses.map((b) => P(b.id).x), ys = network.buses.map((b) => P(b.id).y)
  const minX = Math.min(...xs) - 70, maxX = Math.max(...xs) + 90, minY = Math.min(...ys) - 120, maxY = Math.max(...ys) + 50

  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="w-full h-full select-none" role="img"
      aria-label="Isometric map of the feeder: buildings at buses, wires coloured by loading, dots show power flow">
      <g onClick={() => onSelect(null)}>{tiles}</g>

      {/* wires: dark outline, loading colour, then marching particles in the flow direction */}
      {wires.map((w) => {
        const A = P(w.a), B = P(w.b)
        const col = w.open ? '#6B6585' : w.isTrafo ? wireColor(w.load, c.trafo_loading_max) : wireColor(w.load, lineMax)
        const dir = w.open || w.p === undefined || Math.abs(w.p) < 0.02 ? 0 : w.p > 0 ? 1 : -1
        const [s, e] = dir >= 0 ? [A, B] : [B, A]
        const dur = w.p ? Math.max(0.35, Math.min(5, 3 / Math.abs(w.p))) : 0
        const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
        const over = !w.open && w.load !== undefined && w.load > (w.isTrafo ? c.trafo_loading_max : lineMax)
        return (
          <g key={w.key}>
            <title>{`${w.name}: ${w.open ? 'open (switched out)' : `${w.load?.toFixed(0) ?? '—'}% loaded, ${w.p?.toFixed(2) ?? '—'} MW`}`}</title>
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={INK} strokeWidth={w.open ? 5 : 11} strokeLinecap="round" />
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={col} strokeWidth={w.open ? 2 : 6} strokeLinecap="round" strokeDasharray={w.open ? '6 6' : undefined} />
            {dir !== 0 && (
              <line className="flow" x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke="#FFF7DC" strokeWidth={3.5} strokeLinecap="round"
                strokeDasharray="2 30" style={{ animationDuration: `${dur}s` }} />
            )}
            {over && (
              <g transform={`translate(${mid.x},${mid.y - 14})`}>
                <rect x={-24} y={-11} width={48} height={20} rx={3} fill={C.bad} stroke={INK} strokeWidth={2.5} />
                <text textAnchor="middle" y={4} fontSize={11} className="num" fill={INK} fontWeight={700}>{w.load!.toFixed(0)}%</text>
              </g>
            )}
          </g>
        )
      })}

      {/* switches on lines */}
      {network.switches.filter((s) => s.switchable && s.et === 'l').map((s) => {
        const l = network.lines.find((x) => x.id === s.element)!
        const A = P(l.from_bus), B = P(l.to_bus)
        const t = s.bus === l.from_bus ? 0.25 : 0.75
        const q = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t }
        const closed = switchStates && s.name in switchStates ? switchStates[s.name] : s.closed
        return (
          <g key={`sw${s.id}`}>
            <title>{`Switch ${s.name}: ${closed ? 'closed' : 'open'}`}</title>
            <rect x={q.x - 6} y={q.y - 6} width={12} height={12} rx={2} fill={closed ? C.sun : '#2A2540'} stroke={INK} strokeWidth={2.5} />
          </g>
        )
      })}

      {/* buildings, painter's order */}
      {buildings.map(({ b, kind, p }) => {
        const v = step?.bus_vm[b.id]
        const bc = b.vn_kv > 100 ? '#B7B2CC' : busColor(v, c)
        const viol = step?.violations.some((x) => x.hard && x.element === 'bus' && x.id === b.id)
        const isSel = selected === b.id
        const pv = pvBuses.includes(b.id)
        let body: ReactNode
        let top = 40
        if (kind === 'grid') { body = <Pylon p={p} />; top = 76 }
        else if (kind === 'substation') {
          body = <Box p={p} w={34} d={26} h={20} color="#8C88A6" top="#A9A5C2">
            <rect x={p.x - 8} y={p.y - 42} width={16} height={16} rx={2} fill={C.sun} stroke={INK} strokeWidth={2.5} />
            <text x={p.x} y={p.y - 30} textAnchor="middle" fontSize={11} fill={INK} fontWeight={700}>⚡</text>
          </Box>; top = 52
        } else if (kind === 'tower' || kind === 'hospital' || kind === 'office') {
          const h = kind === 'hospital' ? 46 : 58
          body = <Box p={p} w={26} d={26} h={h} color={C.tower} top="#B9ACEB">
            {Array.from({ length: Math.floor(h / 14) }, (_, i) => (
              <line key={i} x1={p.x - 24} y1={p.y - 10 - i * 14 + 3} x2={p.x - 4} y2={p.y - 10 - i * 14 + 13} stroke={INK} strokeWidth={2} opacity={0.55} />
            ))}
            {kind === 'hospital' && <text x={p.x + 2} y={p.y - h - 8} textAnchor="middle" fontSize={14} fill={C.bad} fontWeight={700}>+</text>}
          </Box>; top = h + 22
        } else if (kind === 'factory' || kind === 'school') {
          body = <g><Box p={p} w={40} d={26} h={22} color={kind === 'factory' ? '#B8A08A' : C.roof} top={kind === 'factory' ? '#CDB59D' : '#F0C29F'} />
            {kind === 'factory' && <rect x={p.x + 8} y={p.y - 52} width={8} height={24} fill="#8C88A6" stroke={INK} strokeWidth={2.5} />}</g>; top = 56
        } else {
          body = <g><Box p={p} w={22} d={22} h={18} color={C.wall} /><Roof p={p} w={22} h={18} color={C.roof} /></g>; top = 50
        }
        return (
          <g key={`b${b.id}`} onClick={(e) => { e.stopPropagation(); onSelect(b.id) }} className="cursor-pointer">
            <title>{`${b.name}${v != null ? ` — ${v.toFixed(3)} pu` : ''}`}</title>
            <ellipse cx={p.x} cy={p.y + 3} rx={26} ry={12} fill={bc} stroke={INK} strokeWidth={2.5} />
            {isSel && <ellipse cx={p.x} cy={p.y + 3} rx={34} ry={17} fill="none" stroke={C.sun} strokeWidth={3} strokeDasharray="5 4" />}
            {body}
            {pv && kind !== 'grid' && <SolarPanel p={p} lit={pvShare} />}
            {batteryBus === b.id && (
              <g transform={`translate(${-30},${8})`}>
                <Box p={p} w={16} d={14} h={16} color={C.batt} />
                <rect x={p.x - 7} y={p.y - 26} width={14} height={5} fill={INK} />
                <rect x={p.x - 6} y={p.y - 25} width={12 * Math.max(0, Math.min(1, (step?.soc_pct ?? 0) / 100))} height={3} fill={C.ok} />
              </g>
            )}
            <g transform={`translate(${p.x},${p.y - (labelTop[b.id] ?? top)})`}>
              <rect x={-33} y={-13} width={66} height={19} rx={3} fill="#1C1A28" stroke={INK} strokeWidth={2} />
              <text className="pixel" textAnchor="middle" y={1} fontSize={10} fill="#F6F1E7">
                {b.id === 0 ? 'GRID 110kV' : `B${b.id} ${v != null ? v.toFixed(3) : ''}`}
              </text>
              {viol && (
                <g className="blink" transform="translate(42,-4)">
                  <polygon points="0,-11 11,8 -11,8" fill={C.bad} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
                  <text textAnchor="middle" y={6} fontSize={11} fontWeight={700} fill={INK}>!</text>
                </g>
              )}
            </g>
          </g>
        )
      })}
    </svg>
  )
}
