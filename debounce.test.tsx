import { act, render, screen, fireEvent } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { useDebounced } from '../hooks/useDebounced'
import { LAB_DEBOUNCE_MS } from '../pages/LabPage'

function Probe({ onFire }: { onFire: (v: number) => void }) {
  const [v, setV] = useState(100)
  const d = useDebounced(v, LAB_DEBOUNCE_MS)
  useEffect(() => { onFire(d) }, [d, onFire])
  return <input aria-label="PV output" type="range" min={0} max={300} value={v} onChange={(e) => setV(Number(e.target.value))} />
}

test('slider debounce fires one request per burst of changes', () => {
  vi.useFakeTimers()
  const fire = vi.fn()
  render(<Probe onFire={fire} />)
  expect(fire).toHaveBeenCalledTimes(1) // initial value
  const s = screen.getByLabelText('PV output')
  for (const v of [110, 130, 150, 170, 200]) {
    fireEvent.change(s, { target: { value: String(v) } })
    act(() => { vi.advanceTimersByTime(100) }) // faster than the debounce window
  }
  expect(fire).toHaveBeenCalledTimes(1)
  act(() => { vi.advanceTimersByTime(LAB_DEBOUNCE_MS) })
  expect(fire).toHaveBeenCalledTimes(2)
  expect(fire).toHaveBeenLastCalledWith(200)
  vi.useRealTimers()
})
