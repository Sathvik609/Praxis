import { angleTarget, exerciseOfSession, sessionExerciseName, upcomingVisit } from './seed'

test('a stored session resolves to its registry exercise from the service id, the summary or the mode', () => {
  expect(exerciseOfSession({ mode: 'arm', exercise: 'abduction' })?.name).toBe('Arm out to the side')
  expect(exerciseOfSession({ mode: 'arm', summary: { exercise: 'pendulum' } })?.name).toBe('Pendulum')
  expect(exerciseOfSession({ mode: 'arm', summary: { exercise_id: 'flexion' } })?.name).toBe('Arm to the front')
  // before Sprint E arm mode only ran flexion, and the service still defaults to it
  expect(exerciseOfSession({ mode: 'arm' })?.name).toBe('Arm to the front')
  expect(exerciseOfSession({ mode: 'cup' })?.name).toBe('Waiter – cup')
  expect(exerciseOfSession({ mode: 'nhpt' })?.name).toBe('Nine-Hole Peg Test')
  expect(exerciseOfSession({ mode: 'mystery' })).toBeUndefined()
})

test('the service name wins when the summary carries one', () => {
  expect(sessionExerciseName({ mode: 'arm', summary: { exercise_id: 'abduction', exercise_name: 'Arm out to the side (v2)' } })).toBe('Arm out to the side (v2)')
  expect(sessionExerciseName({ mode: 'arm', exercise: 'abduction' })).toBe('Arm out to the side')
  expect(sessionExerciseName({ mode: 'mystery' })).toBe('mystery')
})

test('angle target: Pendulum has none; the summary target wins; a null ceiling means no line', () => {
  expect(angleTarget({}, 'pendulum')).toBeUndefined()
  expect(angleTarget({ target_deg: 90 }, 'pendulum')).toBeUndefined()
  expect(angleTarget({}, 'arm')).toBe(90)
  expect(angleTarget({ target_deg: 60 }, 'abduction')).toBe(60)
  expect(angleTarget({ ceiling_deg: null }, 'arm')).toBeUndefined()
})

test('a visit date in the past is not shown as the next visit', () => {
  const now = new Date(2026, 8, 25, 12) // 25 Sep 2026
  expect(upcomingVisit('Thu 18 Sep, 2:30 PM', now)).toBeNull()
  expect(upcomingVisit('Thu 25 Sep, 2:30 PM', now)).toBe('Thu 25 Sep, 2:30 PM') // later today still counts
  expect(upcomingVisit('Thu 2 Oct, 2:30 PM', now)).toBe('Thu 2 Oct, 2:30 PM')
  expect(upcomingVisit('Tue 12 Jan', new Date(2026, 11, 20))).toBe('Tue 12 Jan') // early next year
  expect(upcomingVisit('', now)).toBeNull()
  expect(upcomingVisit(undefined, now)).toBeNull()
})
