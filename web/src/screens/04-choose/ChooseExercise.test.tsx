import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { todayKey } from '../../lib/day'
import { ChooseExercise } from './ChooseExercise'

function Where() {
  const loc = useLocation()
  return <div>AT {loc.pathname + loc.search}</div>
}

function renderChoose(url = '/choose') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/choose" element={<ChooseExercise />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const HIDDEN = /Pendulum|Arm to the front|Rotate (in|out)/
// design v2 (6 Oct): the artifact's instructions-only cards are dropped tasks / not in the registry
const DROPPED = /Block towers|Grip power|Box and Block|View instructions/
const checkin = (pain: number) => sessionStorage.setItem('praxis.checkin', JSON.stringify({ pain }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test('library: header, no filters (24 Oct), one row of three cards in plain words, no clinician footer', () => {
  renderChoose()
  expect(screen.getByRole('heading', { level: 1, name: 'Choose your exercise' })).toBeInTheDocument()
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  expect(screen.queryByText(/All GRASP L2|Equipment I have/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Level changes need/)).not.toBeInTheDocument()
  const groups = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
  expect(groups).toEqual(['Your exercises'])
  const row = screen.getByTestId('choose-cards')
  expect(row.className).toMatch(/grid-cols-3/)
  expect(row.className).toMatch(/max-lg:grid-cols-/)
  expect(within(row).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Arm out to the side', 'Waiter – cup', 'Nine-Hole Peg Test'])
  const peg = screen.getByRole('button', { name: 'Select Nine-Hole Peg Test' })
  expect(within(peg).getByText('Hand · dexterity')).toBeInTheDocument()
  expect(within(peg).getByText('Weekly test')).toBeInTheDocument()
  expect(within(peg).getByText('You need a pegboard, 9 pegs and the printed marker sheet.')).toBeInTheDocument()
  expect(within(screen.getByRole('button', { name: 'Select Waiter – cup' })).getByText('Coordination')).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(HIDDEN)
  expect(document.body.textContent).not.toMatch(DROPPED)
  expect(screen.getByText('Exercise library')).toBeInTheDocument()
})

test('Assigned shows the default day in order then the weekly peg test, Arm out to the side preselected, one Start session per card', () => {
  renderChoose()
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Arm out to the side', 'Waiter – cup', 'Nine-Hole Peg Test'])
  expect(screen.getByRole('button', { name: 'Select Arm out to the side' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('button', { name: /^Start session: / }).map((b) => b.textContent)).toEqual(['Start session', 'Start session', 'Start session'])
  expect(screen.queryByRole('button', { name: 'Begin setup' })).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(DROPPED)
})

test('24 Oct: only the three launchable exercises are listed, no Coming soon placeholders', () => {
  renderChoose()
  expect(screen.queryByRole('region', { name: 'Coming soon' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Coming soon/)).not.toBeInTheDocument()
  for (const t of ['Shelf reach', 'Finger tapping', 'Wrist circles']) expect(screen.queryByText(t)).not.toBeInTheDocument()
})

test('each card’s Start session opens that exercise’s demonstration (D-FLOW), never camera setup', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('button', { name: 'Start session: Waiter – cup' }))
  expect(screen.getByText('AT /details/demo?exercise=cup&side=left')).toBeInTheDocument()
})

test('the two sheet tasks link their printable sheet (PDF); the arm task needs none', () => {
  renderChoose()
  expect(screen.getByRole('link', { name: 'Print the sheet: Waiter – cup' })).toHaveAttribute('href', '/sheets/cup_targets.pdf')
  expect(screen.getByRole('link', { name: 'Print the sheet: Nine-Hole Peg Test' })).toHaveAttribute('href', '/sheets/nhpt_board.pdf')
  expect(screen.queryByRole('link', { name: 'Print the sheet: Arm out to the side' })).not.toBeInTheDocument()
})

test('?next=nhpt (Home "Run the peg test") preselects and highlights the peg test', () => {
  renderChoose('/choose?next=nhpt')
  expect(screen.getByRole('button', { name: 'Select Nine-Hole Peg Test' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Select Arm out to the side' })).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(screen.getByRole('button', { name: 'Start session: Nine-Hole Peg Test' }))
  expect(screen.getByText('AT /details/demo?exercise=nhpt&side=left')).toBeInTheDocument()
})

test('?next= naming a hidden or unknown exercise falls back to the day’s next exercise', () => {
  renderChoose('/choose?next=pendulum')
  expect(screen.getByRole('button', { name: 'Select Arm out to the side' })).toHaveAttribute('aria-pressed', 'true')
  expect(document.body.textContent).not.toMatch(HIDDEN)
})

test('pain 4–6 at check-in shows the gentle doses on the cards', () => {
  checkin(5)
  renderChoose()
  expect(screen.getByText('2 sets of 6 · hold 2 s · up to 60°')).toBeInTheDocument()
  expect(screen.getByText(/60°/)).toBeInTheDocument()
  expect(screen.getByText('2 slow arcs only')).toBeInTheDocument()
})

test('full dose keeps the locked cup wording', () => {
  renderChoose()
  expect(screen.getByText('2 slow arcs, then 2 fast')).toBeInTheDocument()
})

test('pain 7 or more is a rest day: every card says Resting today, nothing starts, one way back home', () => {
  checkin(8)
  renderChoose()
  expect(screen.getByText(/Rest the arm today\. Sessions stay closed today\./)).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/until your pain is below 7/)
  expect(screen.getByText(/You can still watch the demos\./)).toBeInTheDocument()
  expect(screen.getAllByText('Resting today')).toHaveLength(3)
  expect(screen.queryByRole('button', { name: /^Start session/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }))
  expect(screen.getByText('AT /details')).toBeInTheDocument()
})

test('25 Oct team test: on a rest day each card still opens its demo, and the sheets can still be printed', () => {
  checkin(8)
  renderChoose()
  expect(screen.getAllByRole('button', { name: /^Watch the demo/ })).toHaveLength(3)
  // Settings › Equipment and sheets sends people here, so the sheets stay on a rest day too
  expect(screen.getByRole('link', { name: 'Print the sheet: Waiter – cup' })).toHaveAttribute('href', '/sheets/cup_targets.pdf')
  fireEvent.click(screen.getByRole('button', { name: 'Watch the demo: Waiter – cup' }))
  expect(screen.getByText(/^AT \/details\/demo\?exercise=cup/)).toBeInTheDocument()
})

test('rest day: "check in again" goes to the check-in', () => {
  checkin(8)
  renderChoose()
  expect(screen.getByText(/If your pain has eased,/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'check in again' }))
  expect(screen.getByText('AT /details/checkin')).toBeInTheDocument()
})

test('no hidden exercise or dropped task is ever offered', () => {
  renderChoose()
  expect(document.body.textContent).not.toMatch(HIDDEN)
  expect(document.body.textContent).not.toMatch(DROPPED)
  expect(screen.queryByRole('button', { name: /Select (Pendulum|Arm to the front|Rotate)/ })).not.toBeInTheDocument()
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

test('new or worse symptoms today: nothing to start from the list either; Check in again is offered', () => {
  storeDay({ pain: 1, new_symptoms: true, flagged: true }, { stopped: 'new_symptoms' })
  renderChoose()
  expect(screen.getByText(/new or worse/)).toBeInTheDocument()
  expect(screen.getByText(/Your therapist has been told\./)).toBeInTheDocument()
  expect(screen.getByText(/Ticked that by mistake\?/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check in again' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Start session/ })).not.toBeInTheDocument()
})

test('a stop rule that ended today’s practice offers no check-in again', () => {
  storeDay({}, { stopped: 'session' })
  renderChoose()
  expect(screen.getByText(/A stop rule ended today's practice/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /check in again/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Start session/ })).not.toBeInTheDocument()
})

test('mid-day the next undone exercise is preselected and the saved side is used', () => {
  storeDay({}, { done: ['abduction'] })
  renderChoose()
  expect(screen.getByRole('button', { name: 'Select Waiter – cup' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Start session: Waiter – cup' }))
  expect(screen.getByText('AT /details/demo?exercise=cup&side=right')).toBeInTheDocument()
})

test('ask the coach opens the library coach from Choose (ruling R1)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response))
  try {
    renderChoose()
    fireEvent.click(screen.getByRole('button', { name: 'Ask the coach' }))
    expect(await screen.findByRole('dialog', { name: 'Praxis coach' })).toBeInTheDocument()
    expect(screen.getAllByText('Rule-based coach · LLM agent pending').length).toBeGreaterThan(0)
    expect(await screen.findByText(/couldn't reach the service/)).toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})
