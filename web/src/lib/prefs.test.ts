import { applyPrefs, readPrefs, writePrefs } from './prefs'

beforeEach(() => {
  localStorage.clear()
  const d = document.documentElement.dataset
  delete d.contrast
  delete d.motion
  delete d.judge
})

it('applies contrast, motion and judge attributes', () => {
  applyPrefs({ contrast: true, motion: true, judge: true })
  expect(document.documentElement.dataset.contrast).toBe('high')
  expect(document.documentElement.dataset.motion).toBe('reduced')
  expect(document.documentElement.dataset.judge).toBe('1')
  applyPrefs({ contrast: false, motion: false, judge: false })
  expect(document.documentElement.dataset.contrast).toBeUndefined()
  expect(document.documentElement.dataset.motion).toBeUndefined()
  expect(document.documentElement.dataset.judge).toBeUndefined()
})

it('defaults when storage is empty or broken', () => {
  expect(readPrefs()).toEqual({ contrast: false, motion: false, judge: false })
  localStorage.setItem('praxis.prefs', '{bad')
  expect(readPrefs()).toEqual({ contrast: false, motion: false, judge: false })
})

it('keeps only the three known keys (an old captionsPanel is ignored) and ignores non-boolean values', () => {
  localStorage.setItem('praxis.prefs', JSON.stringify({ contrast: true, judge: 'yes', pushToTalk: true, clips: true, captionsPanel: false }))
  expect(readPrefs()).toEqual({ contrast: true, motion: false, judge: false })
})

it('writePrefs persists and applies', () => {
  writePrefs({ contrast: false, motion: true, judge: true })
  expect(readPrefs()).toEqual({ contrast: false, motion: true, judge: true })
  expect(document.documentElement.dataset.motion).toBe('reduced')
  expect(document.documentElement.dataset.judge).toBe('1')
})
