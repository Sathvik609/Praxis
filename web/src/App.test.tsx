import { render } from '@testing-library/react'
import { createMemoryRouter } from 'react-router-dom'

vi.mock('./app/routes', () => ({ router: createMemoryRouter([{ path: '/', element: <p>home</p> }]) }))

import App from './App'

beforeEach(() => {
  localStorage.clear()
  const d = document.documentElement.dataset
  delete d.judge
  delete d.contrast
  delete d.text
})

test('boot applies theme, display prefs (judge view) and guidance before any route', () => {
  localStorage.setItem('praxis.theme.v2', 'light')
  localStorage.setItem('praxis.prefs', JSON.stringify({ judge: true, contrast: true }))
  localStorage.setItem('praxis.guidance', JSON.stringify({ larger: true }))
  render(<App />)
  const d = document.documentElement.dataset
  expect(d.theme).toBe('light')
  expect(d.judge).toBe('1')
  expect(d.contrast).toBe('high')
  expect(d.text).toBe('large')
})
