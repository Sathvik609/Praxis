import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AssessmentResult } from './AssessmentResult'

function renderWith(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/report', state }]}>
      <Routes>
        <Route path="/report" element={<AssessmentResult />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('shows total time, splits and the timing-aid label', () => {
  renderWith({ kind: 'nhpt', hand: 'left', total_s: 41.23, splits_s: [4.1, 5.2], pegs: [{ peg: 1, hole: 4 }, { peg: 2, hole: 0 }], ended_early: false })
  expect(screen.getByText('41.2')).toBeInTheDocument()
  expect(screen.getByText(/timing aid/)).toBeInTheDocument()
  expect(screen.getAllByTestId('split')).toHaveLength(2)
})

test('empty state without a result', () => {
  renderWith(null)
  expect(screen.getByText(/No result/)).toBeInTheDocument()
})
