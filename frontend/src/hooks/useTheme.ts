import { useEffect, useState } from 'react'
import { currentTheme, type Theme } from '../app/theme'

/** Current theme, updated whenever <html data-theme> changes (toggle in any view). */
export function useTheme(): Theme {
  const [t, setT] = useState<Theme>(currentTheme())
  useEffect(() => {
    const obs = new MutationObserver(() => setT(currentTheme()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return t
}
