import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PROFILE, mockApi } from '../test/api-mock'
import { RequireProfile } from './RequireProfile'

function app() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/welcome" element={<div>WELCOME</div>} />
        <Route path="/" element={<RequireProfile><div>TODAY</div></RequireProfile>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('a patient with no profile yet is sent to the welcome conversation', async () => {
  mockApi({ '/api/profile': { profile: null } })
  app()
  expect(await screen.findByText('WELCOME')).toBeInTheDocument()
})

test('a patient who has answered the three questions sees the screen', async () => {
  mockApi({ '/api/profile': { profile: PROFILE } })
  app()
  expect(await screen.findByText('TODAY')).toBeInTheDocument()
})

test('the screen still renders when the service cannot be reached, so it can say so itself', async () => {
  mockApi({})
  app()
  expect(await screen.findByText('TODAY')).toBeInTheDocument()
})
