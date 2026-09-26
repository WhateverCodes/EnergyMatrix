import { render, screen } from '@testing-library/react'
import App from './App'

test('renders backend status line', () => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) })) as unknown as typeof fetch
  render(<App />)
  expect(screen.getByText(/GridTwin backend/)).toBeInTheDocument()
})
