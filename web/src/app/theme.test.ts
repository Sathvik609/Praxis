import { applyTheme, getTheme } from './theme'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

test('applyTheme sets data-theme and persists', () => {
  applyTheme('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(document.documentElement.dataset.themePref).toBe('dark')
  expect(getTheme()).toBe('dark')
  applyTheme('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('praxis.theme')).toBe('light')
})

it('defaults to light and resolves auto without matchMedia', () => {
  localStorage.clear()
  expect(getTheme()).toBe('light')
  applyTheme('auto')
  expect(['light', 'dark']).toContain(document.documentElement.dataset.theme)
  expect(document.documentElement.dataset.themePref).toBe('auto')
  expect(getTheme()).toBe('auto')
})

test('auto follows the system colour scheme', () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-color-scheme: dark)', addEventListener: () => {} }))
  applyTheme('auto')
  expect(document.documentElement.dataset.theme).toBe('dark')
})

test('an unknown stored value falls back to light', () => {
  localStorage.setItem('praxis.theme', 'sepia')
  expect(getTheme()).toBe('light')
})
