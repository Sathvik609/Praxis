import { ALL_EXERCISES, EXERCISES, REGIONS, angleTarget, exerciseById, exerciseOfSession, isHiddenExercise, isHiddenSession, sessionExerciseName, upcomingVisit } from './seed'

test('28 Sep lock: only Arm out to the side, Waiter – cup and the peg test are visible; the other four stay dormant', () => {
  expect(EXERCISES.map((e) => e.name)).toEqual(['Arm out to the side', 'Waiter – cup', 'Nine-Hole Peg Test'])
  expect(ALL_EXERCISES.filter((e) => e.hidden).map((e) => e.serviceId)).toEqual(['pendulum', 'flexion', 'external_rotation', 'internal_rotation'])
  for (const id of ['pendulum', 'arm', 'flexion', 'external_rotation', 'internal_rotation']) {
    expect(isHiddenExercise(id)).toBe(true)
    expect(exerciseById(id)).toBeUndefined()
  }
  for (const id of ['abduction', 'cup', 'nhpt']) expect(isHiddenExercise(id)).toBe(false)
})

test('the Home body map names no hidden exercise', () => {
  const names = Object.values(REGIONS).flatMap((r) => [...r.program.map((p) => p.name), r.primary.label, r.primary.to])
  expect(names.join(' ')).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)|exercise=(arm|pendulum)\b/)
  expect(REGIONS.lShoulder.primary.to).toBe('/details/demo?exercise=abduction&side=left')
})

test('a stored session resolves to its registry exercise from the service id, the summary or the mode', () => {
  expect(exerciseOfSession({ mode: 'arm', exercise: 'abduction' })?.name).toBe('Arm out to the side')
  // a hidden exercise's session resolves to nothing and is never named
  expect(exerciseOfSession({ mode: 'arm', summary: { exercise: 'pendulum' } })).toBeUndefined()
  expect(exerciseOfSession({ mode: 'arm', summary: { exercise_id: 'flexion' } })).toBeUndefined()
  expect(sessionExerciseName({ mode: 'arm', summary: { exercise_id: 'flexion', exercise_name: 'Arm to the front' } })).toBe('Session')
  expect(isHiddenSession({ mode: 'arm', exercise: 'pendulum' })).toBe(true)
  expect(isHiddenSession({ mode: 'arm', exercise: 'abduction' })).toBe(false)
  // since 28 Sep a bare arm session is Arm out to the side, as the service runs it
  expect(exerciseOfSession({ mode: 'arm' })?.name).toBe('Arm out to the side')
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
  expect(angleTarget({}, 'abduction')).toBe(90)
  expect(angleTarget({ target_deg: 60 }, 'abduction')).toBe(60)
  expect(angleTarget({ ceiling_deg: null }, 'abduction')).toBeUndefined()
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
