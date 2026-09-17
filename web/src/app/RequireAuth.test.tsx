import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './RequireAuth'

beforeEach(() => sessionStorage.clear())

function app(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/signin" element={<div>SIGN IN</div>} />
        <Route path="/progress" element={<RequireAuth><div>PROGRESS</div></RequireAuth>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('a signed-out visitor is sent to sign-in', () => {
  app('/progress')
  expect(screen.getByText('SIGN IN')).toBeInTheDocument()
})

test('a signed-in visitor sees the page', () => {
  sessionStorage.setItem('praxis.auth', JSON.stringify({ token: 't', user: { username: 'rinky', name: 'Rinky', initial: 'R' } }))
  app('/progress')
  expect(screen.getByText('PROGRESS')).toBeInTheDocument()
})
