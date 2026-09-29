export type Theme = 'light' | 'dark'
const KEY = 'gridtwin-theme'

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

/** Apply and remember the viewer's choice (per-browser convenience; storage may be unavailable). */
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(KEY, t) } catch { /* private mode etc. */ }
}
