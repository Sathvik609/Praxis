import { DAY_ORDER, WEEKLY, doseFor, readCheckinPain, tierFor } from './plan'
import { EXERCISES } from './seed'

test('pain tiers: 0–3 full, 4–6 gentle, 7 and up rest (mirrors services/session/praxis_session/plan.py)', () => {
  expect([0, 1, 2, 3].map((p) => tierFor(p))).toEqual(['full', 'full', 'full', 'full'])
  expect([4, 5, 6].map((p) => tierFor(p))).toEqual(['gentle', 'gentle', 'gentle'])
  expect([7, 8, 10].map((p) => tierFor(p))).toEqual(['rest', 'rest', 'rest'])
  expect(tierFor(null)).toBe('full')
  // a stricter therapist stop level wins; a looser one never moves rest above 7
  expect(tierFor(5, 5)).toBe('rest')
  expect(tierFor(7, 9)).toBe('rest')
})

test('default day order is Pendulum, Arm to the front, Arm out to the side, Waiter – cup; the peg test is weekly', () => {
  expect(DAY_ORDER).toEqual(['pendulum', 'arm', 'abduction', 'cup'])
  expect(WEEKLY).toEqual(['nhpt'])
})

test('the gentle dose is shown for exercises that have one', () => {
  const abduction = EXERCISES.find((e) => e.id === 'abduction')!
  expect(doseFor(abduction, 'full')).toMatch(/2 × 8/)
  expect(doseFor(abduction, 'gentle')).toMatch(/60°/)
  const nhpt = EXERCISES.find((e) => e.id === 'nhpt')!
  expect(doseFor(nhpt, 'gentle')).toBe(nhpt.dose)
})

test('the check-in pain is read from session storage and survives junk', () => {
  sessionStorage.setItem('praxis.checkin', JSON.stringify({ pain: 5 }))
  expect(readCheckinPain()).toBe(5)
  sessionStorage.setItem('praxis.checkin', '{nope')
  expect(readCheckinPain()).toBeNull()
  sessionStorage.removeItem('praxis.checkin')
  expect(readCheckinPain()).toBeNull()
})
