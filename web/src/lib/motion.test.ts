import { prefersReducedMotion } from './motion'

afterEach(() => {
  delete document.documentElement.dataset.motion
  vi.unstubAllGlobals()
})

it('honours the reduced-motion pref', () => {
  document.documentElement.dataset.motion = 'reduced'
  expect(prefersReducedMotion()).toBe(true)
})

it('is false without the pref when matchMedia is missing (jsdom)', () => {
  expect(prefersReducedMotion()).toBe(false)
})

it('honours the system setting', () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))
  expect(prefersReducedMotion()).toBe(true)
})
