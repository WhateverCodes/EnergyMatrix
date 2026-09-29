import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { useScenario } from '../app/ScenarioContext'

/** Loads the scenario library and, on first visit, starts from S1 (config normalized by the backend). */
export function useBootstrap() {
  const { config, setConfig, setLibraryId } = useScenario()
  const lib = useQuery({ queryKey: ['library'], queryFn: api.library })
  useEffect(() => {
    if (!config && lib.data?.length) {
      setConfig(lib.data[0].config as never)
      setLibraryId(lib.data[0].id)
    }
  }, [config, lib.data, setConfig, setLibraryId])
  return lib
}
