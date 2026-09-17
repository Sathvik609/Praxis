import type { GuidedArm } from './phase'
import { phaseLine, phaseOf, repProgress } from './phase'

const arm = (a: Partial<GuidedArm>) => ({ state: 'start_pose', hold_s: 3, hold_progress: 0, finished: false, ...a }) as GuidedArm

test('the phase the service sends wins', () => {
  expect(phaseOf(arm({ phase: 'lower', state: 'moving' }))).toBe('lower')
})

test('an older build without a phase still paces from the FSM state', () => {
  expect(phaseOf(arm({ state: 'moving' }))).toBe('lift')
  expect(phaseOf(arm({ state: 'hold' }))).toBe('hold')
  expect(phaseOf(arm({ state: 'return' }))).toBe('lower')
  expect(phaseOf(null)).toBe('start')
})

test('the hold line counts down and the finish line rests the arm', () => {
  expect(phaseLine(arm({ phase: 'hold', hold_s: 3, hold_progress: 0.34 }))).toBe('Hold it there… 2')
  expect(phaseLine(arm({ finished: true }))).toMatch(/Rest your arm/)
  expect(phaseLine(arm({ phase: 'lift' }))).toMatch(/Lift slowly/)
})

test('rep progress prefers the service value and falls back to the hold', () => {
  expect(repProgress(arm({ rep_progress: 0.5 }))).toBe(0.5)
  expect(repProgress(arm({ rep_progress: 4 }))).toBe(1)
  expect(repProgress(arm({ phase: 'hold', hold_progress: 0.25 }))).toBe(0.25)
  expect(repProgress(arm({ phase: 'lift' }))).toBe(0)
})
