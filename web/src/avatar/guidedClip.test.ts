import { CLIPS } from './clips'
import { REHAB_EXERCISES, guidedClip } from './guidedClip'

test('an exercise the avatar has no clip for falls back to the arm clip and no figure', () => {
  expect(guidedClip('kitesurfing')).toEqual({ clip: 'armFront' })
  expect(guidedClip(null)).toEqual({ clip: 'armFront' })
})

test('a clip the avatar knows is used in the guided figure mode', () => {
  expect(guidedClip('armFront')).toEqual({ clip: 'armFront', figure: 'skeleton' })
})

test('every exercise in the registry resolves to something the avatar can draw', () => {
  // Before the rehab clips land this is the arm clip; after they land it is the exercise's own
  // clip in skeleton mode. Both are valid, and neither needs this file to change.
  for (const id of REHAB_EXERCISES) {
    const { clip, figure } = guidedClip(id)
    const own = clip === id && figure === 'skeleton'
    expect(own || Object.keys(CLIPS).includes(clip)).toBe(true)
  }
})

test('the plan item’s own clip name wins over the exercise id', () => {
  expect(guidedClip('flexion', 'armFront').clip).toBe('armFront')
})
