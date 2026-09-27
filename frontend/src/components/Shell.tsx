import { NavLink, Outlet } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { useScenario } from '../app/ScenarioContext'

const NAV = [
  ['/', 'Scenario Builder'],
  ['/grid', 'Grid Twin'],
  ['/lab', 'Live Lab'],
  ['/actions', 'Heal & Verify'],
  ['/forecast', 'Forecast & Predict'],
  ['/whatif', 'What-If'],
  ['/library', 'Library'],
] as const

export function HonestyStrip() {
  const { run, config } = useScenario()
  const cfgQ = useQuery({ queryKey: ['config'], queryFn: api.config })
  const ds = useQuery({ queryKey: ['datasets'], queryFn: api.datasets })
  const dsId = config?.dataset_id ?? cfgQ.data?.default_dataset
  const meta = ds.data?.find((d) => d.id === dsId)
  const gen = run?.honesty.generation ?? (meta ? (meta.is_real ? `REAL DATA · ${meta.name} (scaled)` : `SYNTHETIC · ${meta.name}`) : '…')
  const isReal = run?.honesty.generation_is_real ?? meta?.is_real
  const chip = (text: string, cls: string, title: string) => (
    <span title={title} className={`px-2 h-5 inline-flex items-center border text-[10px] tracking-[0.08em] uppercase ${cls}`}>{text}</span>
  )
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Data honesty labels">
      {chip(gen, isReal ? 'border-accent/60 text-accent' : 'border-warn/60 text-warn',
        isReal ? 'Real plant generation shape (Kaggle, India) — scaled to feeder PV capacity' : 'Synthetic generation profile — not measured data')}
      {chip('SYNTHETIC CONSUMER SCENARIO', 'border-line-strong text-ink-2', 'Consumer demand profiles are deterministic synthetic schedules')}
      {chip('BENCHMARK FEEDER · CIGRE MV', 'border-line-strong text-ink-2', 'CIGRE TF C6.04.02 MV benchmark — representative, not a real Indian feeder')}
      {chip('SIMULATED RESULTS', 'border-line-strong text-ink-2', 'All electrical values come from AC power-flow simulation')}
    </div>
  )
}

export function Shell() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-line bg-surface">
        <div className="flex items-center gap-4 px-4 h-11">
          <div className="flex items-center gap-2 shrink-0">
            <Activity size={16} className="text-accent" />
            <span className="font-semibold tracking-wide">GRIDTWIN</span>
            <span className="text-ink-3 text-[11px] hidden lg:inline">Build → Forecast → Stress → Detect → Heal → Verify</span>
          </div>
          <div className="ml-auto"><HonestyStrip /></div>
        </div>
        <nav className="flex gap-0 px-2 border-t border-line overflow-x-auto">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) => `px-3 h-8 inline-flex items-center text-[12px] border-b-2 whitespace-nowrap ${isActive ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 min-h-0"><Outlet /></main>
    </div>
  )
}
