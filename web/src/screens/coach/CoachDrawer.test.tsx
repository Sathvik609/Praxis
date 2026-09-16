import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PRESCRIPTION, SESSION, mockApi } from '../../test/api-mock'
import { CoachDrawer } from './CoachDrawer'

test('coach drawer answers from the prescription and is labeled rule-based', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION, '/api/sessions': { sessions: [SESSION] } })
  render(<MemoryRouter><CoachDrawer /></MemoryRouter>)
  expect(await screen.findByText(/Rule-based coach · LLM agent pending/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /What is my program today/ }))
  expect(await screen.findByText(/2 slow arcs then 2 fast arcs/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Can I do more/ }))
  expect(await screen.findByText(/never goes above Level 2/)).toBeInTheDocument()
})
