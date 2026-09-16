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

test('cup variant shows verified and unverified counts', () => {
  renderWith({
    kind: 'cup', side: 'left', arcs: 4, ended_early: false,
    reaches: [
      { rep: 1, from_dot: 0, to_dot: 1, reach_ms: 1200, verified: true, reason: null, arc: 1, phase: 'slow' },
      { rep: 2, from_dot: 1, to_dot: 2, reach_ms: 900, verified: false, reason: 'cup_occluded', arc: 1, phase: 'slow' },
    ],
  })
  expect(screen.getByText(/1 verified/)).toBeInTheDocument()
  expect(screen.getByText(/1 unverified/)).toBeInTheDocument()
  expect(screen.getAllByTestId('reach')).toHaveLength(2)
})

test('arm variant shows sets, verified reps and lean events', () => {
  renderWith({
    kind: 'arm', side: 'left', sets: 2, ended_early: false, lean_count: 2, hike_count: 0, ceiling_deg: 90,
    reps: [
      { set: 1, rep: 1, peak_deg: 91, hold_s: 3.1, verified: true, reason: null, lean: false, hike: false },
      { set: 1, rep: 2, peak_deg: 70, hold_s: 0.5, verified: false, reason: 'target_missed', lean: true, hike: false },
    ],
  })
  expect(screen.getByText(/1 verified/)).toBeInTheDocument()
  expect(screen.getByText(/2 lean events/)).toBeInTheDocument()
  expect(screen.getAllByTestId('arm-rep')).toHaveLength(2)
})
