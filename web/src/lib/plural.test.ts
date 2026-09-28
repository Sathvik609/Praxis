import { countOf, plural } from './plural'

test('regular nouns take s, sibilant endings take es', () => {
  expect(plural(1, 'peg')).toBe('peg')
  expect(plural(0, 'peg')).toBe('pegs')
  expect(plural(2, 'peg')).toBe('pegs')
  expect(plural(1, 'reach')).toBe('reach')
  expect(plural(3, 'reach')).toBe('reaches')
  expect(plural(2, 'lift')).toBe('lifts')
  expect(plural(2, 'swing')).toBe('swings')
  expect(plural(2, 'session')).toBe('sessions')
  expect(plural(2, 'box')).toBe('boxes')
})

test('an explicit plural wins', () => {
  expect(plural(2, 'person', 'people')).toBe('people')
  expect(plural(1, 'person', 'people')).toBe('person')
})

test('countOf puts the number in front', () => {
  expect(countOf(1, 'peg')).toBe('1 peg')
  expect(countOf(1, 'reach')).toBe('1 reach')
  expect(countOf(0, 'reach')).toBe('0 reaches')
  expect(countOf(9, 'peg')).toBe('9 pegs')
})
