import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ChooseExercise } from './ChooseExercise'

function Where() {
  const loc = useLocation()
  return <div>AT {loc.pathname + loc.search}</div>
}

function renderChoose() {
  return render(
    <MemoryRouter initialEntries={['/choose']}>
      <Routes>
        <Route path="/choose" element={<ChooseExercise />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const checkin = (pain: number) => sessionStorage.setItem('praxis.checkin', JSON.stringify({ pain }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test('All lists the locked set under three headings: Exercises, Activities, Demo only', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('radio', { name: 'All' }))
  const groups = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
  expect(groups).toEqual(['Exercises', 'Activities', 'Demo only'])
  const names = (label: string) => within(screen.getByRole('region', { name: label })).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
  expect(names('Exercises')).toEqual(['Pendulum', 'Arm to the front', 'Arm out to the side'])
  expect(names('Activities')).toEqual(['Waiter – cup', 'Nine-Hole Peg Test'])
  expect(names('Demo only')).toEqual(['Rotate out', 'Rotate in'])
  expect(screen.getAllByText('Camera coached')).toHaveLength(4)
  expect(screen.getByText('Weekly assessment')).toBeInTheDocument()
  expect(screen.getAllByText('Demo only · you tick it')).toHaveLength(2)
  for (const gone of ['Arm out at an angle', 'Arm to the back', 'Block towers', 'Grip power', 'Wash cloth']) {
    expect(screen.queryByText(gone)).not.toBeInTheDocument()
  }
})

test('Today shows the default day in order with Pendulum preselected and one Begin setup', () => {
  renderChoose()
  expect(screen.getByRole('radio', { name: "Today's plan" })).toHaveAttribute('data-state', 'on')
  expect(screen.getByText('Today · 1')).toBeInTheDocument()
  expect(screen.getByText('Today · 4')).toBeInTheDocument()
  const cards = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
  expect(cards).toEqual(['Pendulum', 'Arm to the front', 'Arm out to the side', 'Waiter – cup'])
  expect(screen.queryByRole('region', { name: 'Demo only' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Select Pendulum' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('button', { name: 'Begin setup' })).toHaveLength(1)
  expect(screen.getByText('Full dose')).toBeInTheDocument()
})

test('pain 4–6 at check-in shows the gentle doses and says why', () => {
  checkin(5)
  renderChoose()
  expect(screen.getByText('Gentle day')).toBeInTheDocument()
  expect(screen.getByText(/Pain 5 today: a gentle day/)).toBeInTheDocument()
  expect(screen.getByText('2 × 6 · hold 2 s · up to 60°')).toBeInTheDocument()
  expect(screen.getByText('2 slow arcs only')).toBeInTheDocument()
})

test('pain 7 or more is a rest day: nothing to start, one way back home', () => {
  checkin(8)
  renderChoose()
  expect(screen.getByText('Rest day')).toBeInTheDocument()
  expect(screen.getByText(/Pain 8 today: a rest day/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Begin setup' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }))
  expect(screen.getByText('AT /details')).toBeInTheDocument()
})

test('a demo-only exercise is watched and ticked, never set up for the camera', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('radio', { name: 'All' }))
  fireEvent.click(screen.getByRole('button', { name: 'Select Rotate out' }))
  expect(screen.queryByRole('button', { name: 'Begin setup' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Watch the demo' }))
  expect(screen.getByText('AT /details/demo?exercise=external_rotation&side=left')).toBeInTheDocument()
})

test('Begin setup carries the selected exercise to camera setup', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('button', { name: 'Select Arm out to the side' }))
  fireEvent.click(screen.getByRole('button', { name: 'Begin setup' }))
  expect(screen.getByText('AT /details/setup?exercise=abduction&side=left')).toBeInTheDocument()
})

test('Equipment I have filters by the saved list and What I have edits it', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('radio', { name: 'Equipment I have' }))
  expect(screen.getByRole('heading', { name: 'Waiter – cup' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Nine-Hole Peg Test' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'What I have' }))
  const dialog = screen.getByRole('dialog', { name: 'What I have' })
  fireEvent.click(within(dialog).getByLabelText(/Pegboard/))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
  expect(screen.getByRole('heading', { name: 'Nine-Hole Peg Test' })).toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem('praxis.equipment') ?? '[]')).toContain('pegboard')
})

test('Help me choose picks within today’s plan; pain 7 or more points to rest', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('button', { name: 'Help me choose' }))
  const dialog = screen.getByRole('dialog', { name: 'Help me choose' })
  fireEvent.click(within(dialog).getByRole('radio', { name: 'About 5 minutes' }))
  fireEvent.click(within(dialog).getByRole('radio', { name: 'None (0–3)' }))
  fireEvent.click(within(dialog).getByRole('radio', { name: 'No' }))
  expect(within(dialog).getByText(/Arm to the front/)).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Use this pick' }))
  expect(screen.getByRole('button', { name: 'Select Arm to the front' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Help me choose' }))
  const again = screen.getByRole('dialog', { name: 'Help me choose' })
  fireEvent.click(within(again).getByRole('radio', { name: '7 or more' }))
  expect(within(again).getByText(/rest day/i)).toBeInTheDocument()
  expect(within(again).getByRole('button', { name: 'Use this pick' })).toBeDisabled()
})
