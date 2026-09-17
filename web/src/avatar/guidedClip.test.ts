import { CLIPS } from './clips'
import { REHAB_EXERCISES, guidedClip } from './guidedClip'

test('an exercise the avatar has no clip for falls back to the arm clip and no figure', () => {
  expect(guidedClip('kitesurfing')).toEqual({ clip: 'armFront' })
  expect(guidedClip(null)).toEqual({ clip: 'armFront' })
})

test('a clip the avatar knows is used in the guided figure mode', () => {
  expect(guidedClip('armFront')).toEqual({ clip: 'armFront', figure: 'skeleton' })
})

test('every exercise in the registry resolves to a clip the avatar can draw', () => {
  for (const id of REHAB_EXERCISES) {
    const { clip } = guidedClip(id)
    expect(Object.keys(CLIPS)).toContain(clip)
  }
})

test('the plan item’s own clip name wins over the exercise id', () => {
  expect(guidedClip('flexion', 'armFront').clip).toBe('armFront')
})
