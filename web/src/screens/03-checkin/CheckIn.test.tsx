import { fireEvent, render, screen } from '@testing-library/react'
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

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test('check-in collects pain, side, location, energy, time and symptoms, shows stop rules, posts, then continues', async () => {
  const fetchMock = mockApi({ '/api/prescription': PRESCRIPTION, '/api/checkin': FULL })
  renderCheckIn()
  expect(await screen.findByText(/Pain at or above 7/)).toBeInTheDocument()
  expect(screen.getByText(/4–6 → gentle day/)).toBeInTheDocument()
  expect(screen.getByText(/Feeling is what you tell us, never read from your face/)).toBeInTheDocument()
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
  expect(JSON.parse(String(post[1]?.body))).toMatchObject({ pain: 2, new_symptoms: false })
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

test('a side chosen before is not asked again, and can be changed', () => {
  writeSide('left')
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn()
  expect(screen.queryByRole('radio', { name: 'Left arm' })).not.toBeInTheDocument()
  expect(screen.getByText(/Practising side: left arm/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Change side' }))
  expect(screen.getByRole('radio', { name: 'Left arm' })).toBeInTheDocument()
})

test('new-symptoms checkbox and push-to-talk are real controls', () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn()
  const box = screen.getByRole('checkbox', { name: /Something new or worse/ })
  fireEvent.click(box)
  expect(box).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Push to talk' }))
  expect(screen.getByText(/Voice input is not available/)).toBeInTheDocument()
})

test('new or worse symptoms stop the day right at check-in; "told" only when the service flagged it', async () => {
  writeSide('left')
  mockApi({ '/api/prescription': PRESCRIPTION, '/api/checkin': { tier: 'rest', flagged: true, reasons: ['new or worse symptoms'], plan: {} } })
  renderCheckIn()
  fireEvent.click(screen.getByRole('radio', { name: '1' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Something new or worse/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Tell my therapist and stop for today' }))
  expect(await screen.findByRole('heading', { name: 'No exercises today' })).toBeInTheDocument()
  expect(screen.getByText('Your therapist has been told.')).toBeInTheDocument()
  expect(screen.queryByText(/AT \/details\/choose/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Check in again' })).not.toBeInTheDocument()
  expect(readDay().stopped).toBe('new_symptoms')
  fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }))
  expect(screen.getByText('AT /details')).toBeInTheDocument()
})

test('offline: pain 8 is a rest day saved on this device, and the copy says the therapist has not been told', async () => {
  writeSide('left')
  mockApi({ '/api/prescription': PRESCRIPTION }) // /api/checkin unmocked → 404
  renderCheckIn()
  fireEvent.click(screen.getByRole('radio', { name: '8' }))
  fireEvent.click(screen.getByRole('button', { name: 'Rest today and tell my therapist' }))
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

test('reused check-in continues to the exercise the caller asked for (Home → peg test)', () => {
  storeDay({})
  mockApi({ '/api/prescription': PRESCRIPTION })
  renderCheckIn('/checkin?next=nhpt')
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Nine-Hole Peg Test' }))
  expect(screen.getByText('AT /details/setup?exercise=nhpt&side=left')).toBeInTheDocument()
})

test('a fresh check-in for the peg test goes straight to its camera setup', async () => {
  writeSide('right')
  mockApi({ '/api/prescription': PRESCRIPTION, '/api/checkin': FULL })
  renderCheckIn('/checkin?next=nhpt')
  fireEvent.click(screen.getByRole('radio', { name: '0' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Nine-Hole Peg Test' }))
  expect(await screen.findByText('AT /details/setup?exercise=nhpt&side=right')).toBeInTheDocument()
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
