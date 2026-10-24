import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { readDay, todayKey, writeSide } from '../../lib/day'
import { PRESCRIPTION, mockApi } from '../../test/api-mock'
import { CheckIn } from './CheckIn'

const FULL = { tier: 'full', flagged: false, reasons: [], plan: {} }

function Where() {
  const l = useLocation()
  return <div>AT {l.pathname + l.search}</div>
}

function renderCheckIn(path = '/checkin') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/checkin" element={<CheckIn />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

function storeDay(checkin: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  localStorage.setItem(
    'praxis.day',
    JSON.stringify({ date: todayKey(), checkin: { pain: 2, location: 'hand', energy: 'comfortable', minutes: 14, new_symptoms: false, side: 'left', tier: 'full', flagged: false, reasons: [], synced: true, at: '', ...checkin }, done: [], demosSeen: [], current: null, finished: [], stopped: null, ...extra }),
  )
}

afterEach(() => vi.unstubAllGlobals())

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test('check-in collects pain, side, location, energy and time, shows stop rules, posts, then continues', async () => {
  const fetchMock = mockApi({ '/api/prescription': PRESCRIPTION, '/api/checkin': FULL })
  renderCheckIn()
  // 24 Oct: the tiers sit under the scale, and one line says what the chosen number does
  const meaning = await screen.findByRole('status')
  expect(meaning).toHaveTextContent('Tap the number closest to how you feel now.')
  expect(within(screen.getByRole('list', { name: 'What the number does' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['0–3 full session', '4–6 lighter session', '7–10 rest advised'])
  expect(document.body.textContent).not.toMatch(/Dr\./)
  expect(screen.getByText('Choose a pain number to continue')).toBeInTheDocument() // the hint is the FlowBar label
  fireEvent.click(screen.getByRole('radio', { name: '2' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Right arm' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Hand' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Tired' }))
  fireEvent.click(screen.getByRole('radio', { name: /Shorter/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to exercises' }))
  expect(await screen.findByText('AT /details/choose')).toBeInTheDocument()
  const stored = JSON.parse(sessionStorage.getItem('praxis.checkin') ?? '{}')
  expect(stored).toMatchObject({ pain: 2, location: 'hand', energy: 'tired', minutes: 7, new_symptoms: false })
  expect(readDay().checkin).toMatchObject({ side: 'right', synced: true })
  expect(localStorage.getItem('praxis.side')).toBe('right')
  const post = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/checkin'))!
  // the service contract is unchanged: new_symptoms is always sent, and is false (no box any more)
  expect(JSON.parse(String(post[1]?.body))).toMatchObject({ pain: 2, new_symptoms: false })
})

test('time you have sits in the main card, its two options side by side across the card', () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn()
  const time = screen.getByLabelText('Time you have')
  const main = screen.getByRole('radio', { name: '0' }).closest('.ui-card')!
  expect(main).toContainElement(time)
  expect(time).toHaveClass('w-full', '!flex-nowrap')
  expect(within(time).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Full session · about 10 min', 'Shorter · one exercise'])
  expect(document.querySelector('.ci-today')).toBeNull()
})

test('no "something new or worse" box and no push to talk: every answer is a tap', () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByText(/new or worse/i)).toBeNull()
  expect(screen.queryByRole('button', { name: /talk/i })).toBeNull()
  expect(screen.queryByText(/out loud/)).toBeNull()
  expect(screen.getByText(/A few quick taps/)).toBeInTheDocument()
})

test('continue is disabled with a hint until pain and side are chosen; the hint then goes away', () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn()
  const cont = screen.getByRole('button', { name: 'Continue to exercises' })
  expect(cont).toBeDisabled()
  expect(cont).toHaveAccessibleDescription('Choose a pain number to continue')
  fireEvent.click(screen.getByRole('radio', { name: '0' }))
  expect(cont).toBeDisabled()
  expect(cont).toHaveAccessibleDescription('Choose the arm you are practising to continue')
  fireEvent.click(screen.getByRole('radio', { name: 'Left arm' }))
  expect(cont).toBeEnabled()
  expect(screen.queryByText(/to continue$/)).not.toBeInTheDocument()
})

test('no body area is preselected: with pain, the patient chooses where (or Nowhere) before continuing', () => {
  writeSide('left')
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn()
  expect(screen.queryByLabelText('Where does it hurt?')).not.toBeInTheDocument() // asked only once there is pain
  fireEvent.click(screen.getByRole('radio', { name: '3' }))
  const where = screen.getByLabelText('Where does it hurt?')
  for (const r of within(where).getAllByRole('radio')) expect(r).not.toBeChecked()
  const cont = screen.getByRole('button', { name: 'Continue to exercises' })
  expect(cont).toBeDisabled()
  expect(cont).toHaveAccessibleDescription('Choose where it hurts, or Nowhere, to continue')
  fireEvent.click(within(where).getByRole('radio', { name: 'Nowhere' }))
  expect(cont).toBeEnabled()
})

test('pain 0 needs no body area and is saved as nowhere, never as a guessed area', async () => {
  writeSide('left')
  mockApi({ '/api/prescription': PRESCRIPTION, '/api/checkin': FULL })
  renderCheckIn()
  fireEvent.click(screen.getByRole('radio', { name: '0' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to exercises' }))
  expect(await screen.findByText('AT /details/choose')).toBeInTheDocument()
  expect(JSON.parse(sessionStorage.getItem('praxis.checkin') ?? '{}')).toMatchObject({ pain: 0, location: 'nowhere' })
})

test('a side chosen before is not asked again, and can be changed', () => {
  writeSide('left')
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn()
  expect(screen.queryByRole('radio', { name: 'Left arm' })).not.toBeInTheDocument()
  expect(screen.getByText('Left arm')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Change side' }))
  expect(screen.getByRole('radio', { name: 'Left arm' })).toBeInTheDocument()
})

test('offline: pain 8 is a rest day saved on this device, and the copy says the therapist has not been told', async () => {
  writeSide('left')
  mockApi({ '/api/prescription': PRESCRIPTION }) // /api/checkin unmocked → 404
  renderCheckIn()
  fireEvent.click(screen.getByRole('radio', { name: '8' }))
  expect(screen.getByRole('button', { name: 'Continue to exercises' })).toBeDisabled() // a choice is needed first
  fireEvent.click(screen.getByRole('radio', { name: 'Rest today' }))
  fireEvent.click(screen.getByRole('button', { name: 'Rest today' }))
  expect(await screen.findByRole('heading', { name: 'Rest today' })).toBeInTheDocument()
  expect(screen.getByText(/couldn't reach the service, so your therapist hasn't been told yet/)).toBeInTheDocument()
  expect(screen.queryByText('Your therapist has been told.')).not.toBeInTheDocument()
  expect(readDay().checkin?.synced).toBe(false)
})

test("today's check-in is reused: one tap continues; checking in again is offered", async () => {
  storeDay({ pain: 5, tier: 'gentle' })
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn()
  expect(screen.getByRole('heading', { name: 'You checked in today' })).toBeInTheDocument()
  expect(screen.getByText(/Pain 5/)).toBeInTheDocument()
  expect(screen.getByText('Gentle day')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Check in again' }))
  expect(screen.getByRole('button', { name: 'Continue to exercises' })).toBeInTheDocument()
})

test('demo hand-off with a valid check-in today goes straight to camera setup without asking again', () => {
  storeDay({})
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn('/checkin?next=cup&side=left')
  expect(screen.getByText('AT /details/setup?exercise=cup&side=left')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Before you start' })).not.toBeInTheDocument()
})

test('the hand-off passes rehearse=1 through to camera setup', () => {
  storeDay({ side: 'right' })
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn('/checkin?next=nhpt&side=right&rehearse=1')
  expect(screen.getByText('AT /details/setup?exercise=nhpt&side=right&rehearse=1')).toBeInTheDocument()
})

test('a stopped day never hands off to setup, even with next', () => {
  storeDay({ pain: 8, tier: 'rest' }, { stopped: 'rest' })
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn('/checkin?next=cup')
  expect(screen.getByRole('heading', { name: 'Rest today' })).toBeInTheDocument()
  expect(screen.queryByText(/AT \/details\/setup/)).not.toBeInTheDocument()
})

test('with next and no check-in: the form, "Continue to camera setup", back goes to the demonstration', async () => {
  writeSide('right')
  mockApi({ '/api/prescription': PRESCRIPTION, '/api/checkin': FULL })
  renderCheckIn('/checkin?next=nhpt&side=right')
  expect(screen.getByRole('heading', { name: 'Before you start' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Back to demonstration' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: '0' }))
  expect(screen.getByText('Ready for camera setup')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Continue to camera setup' }))
  expect(await screen.findByText('AT /details/setup?exercise=nhpt&side=right')).toBeInTheDocument()
})

test('back to demonstration keeps the exercise and side', () => {
  writeSide('left')
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn('/checkin?next=cup&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Back to demonstration' }))
  expect(screen.getByText('AT /details/demo?exercise=cup&side=left')).toBeInTheDocument()
})

test('a stopped day shows the stop, not the form; an unsent check-in is posted again on load', async () => {
  storeDay({ new_symptoms: true, tier: 'full', synced: false }, { stopped: 'new_symptoms' })
  const fetchMock = mockApi({ '/api/prescription': PRESCRIPTION, '/api/checkin': { tier: 'rest', flagged: true, reasons: [], plan: {} } })
  renderCheckIn()
  expect(screen.getByRole('heading', { name: 'No exercises today' })).toBeInTheDocument()
  expect(screen.getByText(/hasn't been told yet/)).toBeInTheDocument()
  expect(await screen.findByText('Your therapist has been told.')).toBeInTheDocument()
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/checkin'))).toBe(true)
})

test('the line under the scale says what the chosen pain number does', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn()
  const meaning = await screen.findByRole('status')
  fireEvent.click(screen.getByRole('radio', { name: '2' }))
  expect(meaning).toHaveTextContent('Pain 2: your full session today.')
  fireEvent.click(screen.getByRole('radio', { name: '5' }))
  expect(meaning).toHaveTextContent('Pain 5: a lighter session today, with fewer reps and a smaller lift.')
  expect(document.querySelector('.ci-key-on')).toHaveTextContent('4–6 lighter session')
  fireEvent.click(screen.getByRole('radio', { name: '8' }))
  // 24 Oct: at the stop level a careful warning offers rest or a lighter session
  const warn = screen.getByRole('alert')
  expect(warn).toHaveTextContent('Careful: pain 8 is high')
  expect(warn).toHaveTextContent('Your therapist is told either way.')
  expect(within(warn).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Rest today', 'Continue gently'])
})

test('pain at the stop level can continue gently: a lighter day, posted with continue_gently, and the therapist is told', async () => {
  writeSide('left')
  const fetchMock = mockApi({ '/api/prescription': PRESCRIPTION, '/api/checkin': { tier: 'gentle', flagged: true, reasons: [] } })
  renderCheckIn()
  fireEvent.click(screen.getByRole('radio', { name: '8' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Continue gently' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Shoulder' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to exercises' }))
  await waitFor(() => expect(readDay().checkin?.synced).toBe(true))
  const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/checkin'))!
  expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ pain: 8, continue_gently: true })
  expect(readDay().checkin?.tier).toBe('gentle')
  expect(readDay().stopped).toBeNull()
})
