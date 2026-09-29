import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { currentTheme, setTheme, type Theme } from '../app/theme'
import { api } from '../services/api'
import { useScenario } from '../app/ScenarioContext'

const ENGINEER = [
  ['/builder', 'Scenario builder'],
  ['/grid', 'Grid twin'],
  ['/lab', 'Live lab'],
  ['/actions', 'Heal & verify'],
  ['/forecast', 'Forecast'],
  ['/whatif', 'What-if'],
  ['/library', 'Library'],
] as const

/** Persistent data-honesty labels: what is real, synthetic, representative and simulated. */
export function HonestyStrip() {
  const { run, config } = useScenario()
  const cfgQ = useQuery({ queryKey: ['config'], queryFn: api.config })
  const ds = useQuery({ queryKey: ['datasets'], queryFn: api.datasets })
  const dsId = config?.dataset_id ?? cfgQ.data?.default_dataset
  const meta = ds.data?.find((d) => d.id === dsId)
  const isReal = run?.honesty.generation_is_real ?? meta?.is_real
  const gen = meta ? (isReal ? `Real data · ${meta.name} (scaled)` : `Synthetic · ${meta.name}`) : '…'
  const item = (dot: string, text: string, title: string) => (
    <span title={title} className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />{text}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3" aria-label="Data honesty labels">
      {item(isReal ? 'var(--color-ok)' : 'var(--color-warn)', gen, isReal ? 'Real plant generation shape (Kaggle, India) — scaled to feeder PV capacity' : 'Synthetic generation profile — not measured data')}
      {item('var(--color-warn)', 'Synthetic consumer scenario', 'Consumer demand profiles are deterministic synthetic schedules')}
      {item('var(--color-ink-3)', 'Benchmark feeder · CIGRE MV', 'CIGRE TF C6.04.02 MV benchmark — representative, not a real Indian feeder')}
      {item('var(--color-accent)', 'Simulated results', 'All electrical values come from AC power-flow simulation')}
    </div>
  )
}

export function ThemeToggle() {
  const [t, setT] = useState<Theme>(currentTheme())
  const next: Theme = t === 'dark' ? 'light' : 'dark'
  return (
    <button onClick={() => { setTheme(next); setT(next) }} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
      className="btn w-9 h-9 inline-flex items-center justify-center bg-surface text-ink-2">
      {t === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <rect x="1" y="1" width="20" height="20" rx="5" fill="var(--color-accent)" />
      <path d="M12.5 4.5 7 12h4l-1.5 5.5L15 10h-4z" fill="var(--color-on-accent)" />
    </svg>
  )
}

export function Shell() {
  const loc = useLocation()
  const engineer = loc.pathname !== '/'
  const tab = (to: string, label: string, active: boolean) => (
    <NavLink to={to} className={`h-14 inline-flex items-center px-1 text-[14px] border-b-2 ${active ? 'border-accent text-ink font-medium' : 'border-transparent text-ink-3 hover:text-ink'}`}>{label}</NavLink>
  )
  return (
    <div className="h-screen flex flex-col">
      <header className="bg-surface border-b border-line">
        <div className="flex items-center gap-6 px-5">
          <div className="flex items-center gap-2.5 shrink-0" title="Build → Forecast → Stress → Detect → Heal → Verify">
            <Mark />
            <span className="text-[16px] font-semibold tracking-tight">GridTwin</span>
          </div>
          <nav className="flex gap-5">
            {tab('/', 'Play', !engineer)}
            {tab(engineer ? loc.pathname : '/builder', 'Engineer view', engineer)}
          </nav>
          <div className="ml-auto flex items-center gap-4"><HonestyStrip /><ThemeToggle /></div>
        </div>
        {engineer && (
          <nav className="flex gap-1 px-4 pb-2 overflow-x-auto">
            {ENGINEER.map(([to, label]) => (
              <NavLink key={to} to={to}
                className={({ isActive }) => `px-3 h-8 inline-flex items-center text-[13px] rounded-md whitespace-nowrap ${isActive ? 'bg-accent-dim text-accent-ink font-medium' : 'text-ink-3 hover:text-ink'}`}>
                {label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1 min-h-0 overflow-auto"><Outlet /></main>
    </div>
  )
}
