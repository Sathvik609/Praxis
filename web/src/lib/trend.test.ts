import { fmtV, trendDelta } from './trend'

const pt = (value: number, sample = false, date = '2026-09-01') => ({ date, value, sample })

test('lower is better: a falling time is "faster" and good', () => {
  expect(trendDelta([pt(45), pt(41.2)], 'down')).toEqual({ text: '3.8 s faster', tone: 'good' })
  expect(trendDelta([pt(41), pt(44.5)], 'down')).toEqual({ text: '3.5 s slower', tone: 'bad' })
})

test('higher is better: a rising angle is "higher" and good, never "down = bad" by itself', () => {
  expect(trendDelta([pt(76), pt(88)], 'up')).toEqual({ text: '12° higher', tone: 'good' })
  expect(trendDelta([pt(88), pt(80)], 'up')).toEqual({ text: '8° lower', tone: 'bad' })
})

test('no change is flat', () => {
  expect(trendDelta([pt(41.2), pt(41.2)], 'down')).toEqual({ text: 'No change', tone: 'flat' })
})

test('sample points never enter the delta; fewer than two live points is null', () => {
  expect(trendDelta([pt(68, true), pt(41.2)], 'down')).toBeNull()
  expect(trendDelta([pt(68, true), pt(45), pt(60, true), pt(41.2)], 'down')!.text).toBe('3.8 s faster')
  expect(trendDelta([], 'up')).toBeNull()
})

test('fmtV keeps integers whole and one decimal otherwise', () => {
  expect(fmtV(88)).toBe('88')
  expect(fmtV(41.25)).toBe('41.3')
  expect(fmtV(41.2)).toBe('41.2')
})
