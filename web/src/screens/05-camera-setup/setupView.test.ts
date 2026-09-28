import { ALL_EXERCISES } from '../../lib/seed'
import { placementCopy } from './SetupDiagram'
import { resolveChecks, setupViewFor } from './setupView'

/** The side view serves Pendulum and Arm to the front, hidden on 28 Sep. No screen can reach it
 *  while they stay hidden; these unit tests keep the dormant path working so the decision stays
 *  reversible. */
const dormant = (id: string) => ALL_EXERCISES.find((e) => e.id === id)!

test('the hidden lifts would still be set up from the side, Arm out to the side from the front', () => {
  expect(setupViewFor(dormant('pendulum'))).toBe('side')
  expect(setupViewFor(dormant('arm'))).toBe('side')
  expect(setupViewFor(dormant('abduction'))).toBe('front')
  expect(setupViewFor(dormant('cup'))).toBe('table')
})

test('side view: pose rows, never sheet rows, and the self-checks must be ticked', () => {
  const { rows, ready } = resolveChecks('side', 'right', false, { checks: [], all_required_pass: true }, {})
  expect(rows.map((r) => r.label)).toEqual(['Camera permission', 'One person in view', 'Your right side faces the camera', 'Hip in view', 'Shoulder, elbow and wrist in view', 'Lighting'])
  expect(rows.filter((r) => r.source === 'self')).toHaveLength(3)
  expect(ready).toBe(false)
  const ticked = resolveChecks('side', 'right', false, { checks: [], all_required_pass: true }, { side_view: true, hip_in_view: true, arm_in_view: true })
  expect(ticked.ready).toBe(true)
})

test('side view: once the service decides a pose row, the camera wins over the tick', () => {
  const svc = { checks: [{ id: 'side_view', label: 'x', status: 'check' as const, hint: null }], all_required_pass: true }
  const r = resolveChecks('side', 'left', false, svc, { side_view: true, hip_in_view: true, arm_in_view: true })
  expect(r.rows.find((x) => x.id === 'side_view')).toMatchObject({ status: 'check', source: 'camera', hint: 'Turn so your left shoulder is closest to the camera.' })
  expect(r.ready).toBe(false)
})

test('the standing pendulum copy asks for a low camera beside a table', () => {
  const svc = { checks: [{ id: 'person', label: 'x', status: 'check' as const, hint: null }], all_required_pass: false }
  const rows = resolveChecks('side', 'left', true, svc, {}).rows
  expect(rows.find((r) => r.id === 'person')?.hint).toMatch(/^Stand/)
  expect(placementCopy('side', 'left', true).heading).toBe('Place the camera low, beside you')
  expect(placementCopy('side', 'left', false).heading).toBe('Place the camera beside you')
})
