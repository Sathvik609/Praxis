import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SignIn } from './SignIn'

test('sign-in and first-run profile lead to Home', () => {
  render(
    <MemoryRouter initialEntries={['/signin']}>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'First-time setup' })).toBeInTheDocument()
  expect(screen.getByText(/Camera, microphone and any cloud processing are asked for later/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Right' }))
  fireEvent.click(screen.getByRole('button', { name: /Save and open Home/ }))
  expect(screen.getByText('HOME')).toBeInTheDocument()
  expect(sessionStorage.getItem('praxis.profile')).toContain('"side":"right"')
})
