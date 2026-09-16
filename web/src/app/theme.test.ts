import { applyTheme, getTheme } from './theme'

test('applyTheme sets data-theme and persists', () => {
  applyTheme('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(getTheme()).toBe('dark')
  applyTheme('light')
  expect(document.documentElement.dataset.theme).toBe('light')
})
