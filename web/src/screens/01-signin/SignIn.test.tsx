import { fireEvent, render, screen } from '@testing-library/react'
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

beforeEach(() => sessionStorage.clear())

test('sign-in and first-run profile lead to Home', () => {
  renderSignIn()
  expect(screen.getByText(/Your practice, supported/)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'First-time setup' })).toBeInTheDocument()
  expect(screen.getByText(/Camera, microphone and any cloud processing are asked for later/)).toBeInTheDocument()
  expect(screen.queryByText(/Cognito/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'Right' }))
  fireEvent.click(screen.getByRole('button', { name: /Save and open Home/ }))
  expect(screen.getByText('HOME')).toBeInTheDocument()
  expect(sessionStorage.getItem('praxis.profile')).toContain('"side":"right"')
})

test('sign in saves the profile and opens Home; the password is empty and can be shown', () => {
  renderSignIn()
  const pw = screen.getByLabelText('Password') as HTMLInputElement
  expect(pw.value).toBe('')
  expect(pw.type).toBe('password')
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
  expect(pw.type).toBe('text')
  fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
  expect(pw.type).toBe('password')
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(screen.getByText('HOME')).toBeInTheDocument()
  const profile = JSON.parse(sessionStorage.getItem('praxis.profile') ?? '{}')
  expect(profile.side).toBe('left')
  expect(profile.guidance.spoken).toBe(true)
})

test('the mode toggle switches between sign in and create account', () => {
  renderSignIn()
  fireEvent.click(screen.getByRole('radio', { name: 'Create account' }))
  expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
  expect(screen.getByLabelText('Your name')).toBeInTheDocument()
})
