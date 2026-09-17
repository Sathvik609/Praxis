import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Nav } from './Nav'

function renderNav(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Nav program="Hospital GRASP, Level 2 · Left side" initial="A" />
    </MemoryRouter>,
  )
}

test('nav shows the four hubs and the program label', () => {
  renderNav()
  for (const t of ['Home', 'Exercises', 'Progress', 'Settings']) {
    expect(screen.getByRole('link', { name: t })).toBeInTheDocument()
  }
  expect(screen.getByText(/Program: Hospital GRASP/)).toBeInTheDocument()
})

test('the active hub is marked for assistive tech and the account circle links to settings', () => {
  renderNav('/progress')
  expect(screen.getByRole('link', { name: 'Progress' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  const account = screen.getByRole('link', { name: /Account and settings/ })
  expect(account).toHaveAttribute('href', '/settings')
  expect(account).toHaveTextContent('A')
})

test('the signed-in name shows on the account control', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Nav program="Hospital GRASP, Level 2 · Left side" initial="R" name="Rinky" />
    </MemoryRouter>,
  )
  const account = screen.getByRole('link', { name: /Rinky · account and settings/ })
  expect(account).toHaveTextContent('Rinky')
  expect(account).toHaveTextContent('R')
})
