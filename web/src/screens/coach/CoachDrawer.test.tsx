import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PRESCRIPTION, mockApi } from '../../test/api-mock'
import { CoachDrawer } from './CoachDrawer'

const item = (id: string, name: string, order: number) => ({ id, name, dose: 'd', sets: 2, reps: 8, hold_s: 3, target_deg: 90, ceiling_deg: 90, tier: 'full', steps: [], order })
const PLAN = { pain: 0, tier: 'full', reason: '', minutes: 10, items: [item('abduction', 'Arm out to the side', 1), item('cup', 'Waiter – cup', 2)], weekly: [], rest_advice: null, therapist_flag: false }

beforeEach(() => localStorage.clear())

test('/details/coach is the library coach as a page: labelled rule-based, Begin setup opens the demo', async () => {
  mockApi({ '/api/plan': PLAN, '/api/calendar': { days: [], schedule: PRESCRIPTION.schedule, today: '2026-10-06' }, '/api/prescription': PRESCRIPTION, '/api/sessions': { sessions: [] } })
  render(
    <MemoryRouter initialEntries={['/details/coach']}>
      <Routes>
        <Route path="/details/coach" element={<CoachDrawer />} />
        <Route path="/details/demo" element={<div>DEMO</div>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('dialog', { name: 'Praxis coach' })).toBeInTheDocument()
  expect(screen.getAllByText('Rule-based coach · LLM agent pending').length).toBeGreaterThan(0)
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)/)
  fireEvent.click(await screen.findByRole('button', { name: 'Begin setup' }))
  expect(await screen.findByText('DEMO')).toBeInTheDocument()
})
