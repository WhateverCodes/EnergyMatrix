import type { ReactNode } from 'react'
import type { Constraints, NetworkSummary, StepRecord } from '../../types/api'
import { useTheme } from '../../hooks/useTheme'

/* Illustrated isometric "smart grid" scene (original artwork in the flat-isometric style).
   DATA: bus positions (CIGRE geodata), which equipment each bus has, wire loading, flow direction,
   bus voltages, battery SOC — all from the backend. DECORATION ONLY: trees, clouds, sun/moon, ground. */

const TW = 84, TH = 42
type P2 = { x: number; y: number }
const lerp = (a: P2, b: P2, t: number): P2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const pts = (a: P2[]) => a.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
const up = (q: P2, h: number): P2 => ({ x: q.x, y: q.y - h })
export const iso = (x: number, y: number): P2 => ({ x: (x - (16 - y)) * TW / 2, y: (x + (16 - y)) * TH / 2 })
const tileIso = (a: number, b: number): P2 => ({ x: (a - b) * TW / 2, y: (a + b) * TH / 2 })
const hash = (a: number, b: number) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0 }

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`
}

/** bilinear point on a quad (p00 bottom-left, p10 bottom-right, p11 top-right, p01 top-left) */
const Q = (q: [P2, P2, P2, P2], u: number, v: number) => lerp(lerp(q[0], q[1], u), lerp(q[3], q[2], u), v)
const sub = (q: [P2, P2, P2, P2], u0: number, u1: number, v0: number, v1: number) => [Q(q, u0, v0), Q(q, u1, v0), Q(q, u1, v1), Q(q, u0, v1)]

type Pal = ReturnType<typeof palette>
function palette(night: boolean) {
  return night ? {
    ground: '#172a40', edgeL: '#0f1e30', edgeR: '#0b1726',
    wall: '#c9c2d8', wall2: '#a9a1bd', roof: '#b0573f', window: '#ffd66b', windowOff: '#39405c', glass: '#4f6fb0',
    trunk: '#5a4232', leaf: '#2f7a55', leaf2: '#3a8f63', panel: '#1d2b57', panelLine: '#6d86c9',
    metal: '#8d93a8', concrete: '#6d7086', batt: '#3fb8c9', tower: '#8a7cc9', label: '#1c1a28', labelInk: '#f6f1e7',
    ok: '#3fd0e0', busy: '#ffb13b', bad: '#ff5d5d', flow: '#e8fbff', line: '#0f0e17', open: '#6b6585', cloud: '#2a3350',
  } : {
    ground: '#ffffff', edgeL: '#dfe6ee', edgeR: '#d0d9e3',
    wall: '#fbf6ec', wall2: '#e9e1d2', roof: '#e0714f', window: '#9fd3ef', windowOff: '#9fd3ef', glass: '#8cc7ea',
    trunk: '#8a6446', leaf: '#4caf6e', leaf2: '#63c181', panel: '#26407f', panelLine: '#8fb1ee',
    metal: '#9aa3b5', concrete: '#c9cdd6', batt: '#35b6c7', tower: '#9d8cd6', label: '#ffffff', labelInk: '#1c1a28',
    ok: '#1fa9bc', busy: '#f29f1c', bad: '#e84646', flow: '#ffffff', line: '#27324a', open: '#a3a9b8', cloud: '#ffffff',
  }
}

/* ───────── primitives ───────── */
function boxCorners(p: P2, w: number, d: number) {
  const hw = w / 2, hd = d / 2
  const m = (u: number, v: number): P2 => ({ x: p.x + u - v, y: p.y + (u + v) / 2 })
  return { A: m(-hw, -hd), B: m(hw, -hd), C: m(hw, hd), D: m(-hw, hd) }
}
function Box({ p, w, d, h, color, top, stroke }: { p: P2; w: number; d: number; h: number; color: string; top?: string; stroke?: string }) {
  const { A, B, C, D } = boxCorners(p, w, d)
  const s = stroke ?? shade(color, 0.55)
  return (
    <g strokeLinejoin="round" stroke={s} strokeWidth={1.1}>
      <polygon points={pts([D, C, up(C, h), up(D, h)])} fill={shade(color, 0.9)} />
      <polygon points={pts([C, B, up(B, h), up(C, h)])} fill={shade(color, 0.74)} />
      <polygon points={pts([up(A, h), up(B, h), up(C, h), up(D, h)])} fill={top ?? color} />
    </g>
  )
}
function walls(p: P2, w: number, d: number, h: number) {
  const { B, C, D } = boxCorners(p, w, d)
  const left: [P2, P2, P2, P2] = [D, C, up(C, h), up(D, h)]
  const right: [P2, P2, P2, P2] = [C, B, up(B, h), up(C, h)]
  return { left, right }
}
function Windows({ wall, cols, rows, fill, lit, seed, night, dark }: { wall: [P2, P2, P2, P2]; cols: number; rows: number; fill: string; lit: string; seed: number; night: boolean; dark: string }) {
  const out: ReactNode[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u0 = 0.12 + (c / cols) * 0.76, u1 = u0 + 0.76 / cols * 0.62
    const v0 = 0.14 + (r / rows) * 0.76, v1 = v0 + 0.76 / rows * 0.55
    const on = night ? hash(seed + r, c) % 3 !== 0 : true
    out.push(<polygon key={`${r}-${c}`} points={pts(sub(wall, u0, u1, v0, v1))} fill={on ? (night ? lit : fill) : dark} />)
  }
  return <g>{out}</g>
}
function Shadow({ p, rx, ry }: { p: P2; rx: number; ry: number }) {
  return <ellipse cx={p.x + 6} cy={p.y + 4} rx={rx} ry={ry} fill="#000" opacity={0.12} />
}

/* ───────── buildings & systems ───────── */
function House({ p, pal, pv, lit, night, seed }: { p: P2; pal: Pal; pv: boolean; lit: number; night: boolean; seed: number }) {
  const w = 30, d = 26, h = 19, rise = 15
  const { A, B, C, D } = boxCorners(p, w, d)
  const { left, right } = walls(p, w, d, h)
  const R1 = up(lerp(A, D, 0.5), h + rise), R2 = up(lerp(B, C, 0.5), h + rise)
  const front: [P2, P2, P2, P2] = [up(D, h), up(C, h), R2, R1]
  const roofS = shade(pal.roof, 0.55)
  return (
    <g>
      <Shadow p={p} rx={30} ry={13} />
      <g strokeLinejoin="round" stroke={shade(pal.wall, 0.6)} strokeWidth={1.1}>
        <polygon points={pts(left)} fill={pal.wall} />
        <polygon points={pts(right)} fill={pal.wall2} />
      </g>
      <Windows wall={left} cols={2} rows={1} fill={pal.window} lit={pal.window} seed={seed} night={night} dark={pal.windowOff} />
      {/* door */}
      <polygon points={pts(sub(right, 0.38, 0.62, 0, 0.62))} fill={shade(pal.roof, 0.7)} stroke={roofS} strokeWidth={0.8} />
      {/* gable roof */}
      <g strokeLinejoin="round" stroke={roofS} strokeWidth={1.1}>
        <polygon points={pts([up(A, h), up(B, h), R2, R1])} fill={shade(pal.roof, 1.08)} />
        <polygon points={pts([up(C, h), up(B, h), R2])} fill={pal.wall2} />
        <polygon points={pts(front)} fill={pal.roof} />
      </g>
      {/* chimney */}
      <Box p={{ x: R1.x + 9, y: R1.y + 10 }} w={5} d={5} h={9} color={shade(pal.roof, 0.8)} />
      {pv && (
        <g>
          <polygon points={pts(sub(front, 0.1, 0.9, 0.12, 0.84))} fill={pal.panel} stroke={shade(pal.panel, 0.6)} strokeWidth={1} />
          {[1, 2, 3].map((i) => { const a = Q(front, 0.1 + 0.2 * i, 0.12), b = Q(front, 0.1 + 0.2 * i, 0.84); return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={pal.panelLine} strokeWidth={0.8} /> })}
          {(() => { const a = Q(front, 0.1, 0.48), b = Q(front, 0.9, 0.48); return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={pal.panelLine} strokeWidth={0.8} /> })()}
          {/* glint scaled by current PV output (from backend) */}
          <polygon points={pts(sub(front, 0.1, 0.9, 0.12, 0.84))} fill="#ffe28a" opacity={0.08 + 0.32 * lit} />
        </g>
      )}
    </g>
  )
}

function Tower({ p, pal, kind, night, seed }: { p: P2; pal: Pal; kind: string; night: boolean; seed: number }) {
  const h = kind === 'hospital' ? 48 : kind === 'office' ? 64 : 60
  const w = 30, d = 28
  const body = kind === 'hospital' ? '#f4f6fa' : kind === 'office' ? '#a8c3dd' : pal.tower
  const { left, right } = walls(p, w, d, h)
  return (
    <g>
      <Shadow p={p} rx={34} ry={15} />
      <Box p={p} w={w} d={d} h={h} color={body} />
      <Windows wall={left} cols={3} rows={Math.round(h / 12)} fill={kind === 'office' ? pal.glass : pal.window} lit={pal.window} seed={seed} night={night} dark={pal.windowOff} />
      <Windows wall={right} cols={3} rows={Math.round(h / 12)} fill={kind === 'office' ? shade(pal.glass, 0.85) : shade(pal.window, 0.85)} lit={pal.window} seed={seed + 7} night={night} dark={pal.windowOff} />
      <Box p={{ x: p.x + 2, y: p.y - h + 1 }} w={10} d={8} h={6} color={pal.metal} />
      {kind === 'hospital' && (() => { const c = Q(right, 0.5, 0.8); return <g><rect x={c.x - 7} y={c.y - 7} width={14} height={14} rx={2} fill="#fff" stroke="#e84646" strokeWidth={1} /><path d={`M ${c.x - 4} ${c.y} H ${c.x + 4} M ${c.x} ${c.y - 4} V ${c.y + 4}`} stroke="#e84646" strokeWidth={2.6} /></g> })()}
    </g>
  )
}

function Factory({ p, pal, night, seed }: { p: P2; pal: Pal; night: boolean; seed: number }) {
  const w = 46, d = 30, h = 20
  const { A, B, C, D } = boxCorners(p, w, d)
  const { left } = walls(p, w, d, h)
  const teeth: ReactNode[] = []
  for (let i = 0; i < 3; i++) {
    const t0 = i / 3, t1 = (i + 1) / 3
    const b0 = up(lerp(D, C, t0), h), b1 = up(lerp(D, C, t1), h), a0 = up(lerp(A, B, t0), h), a1 = up(lerp(A, B, t1), h)
    const r0 = up(lerp(D, C, t0), h + 12), r1 = up(lerp(A, B, t0), h + 12)
    teeth.push(<g key={i} stroke={shade('#b9c2cf', 0.55)} strokeWidth={1}>
      <polygon points={pts([a0, a1, b1, b0])} fill="#d9dee6" />
      <polygon points={pts([b0, b1, r0])} fill="#aeb8c7" />
      <polygon points={pts([r0, r1, a1, b1])} fill={pal.glass} opacity={0.9} />
    </g>)
  }
  const ch = { x: B.x - 12, y: B.y - 2 }
  return (
    <g>
      <Shadow p={p} rx={44} ry={18} />
      <Box p={p} w={w} d={d} h={h} color="#c6ccd6" />
      <Windows wall={left} cols={4} rows={1} fill={pal.window} lit={pal.window} seed={seed} night={night} dark={pal.windowOff} />
      {teeth}
      <Box p={ch} w={8} d={8} h={38} color="#b4523f" />
      {!night && [0, 1, 2].map((i) => <circle key={i} cx={ch.x + 4 + i * 7} cy={ch.y - 46 - i * 8} r={5 + i * 2} fill="#eef1f5" opacity={0.8 - i * 0.2} />)}
    </g>
  )
}

function School({ p, pal, night, seed }: { p: P2; pal: Pal; night: boolean; seed: number }) {
  const { left } = walls(p, 44, 28, 22)
  return (
    <g>
      <Shadow p={p} rx={42} ry={17} />
      <Box p={p} w={44} d={28} h={22} color="#f2c38f" />
      <Windows wall={left} cols={4} rows={1} fill={pal.window} lit={pal.window} seed={seed} night={night} dark={pal.windowOff} />
      <line x1={p.x + 8} y1={p.y - 22} x2={p.x + 8} y2={p.y - 50} stroke={pal.metal} strokeWidth={1.6} />
      <path d={`M ${p.x + 8} ${p.y - 50} l 14 4 l -14 5 z`} fill="#e84646" />
    </g>
  )
}

function Substation({ p, pal }: { p: P2; pal: Pal }) {
  const { A, B, C, D } = boxCorners(p, 52, 40)
  const t1 = { x: p.x - 10, y: p.y - 2 }, t2 = { x: p.x + 12, y: p.y + 4 }
  const post = (q: P2, hgt: number) => <line x1={q.x} y1={q.y} x2={q.x} y2={q.y - hgt} stroke={pal.metal} strokeWidth={2} />
  return (
    <g>
      <Shadow p={p} rx={46} ry={19} />
      <Box p={p} w={52} d={40} h={3} color={pal.concrete} />
      {/* fence */}
      <g stroke={pal.metal} strokeWidth={1} fill="none" opacity={0.9}>
        <polygon points={pts([up(A, 13), up(B, 13), up(C, 13), up(D, 13)])} />
        {[A, B, C, D].map((q, i) => <line key={i} x1={q.x} y1={q.y - 3} x2={q.x} y2={q.y - 13} />)}
      </g>
      {[t1, t2].map((t, i) => (
        <g key={i}>
          <Box p={t} w={14} d={12} h={14} color="#7f9a8a" />
          {[-4, 0, 4].map((dx) => <line key={dx} x1={t.x + dx} y1={t.y - 16} x2={t.x + dx} y2={t.y - 24} stroke="#d9dde5" strokeWidth={2} strokeLinecap="round" />)}
        </g>
      ))}
      {/* busbar frame */}
      {post({ x: p.x - 20, y: p.y + 8 }, 34)}{post({ x: p.x + 20, y: p.y - 12 }, 34)}
      <line x1={p.x - 20} y1={p.y - 26} x2={p.x + 20} y2={p.y - 46} stroke={pal.metal} strokeWidth={2} />
    </g>
  )
}

function Pylon({ p, pal, hgt = 92 }: { p: P2; pal: Pal; hgt?: number }) {
  const s = pal.metal
  const top = { x: p.x, y: p.y - hgt }
  return (
    <g stroke={s} strokeWidth={1.6} fill="none" strokeLinejoin="round">
      <Shadow p={p} rx={20} ry={8} />
      <path d={`M ${p.x - 14} ${p.y} L ${top.x - 3} ${top.y} L ${top.x + 3} ${top.y} L ${p.x + 14} ${p.y}`} />
      {[0.2, 0.42, 0.62].map((t, i) => {
        const y = p.y - hgt * t, half = 14 - 11 * t
        return <path key={i} d={`M ${p.x - half} ${y} L ${p.x + half} ${y - hgt * 0.2} M ${p.x + half} ${y} L ${p.x - half} ${y - hgt * 0.2}`} strokeWidth={1} />
      })}
      <line x1={p.x - 26} y1={top.y + 18} x2={p.x + 26} y2={top.y + 18} />
      <line x1={p.x - 20} y1={top.y + 34} x2={p.x + 20} y2={top.y + 34} />
      {[-26, 26, -20, 20].map((dx, i) => <line key={i} x1={p.x + dx} y1={top.y + (i < 2 ? 18 : 34)} x2={p.x + dx} y2={top.y + (i < 2 ? 25 : 41)} stroke="#d9dde5" strokeWidth={2} />)}
    </g>
  )
}

function PowerStation({ p, night }: { p: P2; night: boolean }) {
  const q = { x: p.x - 70, y: p.y - 16 }
  const w = 22
  return (
    <g>
      <Shadow p={q} rx={36} ry={14} />
      <path d={`M ${q.x - w} ${q.y} Q ${q.x - w * 0.45} ${q.y - 30} ${q.x - w * 0.7} ${q.y - 58} L ${q.x + w * 0.7} ${q.y - 58} Q ${q.x + w * 0.45} ${q.y - 30} ${q.x + w} ${q.y} Z`}
        fill={night ? '#7b8196' : '#dfe3ea'} stroke={shade('#c3c9d4', 0.6)} strokeWidth={1.1} />
      <ellipse cx={q.x} cy={q.y - 58} rx={w * 0.7} ry={4} fill={night ? '#5b6076' : '#c3c9d4'} />
      {!night && [0, 1, 2].map((i) => <circle key={i} cx={q.x - 4 + i * 9} cy={q.y - 70 - i * 9} r={8 + i * 3} fill="#fff" opacity={0.85 - i * 0.2} />)}
      <Box p={{ x: q.x + 34, y: q.y + 10 }} w={28} d={22} h={18} color={night ? '#6d7086' : '#c9cdd6'} />
    </g>
  )
}

function WindTurbine({ p, pal }: { p: P2; pal: Pal }) {
  const hub = { x: p.x, y: p.y - 96 }
  const blade = (a: number) => {
    const r = (a * Math.PI) / 180
    return <path key={a} d={`M ${hub.x} ${hub.y} L ${hub.x + Math.cos(r) * 40 - Math.sin(r) * 3} ${hub.y + Math.sin(r) * 40 + Math.cos(r) * 3} L ${hub.x + Math.cos(r) * 40} ${hub.y + Math.sin(r) * 40} Z`} fill="#f5f7fa" stroke={pal.metal} strokeWidth={1} />
  }
  return (
    <g>
      <Shadow p={p} rx={14} ry={6} />
      <path d={`M ${p.x - 3.5} ${p.y} L ${hub.x - 1.5} ${hub.y} L ${hub.x + 1.5} ${hub.y} L ${p.x + 3.5} ${p.y} Z`} fill="#eef1f5" stroke={pal.metal} strokeWidth={1} />
      {/* rotor drawn still: the model holds the CIGRE wind turbine at 0 MW */}
      {[-90, 30, 150].map(blade)}
      <rect x={hub.x - 7} y={hub.y - 4} width={14} height={8} rx={3} fill="#e3e7ee" stroke={pal.metal} strokeWidth={1} />
      <circle cx={hub.x} cy={hub.y} r={3} fill={pal.metal} />
    </g>
  )
}

function Battery({ p, pal, soc }: { p: P2; pal: Pal; soc: number }) {
  const w = 30, d = 18, h = 16
  const { left, right } = walls(p, w, d, h)
  return (
    <g>
      <Shadow p={p} rx={26} ry={11} />
      <Box p={p} w={w} d={d} h={h} color={pal.batt} />
      {[0.2, 0.35, 0.5, 0.65, 0.8].map((u) => { const a = Q(left, u, 0.15), b = Q(left, u, 0.85); return <line key={u} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={shade(pal.batt, 0.6)} strokeWidth={1} /> })}
      <polygon points={pts(sub(right, 0.12, 0.88, 0.3, 0.7))} fill="#0f2b33" />
      <polygon points={pts(sub(right, 0.14, 0.14 + 0.72 * Math.max(0, Math.min(1, soc)), 0.36, 0.64))} fill="#6ee7a8" />
    </g>
  )
}

function Tree({ p, pal, s = 1 }: { p: P2; pal: Pal; s?: number }) {
  return (
    <g>
      <ellipse cx={p.x + 5} cy={p.y + 2} rx={10 * s} ry={4.5 * s} fill="#000" opacity={0.12} />
      <rect x={p.x - 1.6} y={p.y - 12 * s} width={3.2} height={12 * s} fill={pal.trunk} />
      <circle cx={p.x} cy={p.y - 18 * s} r={10 * s} fill={pal.leaf} />
      <circle cx={p.x - 3 * s} cy={p.y - 22 * s} r={6 * s} fill={pal.leaf2} />
    </g>
  )
}

/* ───────── scene ───────── */
export type Building = 'grid' | 'substation' | 'house' | 'tower' | 'factory' | 'school' | 'hospital' | 'office'

export interface SceneProps {
  network: NetworkSummary
  step: StepRecord | null
  c: Constraints
  switchStates?: Record<string, boolean>
  consumerBus: number
  consumerKind: Building
  batteryBus: number | null
  pvBuses: number[]
  pvShare: number
  selected: number | null
  onSelect: (bus: number | null) => void
}

export function IsoScene({ network, step, c, switchStates, consumerBus, consumerKind, batteryBus, pvBuses, pvShare, selected, onSelect }: SceneProps) {
  const night = useTheme() === 'dark'
  const pal = palette(night)
  const bus = Object.fromEntries(network.buses.map((b) => [b.id, b]))
  const P = (id: number) => iso(bus[id].x, bus[id].y)
  const windBuses = network.sgens.filter((g) => g.type === 'WP').map((g) => g.bus)
  const isOpen = (lineId: number) => network.switches.some((s) => s.et === 'l' && s.element === lineId &&
    !((switchStates && s.switchable && s.name in switchStates) ? switchStates[s.name] : s.closed))

  const busCol = (v: number | null | undefined) => v == null ? pal.open : (v > c.v_max || v < c.v_min) ? pal.bad : (v > c.v_max - 0.01 || v < c.v_min + 0.01) ? pal.busy : pal.ok
  const wireCol = (load: number | undefined, max: number) => load === undefined ? pal.open : load > max ? pal.bad : load > 0.8 * max ? pal.busy : pal.ok

  // plain ground plane (tile space a ∈ [0,11], b ∈ [-1,14]): one flat colour, no pattern
  const a0 = -0.5, a1 = 11.5, b0 = -1.5, b1 = 14.5
  const top = tileIso(a0, b0), right = tileIso(a1, b0), bottom = tileIso(a1, b1), left = tileIso(a0, b1)
  const T = 10

  type Wire = { key: string; a: number; b: number; load?: number; p?: number; open: boolean; name: string; max: number }
  const wires: Wire[] = [
    ...network.trafos.map((t) => ({ key: `t${t.id}`, a: t.hv_bus, b: t.lv_bus, load: step?.trafo_loading[t.id], p: step?.trafo_p_hv[t.id], open: false, name: t.name, max: c.trafo_loading_max })),
    ...network.lines.map((l) => ({ key: `l${l.id}`, a: l.from_bus, b: l.to_bus, load: step?.line_loading[l.id], p: step?.line_p_from[l.id], open: isOpen(l.id), name: l.name, max: c.line_loading_max })),
  ]

  // decorative trees on free tiles, deterministic
  const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
  }
  const trees: { p: P2; s: number }[] = []
  for (let a = 0; a <= 11; a++) for (let b = -1; b <= 14; b++) {
    if (hash(a, b) % 4 !== 0) continue
    const gx = a, gy = b
    const nearBus = network.buses.some((bb) => Math.hypot(bb.x - gx, (16 - bb.y) - gy) < 1.35)
    const nearLine = wires.some((w) => segDist(gx, gy, bus[w.a].x, 16 - bus[w.a].y, bus[w.b].x, 16 - bus[w.b].y) < 0.6)
    if (nearBus || nearLine) continue
    trees.push({ p: tileIso(a + ((hash(b, a) % 7) - 3) / 14, b + ((hash(a + 9, b) % 7) - 3) / 14), s: 0.85 + (hash(a, b + 3) % 4) / 10 })
  }

  type Item = { depth: number; node: ReactNode }
  const items: Item[] = trees.map((t, i) => ({ depth: t.p.y, node: <Tree key={`tr${i}`} p={t.p} pal={pal} s={t.s} /> }))

  network.buses.forEach((b) => {
    const p = P(b.id)
    const kind: Building = b.id === 0 ? 'grid' : (b.id === 1 || b.id === 12) ? 'substation' : b.id === consumerBus ? consumerKind : 'house'
    const pv = pvBuses.includes(b.id)
    let node: ReactNode
    if (kind === 'grid') node = <g><PowerStation p={p} night={night} /><Pylon p={p} pal={pal} /></g>
    else if (kind === 'substation') node = <Substation p={p} pal={pal} />
    else if (kind === 'factory') node = <Factory p={p} pal={pal} night={night} seed={b.id} />
    else if (kind === 'school') node = <School p={p} pal={pal} night={night} seed={b.id} />
    else if (kind === 'house') node = <House p={p} pal={pal} pv={pv} lit={pvShare} night={night} seed={b.id} />
    else node = <Tower p={p} pal={pal} kind={kind} night={night} seed={b.id} />
    const grow = (n: ReactNode, q: P2, k = 1.25) => <g transform={`matrix(${k},0,0,${k},${(1 - k) * q.x},${(1 - k) * q.y})`}>{n}</g>
    node = grow(node, p)
    items.push({ depth: p.y, node: <g key={`b${b.id}`} onClick={(e) => { e.stopPropagation(); onSelect(b.id) }} className="cursor-pointer"><title>{`${b.name}${step?.bus_vm[b.id] != null ? ` — ${step.bus_vm[b.id]!.toFixed(3)} pu` : ''}`}</title>{node}</g> })
    if (pv && kind !== 'house' && kind !== 'grid') {
      // rooftop-style PV array beside non-house buildings
      const q = { x: p.x + 30, y: p.y + 10 }
      items.push({ depth: q.y, node: <g key={`pv${b.id}`}><Box p={q} w={20} d={14} h={3} color={pal.panel} top={pal.panel} /></g> })
    }
    if (batteryBus === b.id) {
      const q = { x: p.x - 42, y: p.y + 16 }
      items.push({ depth: q.y, node: <g key="batt"><title>{`Battery — ${step?.soc_pct?.toFixed(0) ?? '—'}% charged`}</title>{grow(<Battery p={q} pal={pal} soc={(step?.soc_pct ?? 0) / 100} />, q)}</g> })
    }
    if (windBuses.includes(b.id)) {
      const q = { x: p.x + 40, y: p.y + 14 }
      items.push({ depth: q.y, node: <g key={`wt${b.id}`}><title>Wind turbine WKA 7 — held at 0 MW in this study (rotor shown still)</title><WindTurbine p={q} pal={pal} /></g> })
    }
  })
  items.sort((u, v) => u.depth - v.depth)

  // label placement with simple collision nudging
  const labelY: Record<number, number> = {}
  const placed: P2[] = []
  const baseTop: Record<string, number> = { grid: 108, substation: 72, house: 60, tower: 92, office: 96, hospital: 76, factory: 84, school: 66 }
  for (const b of [...network.buses].sort((u, v) => P(v.id).y - P(u.id).y)) {
    const p = P(b.id)
    const kind = b.id === 0 ? 'grid' : (b.id === 1 || b.id === 12) ? 'substation' : b.id === consumerBus ? consumerKind : 'house'
    let y = p.y - baseTop[kind]
    for (let g = 0; g < 8 && placed.some((q) => Math.abs(q.x - p.x) < 70 && Math.abs(q.y - y) < 20); g++) y -= 20
    placed.push({ x: p.x, y }); labelY[b.id] = y
  }

  const xs = network.buses.map((b) => P(b.id).x), ys = network.buses.map((b) => P(b.id).y)
  // frame the buildings (the island continues past the edges like a cropped illustration)
  const minX = Math.min(...xs) - 95, maxX = Math.max(...xs) + 95
  const minY = Math.min(...ys) - 140, maxY = Math.max(...ys) + 70

  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="w-full h-full select-none" role="img"
      aria-label="Illustrated isometric map of the feeder: buildings at buses, wires coloured by loading, dots show power flow">
      {/* plain ground plane */}
      <polygon points={pts([left, bottom, { x: bottom.x, y: bottom.y + T }, { x: left.x, y: left.y + T }])} fill={pal.edgeL} />
      <polygon points={pts([bottom, right, { x: right.x, y: right.y + T }, { x: bottom.x, y: bottom.y + T }])} fill={pal.edgeR} />
      <polygon points={pts([top, right, bottom, left])} fill={pal.ground} onClick={() => onSelect(null)} />

      {/* energy lines */}
      {wires.map((w) => {
        const A = P(w.a), B = P(w.b)
        const col = w.open ? pal.open : wireCol(w.load, w.max)
        const dir = w.open || w.p === undefined || Math.abs(w.p) < 0.02 ? 0 : w.p > 0 ? 1 : -1
        const [s, e] = dir >= 0 ? [A, B] : [B, A]
        const dur = w.p ? Math.max(0.35, Math.min(5, 3 / Math.abs(w.p))) : 0
        const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
        const over = !w.open && w.load !== undefined && w.load > w.max
        return (
          <g key={w.key}>
            <title>{`${w.name}: ${w.open ? 'open (switched out)' : `${w.load?.toFixed(0) ?? '—'}% loaded, ${w.p !== undefined ? Math.abs(w.p).toFixed(2) : '—'} MW`}`}</title>
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={pal.line} strokeOpacity={night ? 0.9 : 0.35} strokeWidth={w.open ? 4 : 9} strokeLinecap="round" />
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={col} strokeWidth={w.open ? 2 : 5} strokeLinecap="round" strokeDasharray={w.open ? '6 6' : undefined} />
            {dir !== 0 && <line className="flow" x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={pal.flow} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 30" style={{ animationDuration: `${dur}s` }} />}
            {over && (
              <g transform={`translate(${mid.x},${mid.y - 16})`}>
                <rect x={-25} y={-11} width={50} height={20} rx={10} fill={pal.bad} />
                <text textAnchor="middle" y={4} fontSize={11} className="num" fill="#fff" fontWeight={700}>{w.load!.toFixed(0)}%</text>
              </g>
            )}
          </g>
        )
      })}

      {/* switches */}
      {network.switches.filter((s) => s.switchable && s.et === 'l').map((s) => {
        const l = network.lines.find((x) => x.id === s.element)!
        const A = P(l.from_bus), B = P(l.to_bus)
        const q = lerp(A, B, s.bus === l.from_bus ? 0.25 : 0.75)
        const closed = switchStates && s.name in switchStates ? switchStates[s.name] : s.closed
        return <g key={`sw${s.id}`}><title>{`Switch ${s.name}: ${closed ? 'closed' : 'open'}`}</title>
          <rect x={q.x - 6} y={q.y - 6} width={12} height={12} rx={3} fill={closed ? '#ffc857' : pal.label} stroke={pal.line} strokeWidth={1.5} /></g>
      })}

      {/* voltage pads under each bus */}
      {network.buses.map((b) => {
        const p = P(b.id)
        const v = step?.bus_vm[b.id]
        return <ellipse key={`pad${b.id}`} cx={p.x} cy={p.y + 3} rx={b.id === 0 ? 0 : 27} ry={12} fill={b.vn_kv > 100 ? 'transparent' : busCol(v)} opacity={0.85} stroke={pal.line} strokeOpacity={0.4} strokeWidth={1.2} />
      })}
      {selected !== null && bus[selected] && (() => { const p = P(selected); return <ellipse cx={p.x} cy={p.y + 3} rx={36} ry={17} fill="none" stroke="#ffc857" strokeWidth={3} strokeDasharray="5 4" /> })()}

      {/* buildings, trees and equipment in depth order */}
      {items.map((it) => it.node)}

      {/* labels */}
      {network.buses.map((b) => {
        const p = P(b.id)
        const v = step?.bus_vm[b.id]
        const viol = step?.violations.some((x) => x.hard && x.element === 'bus' && x.id === b.id)
        const text = b.id === 0 ? '110 kV grid' : b.id === 1 ? 'Substation A' : b.id === 12 ? 'Substation B' : `B${b.id} · ${v != null ? v.toFixed(3) : ''}`
        return (
          <g key={`lab${b.id}`} transform={`translate(${p.x},${labelY[b.id]})`} pointerEvents="none">
            <rect x={-38} y={-12} width={76} height={19} rx={9.5} fill={pal.label} stroke={viol ? pal.bad : pal.line} strokeOpacity={viol ? 1 : 0.25} strokeWidth={viol ? 2 : 1} />
            <text textAnchor="middle" y={2} fontSize={11} fontWeight={600} fill={viol ? pal.bad : pal.labelInk} className="num">{text}</text>
            {viol && <g className="blink" transform="translate(44,-3)"><circle r={8} fill={pal.bad} /><text textAnchor="middle" y={4} fontSize={11} fontWeight={700} fill="#fff">!</text></g>}
          </g>
        )
      })}
    </svg>
  )
}
