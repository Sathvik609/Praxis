import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { readDay, todayKey } from '../../lib/day'
import { ME, SESSION, mockApi } from '../../test/api-mock'
import { SessionReport } from './SessionReport'

function Where() {
  const l = useLocation()
  return <div>AT {l.pathname + l.search}</div>
}

function renderReport() {
  return render(
    <MemoryRouter initialEntries={['/report/abc']}>
      <Routes>
        <Route path="/report/:id" element={<SessionReport />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

function storeDay(extra: Record<string, unknown>) {
  localStorage.setItem(
    'praxis.day',
    JSON.stringify({ date: todayKey(), checkin: { pain: 2, location: 'hand', energy: 'comfortable', minutes: 14, new_symptoms: false, side: 'right', tier: 'full', flagged: false, reasons: [], synced: true, at: '' }, done: [], demosSeen: [], current: null, finished: [], stopped: null, ...extra }),
  )
}

const armSession = { ...SESSION, mode: 'arm', summary: { ...SESSION.summary, mode: 'arm' } }

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test('mid-day the report offers the next exercise as the one full-width primary, straight to its setup', async () => {
  storeDay({ current: 'abduction' })
  mockApi({ '/api/sessions/abc': armSession, '/api/patients/me': ME })
  renderReport()
  const next = await screen.findByRole('button', { name: 'Next: Waiter – cup' })
  expect(next.className).toMatch(/w-full/)
  expect(screen.getByTestId('day-title')).toHaveTextContent('Today · 1 of 2 done')
  expect(screen.getByRole('button', { name: 'Done — back to Home' }).className).not.toMatch(/bg-teal-fill/)
  expect(readDay().done).toEqual(['abduction'])
  fireEvent.click(next)
  expect(screen.getByText('AT /details/setup?exercise=cup&side=right')).toBeInTheDocument()
})

test('after the last exercise the report says done for today', async () => {
  storeDay({ done: ['abduction'], current: 'cup' })
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  fireEvent.click(await screen.findByRole('button', { name: 'Done for today' }))
  expect(screen.getByText('AT /details')).toBeInTheDocument()
})

test('a stop rule in the session ends the day on the report', async () => {
  storeDay({ current: 'cup' })
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, stopped: true } }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText(/today's practice stops here/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Next:/ })).not.toBeInTheDocument()
  expect(readDay().stopped).toBe('session')
})

test('an old report opened from history shows no day controls and keeps its own primary', async () => {
  storeDay({ done: ['abduction'] })
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  const done = await screen.findByRole('button', { name: 'Done — back to Home' })
  expect(done.className).toMatch(/bg-teal-fill/)
  expect(screen.queryByRole('button', { name: /^Next:/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: "Today's plan" })).not.toBeInTheDocument()
})
