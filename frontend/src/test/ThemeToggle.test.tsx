import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from '../components/Shell'

test('theme toggle switches data-theme and remembers the choice', async () => {
  document.documentElement.dataset.theme = 'dark'
  render(<ThemeToggle />)
  await userEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('gridtwin-theme')).toBe('light')
  await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
})
