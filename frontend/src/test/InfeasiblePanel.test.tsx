import { render, screen } from '@testing-library/react'
import { InfeasiblePanel } from '../features/actions/InfeasiblePanel'
import { evaluation } from './fixtures'

test('infeasible panel is absent when the backend reports a feasible result', () => {
  const { container } = render(<InfeasiblePanel evaluation={evaluation()} />)
  expect(container).toBeEmptyDOMElement()
  expect(screen.queryByText(/NO FEASIBLE SOLUTION/)).toBeNull()
})

test('infeasible panel shows backend failure reasons and minimum intervention', () => {
  render(<InfeasiblePanel evaluation={evaluation({
    status: 'NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS', recommended: null,
    explanation: 'NO FEASIBLE SOLUTION UNDER CURRENT CONSTRAINTS: all 8 available candidates were simulated.',
    infeasibility: {
      status: 'NO_FEASIBLE_SOLUTION_UNDER_CURRENT_CONSTRAINTS',
      candidates: [{ key: 'curtailment', name: 'Limited curtailment', available: true, first_failing_step: '10:00', n_failing_steps: 21,
        binding_constraint: { type: 'LINE_OVERLOAD', name: 'Line 1-2', value: 185.4, limit: 100 }, why: ['required curtailment up to 48.4% exceeds 20% cap (10:00–15:00, 21 steps)'] }],
      minimum_intervention: { problem_kind: 'surplus', applied: false, note: 'Reported only — never applied.', required_curtailment_pct: 35.938,
        required_curtailment_step: '12:15', required_curtailment_with: 'all_levers', cap_pct: 20 },
    },
  })} />)
  expect(screen.getByRole('alert', { name: 'No feasible solution' })).toBeInTheDocument()
  expect(screen.getByText('35.9%')).toBeInTheDocument()
  expect(screen.getByText(/exceeds 20% cap/)).toBeInTheDocument()
  expect(screen.getByText(/LINE_OVERLOAD · Line 1-2 185.400 vs 100.000/)).toBeInTheDocument()
  expect(screen.getByText('Reported only — never applied.')).toBeInTheDocument()
})
