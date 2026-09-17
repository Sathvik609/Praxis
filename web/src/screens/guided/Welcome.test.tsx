import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PLAN, PROFILE, mockApi } from '../../test/api-mock'
import { Welcome } from './Welcome'

function app() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<div>TODAY</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function mocks() {
  return mockApi({ '/api/profile': { ok: true, profile: PROFILE }, '/api/plan/today': PLAN })
}

test('one question at a time: the side comes first and nothing else is on screen yet', () => {
  mocks()
  app()
  expect(screen.getByText(/Which arm are we practising with/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Left arm' })).toBeInTheDocument()
  expect(screen.queryByLabelText(/In your own words/)).not.toBeInTheDocument()
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
})

test('the answer comes back as the patient’s own line and the next question follows', async () => {
  mocks()
  app()
  await userEvent.click(screen.getByRole('button', { name: 'Left arm' }))
  expect(screen.getByText('Left arm')).toBeInTheDocument()
  expect(screen.getByText(/What would you like to get back to/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Left arm' })).not.toBeInTheDocument()
})

test('a goal example fills the box and free text is accepted', async () => {
  mocks()
  app()
  await userEvent.click(screen.getByRole('button', { name: 'Left arm' }))
  await userEvent.click(screen.getByRole('button', { name: 'Playing badminton' }))
  const box = screen.getByLabelText(/In your own words/) as HTMLInputElement
  expect(box.value).toBe('Playing badminton')
  await userEvent.clear(box)
  await userEvent.type(box, 'Carry my grandson')
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByText('Carry my grandson')).toBeInTheDocument()
  expect(screen.getByText(/How is your shoulder right now/)).toBeInTheDocument()
})

test('pain is the 0–10 scale; saving posts the three answers and the coach reads back the plan', async () => {
  const fetchMock = mocks()
  app()
  await userEvent.click(screen.getByRole('button', { name: 'Right arm' }))
  await userEvent.click(screen.getByRole('button', { name: 'Playing badminton' }))
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  await userEvent.click(screen.getByRole('radio', { name: '3' }))
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))

  await waitFor(() => expect(screen.getByText('Pain 3 today: full program.')).toBeInTheDocument())
  expect(screen.getByText('Toward badminton: shoulder range, week 1')).toBeInTheDocument()
  const post = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/api/profile') && init?.method === 'POST')
  expect(post).toBeTruthy()
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({ side: 'right', goal: 'Playing badminton', pain: 3 })
  await userEvent.click(screen.getByRole('button', { name: /Start today/ }))
  expect(screen.getByText('TODAY')).toBeInTheDocument()
})

test('the onboarding never asks about the injury, a therapist code or a program, and shows no figure', async () => {
  mocks()
  app()
  const forbidden = /injury|injured|diagnos|stroke|therapist code|program code|clinician/i
  expect(document.body.textContent).not.toMatch(forbidden)
  expect(document.querySelector('canvas')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Left arm' }))
  expect(document.body.textContent).not.toMatch(forbidden)
  expect(document.querySelector('canvas')).toBeNull()
})

test('a failed save says so and keeps the answers', async () => {
  mockApi({ '/api/plan/today': PLAN })
  app()
  await userEvent.click(screen.getByRole('button', { name: 'Left arm' }))
  await userEvent.click(screen.getByRole('button', { name: 'Playing badminton' }))
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  await userEvent.click(screen.getByRole('radio', { name: '2' }))
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i)
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})
