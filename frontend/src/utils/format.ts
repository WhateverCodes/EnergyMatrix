// Formatting only — no electrical computation happens in the frontend.
export const fmt = (x: number | null | undefined, nd = 3, unit = ''): string =>
  x === null || x === undefined || Number.isNaN(x) ? '—' : `${x.toFixed(nd)}${unit}`
export const pct = (x: number | null | undefined, nd = 1) => fmt(x, nd, '%')
export const pu = (x: number | null | undefined) => fmt(x, 3, ' pu')
export const mw = (x: number | null | undefined, nd = 2) => fmt(x, nd, ' MW')
export const mwh = (x: number | null | undefined, nd = 2) => fmt(x, nd, ' MWh')
export const signed = (x: number | null | undefined, nd = 3) =>
  x === null || x === undefined ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(nd)}`
export const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase())
