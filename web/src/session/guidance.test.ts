import { applyGuidance, readGuidance, writeGuidance } from './guidance'

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.text
})

test('defaults: larger text off (pages fit a 1336 x 759 laptop window at the 16 px root)', () => {
  expect(readGuidance()).toEqual({ larger: false })
  applyGuidance()
  expect(document.documentElement.dataset.text).toBeUndefined()
})

test('an explicit stored larger:true still wins over the default', () => {
  localStorage.setItem('praxis.guidance', JSON.stringify({ larger: true }))
  expect(readGuidance()).toEqual({ larger: true })
  applyGuidance()
  expect(document.documentElement.dataset.text).toBe('large')
})

test('an explicit stored larger:false is honoured', () => {
  localStorage.setItem('praxis.guidance', JSON.stringify({ larger: false }))
  expect(readGuidance()).toEqual({ larger: false })
  applyGuidance()
  expect(document.documentElement.dataset.text).toBeUndefined()
})

test('writes persist and read back; stale keys from older builds are dropped', () => {
  localStorage.setItem('praxis.guidance', JSON.stringify({ spoken: false, captions: false, helper: true }))
  expect(readGuidance()).toEqual({ larger: false })
  writeGuidance({ larger: true })
  expect(readGuidance()).toEqual({ larger: true })
})

test('an older build\'s stored spoken:true is ignored (the coach is caption-only)', () => {
  localStorage.setItem('praxis.guidance', JSON.stringify({ spoken: true, larger: false }))
  expect(readGuidance()).toEqual({ larger: false })
})

test('larger text scales the root font; turning it off restores it', () => {
  applyGuidance({ larger: true })
  expect(document.documentElement.dataset.text).toBe('large')
  applyGuidance({ larger: false })
  expect(document.documentElement.dataset.text).toBeUndefined()
})

test('a broken stored value falls back to the defaults', () => {
  localStorage.setItem('praxis.guidance', '{nope')
  expect(readGuidance()).toEqual({ larger: false })
})
