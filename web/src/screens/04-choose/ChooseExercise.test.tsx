import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { todayKey } from '../../lib/day'
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

const HIDDEN = /Pendulum|Arm to the front|Rotate (in|out)/
const checkin = (pain: number) => sessionStorage.setItem('praxis.checkin', JSON.stringify({ pain }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test('All lists the three exercises of the 28 Sep lock in one row of cards; nothing hidden', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('radio', { name: 'All' }))
  // review 28 Sep: one row of three cards, not two headed groups with half the screen empty
  const groups = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
  expect(groups).toEqual(['Your exercises'])
  const row = screen.getByTestId('choose-cards')
  expect(row.className).toMatch(/grid-cols-3/)
  expect(row.className).toMatch(/max-lg:grid-cols-/) // wraps at narrower widths
  expect(within(row).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Arm out to the side', 'Waiter – cup', 'Nine-Hole Peg Test'])
  expect(screen.queryByRole('heading', { level: 2, name: 'Activities' })).not.toBeInTheDocument()
  expect(screen.getAllByText('Camera coached')).toHaveLength(2)
  expect(screen.getByText('Weekly')).toBeInTheDocument()
  expect(screen.getByText('Assessment')).toBeInTheDocument()
  expect(screen.queryByText('Demo only · you tick it')).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(HIDDEN)
  for (const gone of ['Arm out at an angle', 'Arm to the back', 'Block towers', 'Grip power', 'Wash cloth']) {
    expect(screen.queryByText(gone)).not.toBeInTheDocument()
  }
})

test('Today shows the default day in order then the weekly peg test, Arm out to the side preselected and one Begin setup', () => {
  renderChoose()
  expect(screen.getByRole('radio', { name: "Today's plan" })).toHaveAttribute('data-state', 'on')
  expect(screen.getByText('Today · 1')).toBeInTheDocument()
  expect(screen.getByText('Today · 2')).toBeInTheDocument()
  expect(screen.queryByText('Today · 3')).not.toBeInTheDocument()
  const cards = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
  expect(cards).toEqual(['Arm out to the side', 'Waiter – cup', 'Nine-Hole Peg Test'])
  const peg = screen.getByRole('button', { name: 'Select Nine-Hole Peg Test' })
  expect(within(peg).getByText('Weekly')).toBeInTheDocument()
  expect(within(peg).getByText('Assessment')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Demo only' })).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(HIDDEN)
  expect(screen.getByRole('button', { name: 'Select Arm out to the side' })).toHaveAttribute('aria-pressed', 'true')
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

test('no filter ever offers a hidden exercise, even with every piece of equipment ticked', () => {
  localStorage.setItem('praxis.equipment', JSON.stringify(['sheets', 'pegboard', 'cup', 'weight', 'table', 'chair']))
  renderChoose()
  for (const f of ["Today's plan", 'All', 'Equipment I have']) {
    fireEvent.click(screen.getByRole('radio', { name: f }))
    expect(document.body.textContent).not.toMatch(HIDDEN)
    expect(screen.queryByRole('button', { name: /Select (Pendulum|Arm to the front|Rotate)/ })).not.toBeInTheDocument()
  }
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
  expect(within(dialog).getByText(/Arm out to the side/)).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('radio', { name: 'About 10 minutes' }))
  expect(within(dialog).getByText(/Arm out to the side, then Waiter – cup/)).toBeInTheDocument()
  expect(dialog.textContent).not.toMatch(HIDDEN)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Use this pick' }))
  expect(screen.getByRole('button', { name: 'Select Arm out to the side' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Help me choose' }))
  const again = screen.getByRole('dialog', { name: 'Help me choose' })
  fireEvent.click(within(again).getByRole('radio', { name: '7 or more' }))
  expect(within(again).getByText(/rest day/i)).toBeInTheDocument()
  expect(within(again).getByRole('button', { name: 'Use this pick' })).toBeDisabled()
})

function storeDay(checkin: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  localStorage.setItem(
    'praxis.day',
    JSON.stringify({ date: todayKey(), checkin: { pain: 2, location: 'hand', energy: 'comfortable', minutes: 14, new_symptoms: false, side: 'right', tier: 'full', flagged: false, reasons: [], synced: true, at: '', ...checkin }, done: [], demosSeen: [], current: null, finished: [], stopped: null, ...extra }),
  )
}

test('the rest day says the therapist was told only when the service flagged it', () => {
  storeDay({ pain: 8, tier: 'rest', flagged: false, synced: false }, { stopped: 'rest' })
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
  renderChoose()
  expect(screen.queryByText(/your therapist has been told/i)).not.toBeInTheDocument()
  expect(screen.getByText(/hasn't been told yet/)).toBeInTheDocument()
  vi.unstubAllGlobals()
})

test('new or worse symptoms today: nothing to start from the list either', () => {
  storeDay({ pain: 1, new_symptoms: true, flagged: true }, { stopped: 'new_symptoms' })
  renderChoose()
  expect(screen.getByText(/new or worse/)).toBeInTheDocument()
  expect(screen.getByText(/Your therapist has been told\./)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Begin setup' })).not.toBeInTheDocument()
})

test('mid-day the next undone exercise is preselected, the day strip shows progress, and the saved side is used', () => {
  storeDay({}, { done: ['abduction'] })
  renderChoose()
  expect(screen.getByRole('button', { name: 'Select Waiter – cup' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('navigation', { name: "Today's plan" })).toHaveTextContent('Arm out to the side · done')
  expect(screen.getByTestId('day-title')).toHaveTextContent('Today · 2 of 2 · Waiter – cup')
  fireEvent.click(screen.getByRole('button', { name: 'Begin setup' }))
  expect(screen.getByText('AT /details/setup?exercise=cup&side=right')).toBeInTheDocument()
})
