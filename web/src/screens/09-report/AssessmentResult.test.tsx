import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AssessmentResult } from './AssessmentResult'

function Where() {
  const l = useLocation()
  return <div>AT {l.pathname + l.search}</div>
}

function renderWith(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/report', state }]}>
      <Routes>
        <Route path="/report" element={<AssessmentResult />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('shows total time, a splits chart and the timing-aid label', () => {
  renderWith({ kind: 'nhpt', hand: 'left', total_s: 41.23, splits_s: [4.1, 5.2], pegs: [{ peg: 1, hole: 4 }, { peg: 2, hole: 0 }], ended_early: false })
  expect(screen.getByText('41.2')).toBeInTheDocument()
  expect(screen.getByText(/timing aid/)).toBeInTheDocument()
  const chart = screen.getByRole('img', { name: /Per-peg splits/ })
  expect(chart.getAttribute('aria-label')).toMatch(/Peg 1 4.1 s/)
  expect(chart.getAttribute('aria-label')).toMatch(/Peg 2 5.2 s/)
})

test('nhpt that stopped early says how many pegs were seated', () => {
  renderWith({ kind: 'nhpt', hand: 'left', total_s: null, splits_s: [], pegs: [], pegs_done: 4, ended_early: true })
  expect(screen.getByText(/4 of 9 seated/)).toBeInTheDocument()
  expect(screen.getByText('Ended early')).toBeInTheDocument()
})

test('empty state is a card with a primary to run the peg test, through Choose with the peg test preselected', () => {
  // Choose → Demonstration still forces today's check-in before setup (Demonstration.test.tsx).
  renderWith(null)
  expect(screen.getByText(/No result/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Run the peg test' }))
  expect(screen.getByText('AT /details/choose?next=nhpt')).toBeInTheDocument()
})

test('cup variant shows verified and unverified counts and a hatched-unverified chart', () => {
  renderWith({
    kind: 'cup', side: 'left', arcs: 4, ended_early: false,
    reaches: [
      { rep: 1, from_dot: 0, to_dot: 1, reach_ms: 1200, verified: true, reason: null, arc: 1, phase: 'slow' },
      { rep: 2, from_dot: 1, to_dot: 2, reach_ms: 900, verified: false, reason: 'cup_occluded', arc: 1, phase: 'slow' },
    ],
  })
  expect(screen.getByText('verified reach')).toBeInTheDocument() // one verified: singular (review 28 Sep)
  expect(screen.getByText('unverified · hand covered cup or markers lost')).toBeInTheDocument()
  const chart = screen.getByRole('img', { name: /Reach time/ })
  expect(chart.getAttribute('aria-label')).toMatch(/2 0.9 s unverified/)
})

test('arm variant shows sets, verified reps, lean events and the ceiling as target', () => {
  renderWith({
    kind: 'arm', side: 'left', sets: 2, ended_early: false, lean_count: 2, hike_count: 0, ceiling_deg: 90,
    reps: [
      { set: 1, rep: 1, peak_deg: 91, hold_s: 3.1, verified: true, reason: null, lean: false, hike: false },
      { set: 1, rep: 2, peak_deg: 70, hold_s: 0.5, verified: false, reason: 'target_missed', lean: true, hike: false },
    ],
  })
  expect(screen.getByText('verified lift')).toBeInTheDocument() // one verified: singular
  expect(screen.getByText('unverified · missed target or short hold')).toBeInTheDocument()
  expect(screen.getByText(/lean events · 0 shoulder-hike events/)).toBeInTheDocument()
  const chart = screen.getByRole('img', { name: /Peak angle/ })
  expect(chart.getAttribute('aria-label')).toMatch(/2 70 ° unverified/)
  expect(screen.getByText(/target 90 °/)).toBeInTheDocument()
  // design review 21 Oct: less text; the stat labels already say why a lift is unverified
  expect(screen.getByText('Labels are set.lift.')).toBeInTheDocument()
  expect(screen.queryByText(/held too short; they are counted/)).toBeNull()
})

test('arm variant shows lifts above the ceiling beside the posture counts, in words', () => {
  renderWith({ kind: 'arm', side: 'left', sets: 2, ended_early: false, lean_count: 0, hike_count: 0, above_ceiling: 3, ceiling_deg: 90, reps: [] })
  expect(screen.getByText('lifts above 90°')).toBeInTheDocument()
  expect(screen.getByText('lifts above 90°').closest('div.min-w-0')).toHaveTextContent(/^3\s*lifts above 90°$/)
})
