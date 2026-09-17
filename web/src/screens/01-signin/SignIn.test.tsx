import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SignIn } from './SignIn'

function renderSignIn() {
  return render(
    <MemoryRouter initialEntries={['/signin']}>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

function mockLogin(ok: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 401, json: async () => (ok ? { ok: true, user: { username: 'rinky', name: 'Rinky', initial: 'R' }, token: 'tok' } : { ok: false, error: 'Wrong username or password.' }) })),
  )
}

test('asks for username and password only; no account creation', () => {
  renderSignIn()
  expect(screen.getByText(/Your practice, supported/)).toBeInTheDocument()
  expect(screen.getByLabelText('Username')).toBeInTheDocument()
  expect(screen.getByLabelText('Password')).toBeInTheDocument()
  expect(screen.queryByText(/Create account/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Cognito/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
})

test('a wrong password shows an error and stays on the page', async () => {
  mockLogin(false)
  renderSignIn()
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Rinky' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/Wrong username or password/)
  expect(screen.queryByText('HOME')).not.toBeInTheDocument()
  expect(sessionStorage.getItem('praxis.auth')).toBeNull()
})

test('a right password stores the session and opens Home; the password can be shown', async () => {
  mockLogin(true)
  renderSignIn()
  const pw = screen.getByLabelText('Password') as HTMLInputElement
  expect(pw.type).toBe('password')
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
  expect(pw.type).toBe('text')
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Rinky' } })
  fireEvent.change(pw, { target: { value: 'example-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  expect(JSON.parse(sessionStorage.getItem('praxis.auth') ?? '{}').user.name).toBe('Rinky')
})
