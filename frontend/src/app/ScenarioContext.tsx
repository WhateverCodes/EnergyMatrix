import { createContext, useContext, useState, type ReactNode } from 'react'
import type { ApplyResult, Evaluation, RunResult, ScenarioConfig } from '../types/api'

interface Ctx {
  config: ScenarioConfig | null
  setConfig: (c: ScenarioConfig) => void
  libraryId: string | null
  setLibraryId: (id: string | null) => void
  run: RunResult | null
  setRun: (r: RunResult | null) => void
  evaluation: Evaluation | null
  setEvaluation: (e: Evaluation | null) => void
  applied: ApplyResult | null
  setApplied: (a: ApplyResult | null) => void
}

const ScenarioCtx = createContext<Ctx | null>(null)

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<ScenarioConfig | null>(null)
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [run, setRun] = useState<RunResult | null>(null)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [applied, setApplied] = useState<ApplyResult | null>(null)
  // Any config change invalidates downstream results: they were computed for a different scenario.
  const setConfig = (c: ScenarioConfig) => {
    setConfigState(c)
    setRun(null)
    setEvaluation(null)
    setApplied(null)
  }
  return (
    <ScenarioCtx.Provider value={{ config, setConfig, libraryId, setLibraryId, run, setRun, evaluation, setEvaluation, applied, setApplied }}>
      {children}
    </ScenarioCtx.Provider>
  )
}

export function useScenario() {
  const c = useContext(ScenarioCtx)
  if (!c) throw new Error('useScenario outside ScenarioProvider')
  return c
}
