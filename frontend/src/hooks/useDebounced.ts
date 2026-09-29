import { useEffect, useState } from 'react'

/** Returns `value` once it has stopped changing for `ms` milliseconds (one update per burst). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}
