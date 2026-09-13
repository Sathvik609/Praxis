import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Nav } from './Nav'

describe('Nav', () => {
  it('shows the six persistent destinations in order', () => {
    render(
      <MemoryRouter>
        <Nav />
      </MemoryRouter>,
    )
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      'Home',
      'Exercises',
      'Progress',
      'Reports',
      'Coach',
      'Settings',
    ])
  })

  it('gives every nav link a 56px minimum tap target', () => {
    render(
      <MemoryRouter>
        <Nav />
      </MemoryRouter>,
    )
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toMatch(/min-h-14/)
    }
  })
})
