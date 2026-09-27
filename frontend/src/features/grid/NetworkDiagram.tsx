import type { NetworkSummary, StepRecord } from '../../types/api'
import { fmt } from '../../utils/format'

export type Selection = { kind: 'bus' | 'line' | 'trafo'; id: number } | null

interface Props {
  network: NetworkSummary
  step: StepRecord | null
  switchStates?: Record<string, boolean>
  vMin?: number
  vMax?: number
  lineMax?: number
  battery?: { bus: number } | null
  pvBuses?: number[]
  selected?: Selection
  onSelect?: (s: Selection) => void
  height?: number
  title?: string
}

const X0 = 40, SX = 58, Y0 = 26, SY = 34, YTOP = 16

const px = (x: number) => X0 + (x - 1) * SX
const py = (y: number) => Y0 + (YTOP - y) * SY

// Colours come from design tokens; thresholds come from backend constraints passed in as props.
function busTone(v: number | null | undefined, vMin: number, vMax: number) {
  if (v === null || v === undefined) return { fill: 'var(--color-ink-3)', tone: 'none' }
  if (v > vMax || v < vMin) return { fill: 'var(--color-crit)', tone: 'crit' }
  if (v > vMax - 0.01 || v < vMin + 0.01) return { fill: 'var(--color-warn)', tone: 'warn' }
  return { fill: 'var(--color-ok)', tone: 'ok' }
}

function lineTone(loading: number | undefined, max: number) {
  if (loading === undefined) return 'var(--color-line-strong)'
  if (loading > max) return 'var(--color-crit)'
  if (loading > 0.8 * max) return 'var(--color-warn)'
  return '#5f7384'
}

export function NetworkDiagram({ network, step, switchStates, vMin = 0.95, vMax = 1.05, lineMax = 100, battery, pvBuses = [],
  selected, onSelect, height = 520, title }: Props) {
  const bus = Object.fromEntries(network.buses.map((b) => [b.id, b]))
  const swOpen = (lineId: number) =>
    network.switches.some((s) => s.et === 'l' && s.element === lineId &&
      !((switchStates && s.switchable && s.name in switchStates) ? switchStates[s.name] : s.closed))
  const w = X0 * 2 + 9 * SX + 40
  const h = Y0 * 2 + 13 * SY
  const sel = (kind: 'bus' | 'line' | 'trafo', id: number) => selected?.kind === kind && selected.id === id

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ height, width: '100%' }} role="img"
      aria-label={title ?? 'Single-line diagram of the CIGRE MV feeder'} className="select-none">
      {/* transformers 110 kV -> 20 kV */}
      {network.trafos.map((t) => {
        const a = bus[t.hv_bus], b = bus[t.lv_bus]
        const load = step?.trafo_loading[t.id]
        const mx = (px(a.x) + px(b.x)) / 2, my = (py(a.y) + py(b.y)) / 2
        const col = lineTone(load, 100)
        return (
          <g key={`t${t.id}`} onClick={() => onSelect?.({ kind: 'trafo', id: t.id })} className="cursor-pointer">
            <line x1={px(a.x)} y1={py(a.y)} x2={px(b.x)} y2={py(b.y)} stroke={col} strokeWidth={2} />
            <circle cx={mx - 5} cy={my} r={8} fill="var(--color-surface)" stroke={col} strokeWidth={1.5} />
            <circle cx={mx + 5} cy={my} r={8} fill="none" stroke={col} strokeWidth={1.5} />
            {sel('trafo', t.id) && <circle cx={mx} cy={my} r={15} fill="none" stroke="var(--color-accent)" strokeWidth={1} />}
            <text x={mx + 16} y={my + 4} className="num" fontSize={10} fill="var(--color-ink-3)">{load !== undefined ? `${fmt(load, 0)}%` : t.name}</text>
          </g>
        )
      })}
      {/* lines */}
      {network.lines.map((l) => {
        const a = bus[l.from_bus], b = bus[l.to_bus]
        const open = swOpen(l.id)
        const loading = step?.line_loading[l.id]
        const p = step?.line_p_from[l.id]
        const col = open ? 'var(--color-line-strong)' : lineTone(loading, lineMax)
        const sw = open ? 1 : 1.5 + Math.min(5, (loading ?? 0) / 35)
        const x1 = px(a.x), y1 = py(a.y), x2 = px(b.x), y2 = py(b.y)
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
        // arrow in the direction of active power flow (from backend sign of p_from)
        const dir = p === undefined || Math.abs(p) < 1e-3 || open ? 0 : p > 0 ? 1 : -1
        const ang = Math.atan2(y2 - y1, x2 - x1) + (dir < 0 ? Math.PI : 0)
        const switches = network.switches.filter((s) => s.et === 'l' && s.element === l.id)
        return (
          <g key={`l${l.id}`} onClick={() => onSelect?.({ kind: 'line', id: l.id })} className="cursor-pointer">
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={sw} strokeDasharray={open ? '4 4' : undefined} strokeLinecap="round" />
            {sel('line', l.id) && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-accent)" strokeWidth={sw + 5} opacity={0.25} />}
            {dir !== 0 && (
              <path d="M -5 -4 L 4 0 L -5 4 z" fill={col} transform={`translate(${mx},${my}) rotate(${(ang * 180) / Math.PI})`} />
            )}
            {switches.filter((s) => s.switchable).map((s) => {
              const at = s.bus === l.from_bus ? 0.22 : 0.78
              const sx = x1 + (x2 - x1) * at, sy = y1 + (y2 - y1) * at
              const closed = switchStates && s.name in switchStates ? switchStates[s.name] : s.closed
              return (
                <g key={`s${s.id}`}>
                  <rect x={sx - 4} y={sy - 4} width={8} height={8} fill={closed ? 'var(--color-ink-2)' : 'var(--color-bg)'}
                    stroke="var(--color-ink-2)" strokeWidth={1.2}><title>{`${s.name}: ${closed ? 'closed' : 'open'}`}</title></rect>
                  <text x={sx + 6} y={sy - 5} fontSize={8.5} fill="var(--color-ink-3)">{s.name}</text>
                </g>
              )
            })}
          </g>
        )
      })}
      {/* buses */}
      {network.buses.map((b) => {
        const v = step?.bus_vm[b.id]
        const tone = b.vn_kv > 100 ? { fill: 'var(--color-ink-2)', tone: 'slack' } : busTone(v, vMin, vMax)
        const x = px(b.x), y = py(b.y)
        const hasPv = pvBuses.includes(b.id)
        const isBatt = battery?.bus === b.id
        return (
          <g key={`b${b.id}`} onClick={() => onSelect?.({ kind: 'bus', id: b.id })} className="cursor-pointer">
            <circle cx={x} cy={y} r={12} fill="transparent" />
            <rect x={x - 9} y={y - 3} width={18} height={6} rx={1} fill={tone.fill} stroke="var(--color-bg)" strokeWidth={2} />
            {sel('bus', b.id) && <rect x={x - 13} y={y - 7} width={26} height={14} fill="none" stroke="var(--color-accent)" />}
            <text x={x + 12} y={y - 5} fontSize={10} fill="var(--color-ink-2)">{b.id === 0 ? '110 kV grid' : `B${b.id}`}</text>
            {v !== undefined && v !== null && b.vn_kv < 100 && (
              <text x={x + 12} y={y + 8} className="num" fontSize={10}
                fill={tone.tone === 'crit' ? 'var(--color-crit)' : tone.tone === 'warn' ? 'var(--color-warn)' : 'var(--color-ink-3)'}>
                {tone.tone === 'crit' ? '▲' : ''}{v.toFixed(3)}
              </text>
            )}
            {hasPv && (
              <g transform={`translate(${x - 18},${y - 14})`}>
                <circle r={3.2} fill="var(--color-s-solar)" />
                {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                  <line key={a} x1={0} y1={-5} x2={0} y2={-6.8} stroke="var(--color-s-solar)" strokeWidth={1} transform={`rotate(${a})`} />
                ))}
                <title>PV at bus {b.id}</title>
              </g>
            )}
            {isBatt && (
              <g transform={`translate(${x - 26},${y + 8})`}>
                <rect width={20} height={10} fill="none" stroke="var(--color-s-battery)" strokeWidth={1.2} />
                <rect x={1.5} y={1.5} height={7} width={Math.max(0, Math.min(17, 17 * ((step?.soc_pct ?? 0) / 100)))} fill="var(--color-s-battery)" />
                <rect x={20} y={3} width={2} height={4} fill="var(--color-s-battery)" />
                <text x={-2} y={21} className="num" fontSize={9} fill="var(--color-ink-3)">{step?.soc_pct != null ? `${step.soc_pct.toFixed(0)}%` : 'BESS'}</text>
                <title>Battery at bus {b.id}</title>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function DiagramLegend() {
  const item = (el: React.ReactNode, label: string) => <span className="inline-flex items-center gap-1.5">{el}{label}</span>
  const bar = (c: string) => <span className="inline-block w-3.5 h-1.5" style={{ background: c }} />
  const ln = (c: string, dash = false) => <svg width="18" height="6"><line x1="1" y1="3" x2="17" y2="3" stroke={c} strokeWidth="2" strokeDasharray={dash ? '3 3' : undefined} /></svg>
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3 px-3 py-2">
      {item(bar('var(--color-ok)'), 'bus within limits')}
      {item(bar('var(--color-warn)'), 'bus within 0.01 pu of limit')}
      {item(bar('var(--color-crit)'), 'bus ▲ out of limits')}
      {item(ln('#5f7384'), 'line < 80 %')}
      {item(ln('var(--color-warn)'), '80–100 %')}
      {item(ln('var(--color-crit)'), '> 100 % (thicker = more loaded)')}
      {item(ln('var(--color-line-strong)', true), 'open (switch open)')}
      {item(<span className="inline-block w-2 h-2 border border-ink-2 bg-ink-2" />, 'switch closed')}
      {item(<span className="inline-block w-2 h-2 border border-ink-2" />, 'open')}
      {item(<svg width="10" height="8"><path d="M0 0 L9 4 L0 8z" fill="#5f7384" /></svg>, 'power-flow direction')}
    </div>
  )
}
