import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CandidateTable } from '../features/actions/CandidateTable'
import { cand, metrics } from './fixtures'

test('renders every candidate with backend values verbatim and highlights the recommended one', async () => {
  const onApply = vi.fn()
  render(<CandidateTable onApply={onApply} candidates={[
    cand({ key: 'battery', name: 'Battery', recommended: true, rank: 1, J: 2.516, metrics: metrics({ max_line_pct: 99.8, battery_throughput_mwh: 1.24 }) }),
    cand({ key: 'curtailment', name: 'Limited curtailment', feasible: false, rank: 2, J: 94.41, metrics: metrics({ curtailed_pct: 12.3, curtailed_mwh: 9.29, n_violation_steps: 12 }) }),
    cand({ key: 'switching_battery', name: 'Switching + battery', available: false, feasible: false, rank: 3, J: null, metrics: null, unavailable_reason: 'battery unavailable' }),
  ]} />)
  const rec = screen.getByTestId('cand-battery')
  expect(within(rec).getByText('recommended')).toBeInTheDocument()
  expect(within(rec).getByText('99.8%')).toBeInTheDocument()
  expect(within(rec).getByText('2.52')).toBeInTheDocument()
  expect(within(rec).getByText('1.24')).toBeInTheDocument()
  const cur = screen.getByTestId('cand-curtailment')
  expect(within(cur).getByText('no')).toBeInTheDocument()
  expect(within(cur).getByText('12.3% · 9.29')).toBeInTheDocument()
  expect(within(cur).getByText('12/21')).toBeInTheDocument()
  const na = screen.getByTestId('cand-switching_battery')
  expect(within(na).getByText(/battery unavailable/)).toBeInTheDocument()
  expect(within(na).queryByText('Apply')).toBeNull()
  await userEvent.click(within(rec).getByText('Apply'))
  expect(onApply).toHaveBeenCalledWith('battery')
})
