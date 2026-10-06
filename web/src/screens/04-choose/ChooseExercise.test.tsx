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
const filters = () => within(screen.getByRole('radiogroup', { name: 'Show exercises' })).getAllByRole('radio')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test('library v2: the artifact header, filters Assigned / All GRASP L2 / Equipment I have, one row of three cards', () => {
  renderChoose()
  expect(screen.getByRole('heading', { level: 1, name: 'Choose your exercise' })).toBeInTheDocument()
  expect(filters().map((r) => r.textContent)).toEqual(['Assigned', 'All GRASP L2', 'Equipment I have'])
  expect(screen.getByRole('radio', { name: 'Assigned' })).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(screen.getByRole('radio', { name: 'All GRASP L2' }))
  expect(screen.getByRole('radio', { name: 'All GRASP L2' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radio', { name: 'Assigned' })).toHaveAttribute('aria-checked', 'false')
  const groups = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
  expect(groups).toEqual(['Your exercises'])
  const row = screen.getByTestId('choose-cards')
  expect(row.className).toMatch(/grid-cols-3/)
  expect(row.className).toMatch(/max-lg:grid-cols-/)
  expect(within(row).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Arm out to the side', 'Waiter – cup', 'Nine-Hole Peg Test'])
  // eyebrow + tag replace the Today · n / Weekly / Camera coached chips
  const peg = screen.getByRole('button', { name: 'Select Nine-Hole Peg Test' })
  expect(within(peg).getByText('Dexterity · timed')).toBeInTheDocument()
  expect(within(peg).getByText('Assessment')).toBeInTheDocument()
  expect(within(screen.getByRole('button', { name: 'Select Waiter – cup' })).getByText('Coordination')).toBeInTheDocument()
  expect(screen.queryByText('Today · 1')).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(HIDDEN)
  expect(document.body.textContent).not.toMatch(DROPPED)
  expect(screen.getByText('Exercise library')).toBeInTheDocument()
})

test('Assigned shows the default day in order then the weekly peg test, Arm out to the side preselected, one Start session per card', () => {
  renderChoose()
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Arm out to the side', 'Waiter – cup', 'Nine-Hole Peg Test'])
  expect(screen.getByRole('button', { name: 'Select Arm out to the side' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('button', { name: /^Start session: / }).map((b) => b.textContent)).toEqual(['Start session', 'Start session', 'Start session'])
  expect(screen.queryByRole('button', { name: 'Begin setup' })).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(DROPPED)
})

test('each card’s Start session opens that exercise’s demonstration (D-FLOW), never camera setup', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('button', { name: 'Start session: Waiter – cup' }))
  expect(screen.getByText('AT /details/demo?exercise=cup&side=left')).toBeInTheDocument()
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
  expect(screen.getByText('2 × 6 · hold 2 s · up to 60°')).toBeInTheDocument()
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
  expect(screen.getByText(/Rest the arm today\. Nothing here will start until your pain is below 7\./)).toBeInTheDocument()
  expect(screen.getByText(/You can still watch the demos\./)).toBeInTheDocument()
  expect(screen.getAllByText('Resting today')).toHaveLength(3)
  expect(screen.queryByRole('button', { name: /^Start session/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }))
  expect(screen.getByText('AT /details')).toBeInTheDocument()
})

test('rest day: "check in again" goes to the check-in', () => {
  checkin(8)
  renderChoose()
  expect(screen.getByText(/If your pain has eased,/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'check in again' }))
  expect(screen.getByText('AT /details/checkin')).toBeInTheDocument()
})

test('no filter ever offers a hidden exercise or a dropped task, even with every piece of equipment ticked', () => {
  localStorage.setItem('praxis.equipment', JSON.stringify(['sheets', 'pegboard', 'cup', 'weight', 'table', 'chair']))
  renderChoose()
  for (const f of ['Assigned', 'All GRASP L2', 'Equipment I have']) {
    fireEvent.click(screen.getByRole('radio', { name: f }))
    expect(document.body.textContent).not.toMatch(HIDDEN)
    expect(document.body.textContent).not.toMatch(DROPPED)
    expect(screen.queryByRole('button', { name: /Select (Pendulum|Arm to the front|Rotate)/ })).not.toBeInTheDocument()
  }
})

test('Equipment I have filters by the saved list', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('radio', { name: 'Equipment I have' }))
  expect(screen.getByRole('heading', { name: 'Waiter – cup' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Nine-Hole Peg Test' })).not.toBeInTheDocument()
})

test('Equipment I have with nothing ticked offers What I have, and ticking brings cards back', () => {
  localStorage.setItem('praxis.equipment', '[]')
  renderChoose()
  fireEvent.click(screen.getByRole('radio', { name: 'Equipment I have' }))
  expect(screen.getByText('Nothing matches the equipment you have yet.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'What I have' }))
  const dialog = screen.getByRole('dialog', { name: 'What I have' })
  expect(dialog.textContent).not.toMatch(/Building blocks|Hand gripper|Box and Block/)
  fireEvent.click(within(dialog).getByLabelText(/Pegboard/))
  fireEvent.click(within(dialog).getByLabelText(/Printed sheets/))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
  expect(screen.getByRole('heading', { name: 'Nine-Hole Peg Test' })).toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem('praxis.equipment') ?? '[]')).toEqual(['pegboard', 'sheets'])
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
