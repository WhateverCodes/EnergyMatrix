import { render, screen } from '@testing-library/react'
import { HealthBar } from '../pages/PlayPage'

test('health bar shows the backend score with a text label (not colour alone)', () => {
  render(<HealthBar health={2} />)
  const meter = screen.getByRole('meter')
  expect(meter).toHaveAttribute('aria-valuenow', '2')
  expect(screen.getByText('Danger')).toBeInTheDocument()
  expect(screen.getByText('2/5')).toBeInTheDocument()
})
