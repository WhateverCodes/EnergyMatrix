import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Moon, Sun, Zap } from 'lucide-react'
import { useState } from 'react'
import { currentTheme, setTheme, type Theme } from '../app/theme'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { useScenario } from '../app/ScenarioContext'

const ENGINEER = [
  ['/builder', 'Scenario Builder'],
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
  const chip = (text: string, bg: string, title: string) => (
    <span title={title} className="pixel chunk-sm px-1.5 h-7 inline-flex items-center text-[9px] text-ink0 whitespace-nowrap" style={{ background: bg, boxShadow: '2px 2px 0 #0F0E17' }}>{text}</span>
  )
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Data honesty labels">
      {chip(gen, isReal ? '#6EE7A8' : '#FFC857', isReal ? 'Real plant generation shape (Kaggle, India) — scaled to feeder PV capacity' : 'Synthetic generation profile — not measured data')}
      {chip('SYNTHETIC CONSUMERS', '#E8A87C', 'Consumer demand profiles are deterministic synthetic schedules')}
      {chip('BENCHMARK FEEDER · CIGRE MV', '#9D8CD6', 'CIGRE TF C6.04.02 MV benchmark — representative, not a real Indian feeder')}
      {chip('SIMULATED RESULTS', '#CFC8DE', 'All electrical values come from AC power-flow simulation')}
    </div>
  )
}

export function ThemeToggle() {
  const [t, setT] = useState<Theme>(currentTheme())
  const next: Theme = t === 'dark' ? 'light' : 'dark'
  return (
    <button onClick={() => { setTheme(next); setT(next) }} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
      className="btn bg-surface text-ink h-9 px-3 inline-flex items-center gap-2 text-[13px]">
      {t === 'dark' ? <Sun size={16} /> : <Moon size={16} />} {t === 'dark' ? 'LIGHT' : 'DARK'}
    </button>
  )
}

export function Shell() {
  const loc = useLocation()
  // ATLAS brings its own masthead (editorial style), so the chunky header is not shown there
  if (loc.pathname === '/atlas') return <main className="min-h-full"><Outlet /></main>
  const engineer = loc.pathname !== '/'
  const tab = (to: string, label: string, active: boolean) => (
    <NavLink to={to} className={`btn px-4 h-9 inline-flex items-center text-[14px] ${active ? 'bg-accent text-ink0' : 'bg-surface text-ink-2'}`}>{label}</NavLink>
  )
  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-surface border-b-3 border-ink0">
        <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <div className="flex items-center gap-2 shrink-0">
            <span className="chunk-sm bg-accent w-9 h-9 flex items-center justify-center"><Zap size={20} className="text-ink0" /></span>
            <div>
              <div className="text-[20px] leading-5 font-bold tracking-wider">GRIDTWIN</div>
              <div className="pixel text-[8px] text-ink-3">BUILD·FORECAST·STRESS·DETECT·HEAL·VERIFY</div>
            </div>
          </div>
          <div className="flex gap-2">
            {tab('/', 'PLAY', !engineer)}
            {tab('/atlas', 'ATLAS', false)}
            {tab(engineer ? loc.pathname : '/builder', 'ENGINEER VIEW', engineer)}
          </div>
          <div className="ml-auto flex items-center gap-3"><HonestyStrip /><ThemeToggle /></div>
        </div>
        {engineer && (
          <nav className="flex gap-1 px-3 pb-2 overflow-x-auto">
            {ENGINEER.map(([to, label]) => (
              <NavLink key={to} to={to}
                className={({ isActive }) => `px-3 h-8 inline-flex items-center text-[13px] rounded border-2 whitespace-nowrap ${isActive ? 'border-ink0 bg-surface-2 text-accent-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
                {label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1 min-h-0"><Outlet /></main>
    </div>
  )
}
