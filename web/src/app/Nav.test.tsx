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

test('nav shows the five hubs, Calendar before Settings, and the program label', () => {
  renderNav()
  const hubs = screen.getAllByRole('link').filter((a) => a.closest('nav'))
  expect(hubs.map((a) => a.textContent)).toEqual(['Home', 'Exercises', 'Progress', 'Calendar', 'Settings'])
  expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/details/calendar')
  // five hubs fit 1280 px only because the header may shrink and the program label truncates
  expect(screen.getByRole('banner').className).toMatch(/\bmin-w-0\b/)
  expect(screen.getByText(/Program: Hospital GRASP/)).toBeInTheDocument()
})

test('the therapist view is reachable from the nav, clearly labelled', () => {
  renderNav()
  const link = screen.getByRole('link', { name: 'Therapist view' })
  expect(link).toHaveAttribute('href', '/therapist')
  expect(link.className).toMatch(/h-14/)
})

test('the active hub is marked for assistive tech and the account circle links to settings', () => {
  renderNav('/details/progress')
  expect(screen.getByRole('link', { name: 'Progress' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  const account = screen.getByRole('link', { name: /Account and settings/ })
  expect(account).toHaveAttribute('href', '/details/settings')
  expect(account).toHaveTextContent('A')
})

test('design v2 rail: logo is the Praxis mark named "Praxis · home", hubs keep visible labels', () => {
  renderNav()
  const header = screen.getByRole('banner')
  expect(header).toHaveClass('ui-nav')
  const logo = screen.getByRole('link', { name: 'Praxis · home' })
  expect(logo).toHaveClass('ui-logo')
  expect(logo).toHaveAttribute('href', '/details')
  expect(logo.querySelector('svg.ui-logo-mark')).not.toBeNull()
  const nav = screen.getByRole('navigation', { name: 'Hubs' })
  expect(nav).toHaveClass('ui-hubs')
  for (const name of ['Home', 'Exercises', 'Progress', 'Calendar', 'Settings']) {
    const hub = screen.getByRole('link', { name })
    expect(hub).toHaveClass('ui-hub')
    expect(hub).toHaveAttribute('title', name)
    // CSS hides the label visually on the desktop rail; the text stays in the DOM as the accessible name.
    expect(hub.querySelector('.ui-hub-label')).toHaveTextContent(name)
  }
  expect(screen.getByText(/Program: Hospital GRASP/)).toHaveClass('ui-program')
  const ther = screen.getByRole('link', { name: 'Therapist view' })
  expect(ther).toHaveClass('ui-ther')
  expect(ther.querySelector('.ui-ther-label')).toHaveTextContent('Therapist view')
  expect(screen.getByRole('link', { name: /Account and settings/ })).toHaveClass('ui-avatar')
})
