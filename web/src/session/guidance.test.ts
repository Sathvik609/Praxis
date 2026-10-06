import { applyGuidance, readGuidance, writeGuidance } from './guidance'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.text
})

test('defaults: spoken cues off for now (captions always on), larger text on (the artifact renders at 18 px)', () => {
  expect(readGuidance()).toEqual({ spoken: false, larger: true })
})

test('an explicit stored larger:false is honoured', () => {
  localStorage.setItem('praxis.guidance', JSON.stringify({ spoken: false, larger: false }))
  expect(readGuidance()).toEqual({ spoken: false, larger: false })
  applyGuidance()
  expect(document.documentElement.dataset.text).toBeUndefined()
})

test('writes persist and read back; stale keys from older builds are dropped', () => {
  localStorage.setItem('praxis.guidance', JSON.stringify({ spoken: false, captions: false, helper: true }))
  expect(readGuidance()).toEqual({ spoken: false, larger: true })
  writeGuidance({ spoken: true, larger: true })
  expect(readGuidance()).toEqual({ spoken: true, larger: true })
})

test('larger text scales the root font; turning it off restores it', () => {
  applyGuidance({ spoken: true, larger: true })
  expect(document.documentElement.dataset.text).toBe('large')
  applyGuidance({ spoken: true, larger: false })
  expect(document.documentElement.dataset.text).toBeUndefined()
})

test('a broken stored value falls back to the defaults', () => {
  localStorage.setItem('praxis.guidance', '{nope')
  expect(readGuidance()).toEqual({ spoken: false, larger: true })
})
