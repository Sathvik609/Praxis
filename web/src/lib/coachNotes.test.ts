import { noteText } from './coachNotes'

test('legacy "action: reason" notes read as sentences for a clinician', () => {
  expect(noteText('progress: two clean slow arcs, mean reach 1.2 s, 0 unverified')).toBe('Progression offered: two clean slow arcs, mean reach 1.2 s, 0 unverified.')
  expect(noteText('progress: patient accepted progression')).toBe('Patient accepted the faster arcs.')
  expect(noteText('correct: trunk lean in 2 of 16 lifts')).toBe('Correction: trunk lean in 2 of 16 lifts.')
  expect(noteText('rest: behavioural exertion high: reps getting slower')).toBe('Rest suggested: behavioural exertion high: reps getting slower.')
  expect(noteText('stop: pain 7/10 during Arm out to the side.')).toBe('Session stopped: pain 7/10 during Arm out to the side.')
})

test('a note already written as a sentence (service since 10 Oct) passes through unchanged', () => {
  expect(noteText('Patient accepted the faster arcs.')).toBe('Patient accepted the faster arcs.')
  expect(noteText('Posture correction: trunk lean 14°.')).toBe('Posture correction: trunk lean 14°.')
})
