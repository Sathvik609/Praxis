import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Nav } from './Nav'

test('nav shows the four hubs and the program label', () => {
  render(
    <MemoryRouter>
      <Nav program="Hospital GRASP, Level 2 · Left side" initial="A" />
    </MemoryRouter>,
  )
  for (const t of ['Home', 'Exercises', 'Progress', 'Settings']) {
    expect(screen.getByRole('link', { name: t })).toBeInTheDocument()
  }
  expect(screen.getByText(/Program: Hospital GRASP/)).toBeInTheDocument()
})
