import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GLB_ACTIONS,
  actionFor,
  advanceGlbClock,
  boneFor,
  focusJointOf,
  isPropNode,
  pacedActionTime,
  parseAvatarMeta,
  propVisible,
  sourceLabel,
  stepAt,
  targetAt,
} from './glbActions'

const metaJson = JSON.parse(readFileSync(resolve(__dirname, '../../public/avatar/praxis_avatar.meta.json'), 'utf8'))

describe('actionFor: app clip / exercise names → GLB action', () => {
  test.each([
    ['pendulum', 'pendulum'],
    ['flexion', 'flexion'],
    ['armFront', 'flexion'],
    ['arm', 'flexion'],
    ['Arm to the front', 'flexion'],
    ['abduction', 'abduction'],
    ['Arm out to the side', 'abduction'],
    ['external_rotation', 'external_rotation'],
    ['Rotate out', 'external_rotation'],
    ['internal_rotation', 'internal_rotation'],
    ['Rotate in', 'internal_rotation'],
    ['cup', 'waiter_cup'],
    ['Waiter – cup', 'waiter_cup'],
    ['waiter_cup', 'waiter_cup'],
    ['nhpt', 'nhpt'],
    ['NHPT', 'nhpt'],
    ['idle', 'idle'],
    ['Home', 'idle'],
    ['block towers', 'idle'],
    ['', 'idle'],
  ])('%s → %s', (name, action) => {
    expect(actionFor(name)).toBe(action)
  })

  test('every action it can return exists in the shipped sidecar', () => {
    for (const a of GLB_ACTIONS) expect(metaJson.actions[a], a).toBeDefined()
  })
})

test('pacedActionTime without a pace curve maps rep progress linearly onto the rep window, clamped', () => {
  const a = (rep: [number, number]) => ({ rep })
  expect(pacedActionTime(a([2.2, 13.8]), 0)).toBeCloseTo(2.2)
  expect(pacedActionTime(a([2.2, 13.8]), 1)).toBeCloseTo(13.8)
  expect(pacedActionTime(a([2.2, 13.8]), 0.5)).toBeCloseTo(8)
  expect(pacedActionTime(a([0, 2]), -0.3)).toBe(0)
  expect(pacedActionTime(a([0, 2]), 1.7)).toBe(2)
})

test('pacedActionTime with a pace curve follows the service phases: lift by angle, hold by time, lower by angle', () => {
  const pace = { lift: [[0, 0], [0.5, 0.4], [1, 1]] as [number, number][], hold: [1, 1.4] as [number, number], lower: [[0, 2], [0.5, 1.8], [1, 1.4]] as [number, number][] }
  const a = { rep: [0, 2] as [number, number], pace }
  expect(pacedActionTime(a, 0)).toBeCloseTo(0)
  expect(pacedActionTime(a, 0.2)).toBeCloseTo(0.4) // half way up by angle
  expect(pacedActionTime(a, 0.4)).toBeCloseTo(1) // at the top
  expect(pacedActionTime(a, 0.6)).toBeCloseTo(1.2) // half the hold
  expect(pacedActionTime(a, 0.8)).toBeCloseTo(1.4) // end of hold
  expect(pacedActionTime(a, 0.9)).toBeCloseTo(1.8) // half way down by angle
  expect(pacedActionTime(a, 1)).toBeCloseTo(2)
  expect(pacedActionTime(a, 1.5)).toBeCloseTo(2)
})

describe('prop visibility follows meta.props exactly', () => {
  const nodes = ['prop_chair', 'prop_table', 'prop_sheet', 'prop_cup', 'prop_pegboard', ...Array.from({ length: 9 }, (_, i) => `prop_peg_${i + 1}`)]
  const shown = (props: string[]) => nodes.filter((n) => propVisible(n, props))

  test('no props for the standing exercises', () => {
    expect(shown([])).toEqual([])
  })
  test('table brings the chair; sheet and cup for Waiter – cup', () => {
    expect(shown(['table', 'sheet', 'cup']).sort()).toEqual(['prop_chair', 'prop_cup', 'prop_sheet', 'prop_table'])
    expect(shown(['chair'])).toEqual(['prop_chair']) // seated arm exercises: the chair alone
  })
  test('pegboard brings all nine pegs', () => {
    expect(shown(['table', 'pegboard']).sort()).toEqual(['prop_chair', 'prop_pegboard', ...Array.from({ length: 9 }, (_, i) => `prop_peg_${i + 1}`), 'prop_table'].sort())
  })
  test('only prop_* nodes are props; bones, anchors and the body are left alone', () => {
    expect(isPropNode('prop_peg_3')).toBe(true)
    for (const n of ['body', 'hips', 'upper_arm_L', 'anchor_dot_1', 'anchor_hole_9', 'praxis_rig']) expect(isPropNode(n), n).toBe(false)
  })
})

test('stepAt picks the latest step at or before t, and step 1 before the first key', () => {
  const steps = [
    { t: 0, step: 1, caption: 'lift' },
    { t: 1.067, step: 2, caption: 'hold' },
    { t: 1.317, step: 3, caption: 'lower' },
  ]
  expect(stepAt(steps, 0)).toEqual({ step: 1, caption: 'lift' })
  expect(stepAt(steps, 1.1)).toEqual({ step: 2, caption: 'hold' })
  expect(stepAt(steps, 2.5)).toEqual({ step: 3, caption: 'lower' })
  expect(stepAt([{ t: 0.5, step: 1, caption: 'x' }], 0.1)).toEqual({ step: 1, caption: 'x' })
  expect(stepAt([], 3)).toEqual({ step: 1, caption: '' })
})

test('targetAt: the amber ring shows the target being reached and hides once it has landed', () => {
  const targets = [
    { t: 2, kind: 'dot' as const, index: 2 },
    { t: 3, kind: 'dot' as const, index: 2, landed: true },
    { t: 4, kind: 'dot' as const, index: 3 },
  ]
  expect(targetAt(targets, 1)).toBeNull()
  expect(targetAt(targets, 2.5)).toEqual({ kind: 'dot', index: 2 })
  expect(targetAt(targets, 3.5)).toBeNull()
  expect(targetAt(targets, 4.1)).toEqual({ kind: 'dot', index: 3 })
  expect(targetAt([], 4)).toBeNull()
})

describe('bones for rig joints, mirrored for the right side', () => {
  test('left side reads the left bones', () => {
    expect(boneFor('lShoulder', 'left')).toBe('upper_arm_L')
    expect(boneFor('lElbow', 'left')).toBe('forearm_L')
    expect(boneFor('lWrist', 'left')).toBe('hand_L')
    expect(boneFor('lHand', 'left')).toBe('middle_L')
    expect(boneFor('rShoulder', 'left')).toBe('upper_arm_R')
    expect(boneFor('spine', 'left')).toBe('chest')
    expect(boneFor('head', 'left')).toBe('head')
  })
  test('the right side mirrors the model, so the practising right shoulder is the left bone', () => {
    expect(boneFor('rShoulder', 'right')).toBe('upper_arm_L')
    expect(boneFor('lShoulder', 'right')).toBe('upper_arm_R')
    expect(boneFor('hips', 'right')).toBe('hips')
  })
})

test('focusJointOf maps meta.focus_bone to the rig joint at the bone head, mirrored for the right', () => {
  expect(focusJointOf('upper_arm_L', 'left')).toBe('lShoulder')
  expect(focusJointOf('forearm_L', 'left')).toBe('lElbow')
  expect(focusJointOf('hand_L', 'left')).toBe('lWrist')
  expect(focusJointOf('upper_arm_L', 'right')).toBe('rShoulder')
  expect(focusJointOf(null, 'left')).toBeNull()
  expect(focusJointOf('tail', 'left')).toBeNull()
})

describe('advanceGlbClock', () => {
  const act = { duration: 4, loop: true }
  test('free-running: advances by dt × speed (the timeScale) and wraps a looping action', () => {
    const c = { time: 3.5, playing: true, speed: 0.5 }
    advanceGlbClock(c, 0.4, act)
    expect(c.time).toBeCloseTo(3.7)
    advanceGlbClock(c, 1, act)
    expect(c.time).toBeCloseTo(0.2)
  })
  test('paused does not move', () => {
    const c = { time: 1, playing: false, speed: 1 }
    advanceGlbClock(c, 0.5, act)
    expect(c.time).toBe(1)
  })
  test('a one-shot action clamps at its end and reports ended once', () => {
    const c = { time: 3.9, playing: true, speed: 1 }
    expect(advanceGlbClock(c, 0.5, { duration: 4, loop: false }).ended).toBe(true)
    expect(c.time).toBe(4)
    expect(c.playing).toBe(false)
    expect(advanceGlbClock(c, 0.5, { duration: 4, loop: false }).ended).toBe(false)
  })
  test('paced: eases toward the target time and settles on it', () => {
    const c = { time: 0, playing: true, speed: 1, target: 2 }
    advanceGlbClock(c, 0.05, act)
    expect(c.time).toBeGreaterThan(0)
    expect(c.time).toBeLessThan(2)
    for (let i = 0; i < 60; i++) advanceGlbClock(c, 0.05, act)
    expect(c.time).toBe(2)
  })
})

describe('parseAvatarMeta', () => {
  test('parses the shipped sidecar', () => {
    const m = parseAvatarMeta(metaJson)
    expect(Object.keys(m.actions).sort()).toEqual([...GLB_ACTIONS].sort())
    expect(m.actions.flexion.camera).toBe('side')
    expect(m.actions.waiter_cup.props).toEqual(['table', 'sheet', 'cup'])
    expect(m.actions.waiter_cup.rep).toEqual([2.2, 13.8])
  })
  test('tolerates extra fields (ceiling_deg / scaled_from_deg) and fills safe defaults', () => {
    const m = parseAvatarMeta({ fps: 30, extra: 1, actions: { flexion: { duration: 3, ceiling_deg: 90, scaled_from_deg: 158, camera: 'side' } } })
    expect(m.actions.flexion).toMatchObject({ duration: 3, loop: true, camera: 'side', props: [], rep: [0, 3], steps: [], targets: [], focus_bone: null, ceiling_deg: 90 })
  })
  test('rejects a sidecar without actions', () => {
    expect(() => parseAvatarMeta({ fps: 30 })).toThrow()
    expect(() => parseAvatarMeta(null)).toThrow()
  })
})

test('sourceLabel shortens the dataset name for the stage line', () => {
  expect(sourceLabel('UI-PRMD (University of Idaho Physical Rehabilitation Movements Data Set)')).toBe('motion from UI-PRMD')
  expect(sourceLabel('IntelliRehabDS (IRDS)')).toBe('motion from IntelliRehabDS')
  expect(sourceLabel('procedural')).toBe('procedural motion')
  expect(sourceLabel(undefined)).toBe('procedural motion')
})

test('sourceLabel says when the recorded rep was scaled down to the ceiling', () => {
  expect(sourceLabel('IntelliRehabDS (IRDS)', { ceiling_deg: 90, scaled_from_deg: 165.13 })).toBe('motion from IntelliRehabDS · scaled to 90°')
  expect(sourceLabel('UI-PRMD (x)', { ceiling_deg: 90, scaled_from_deg: 80 })).toBe('motion from UI-PRMD')
  expect(sourceLabel('procedural', {})).toBe('procedural motion')
  const m = parseAvatarMeta(metaJson)
  for (const a of ['flexion', 'abduction']) {
    if (m.actions[a].ceiling_deg !== undefined) expect(sourceLabel(m.actions[a].source, m.actions[a]), a).toMatch(/scaled to 90°/)
  }
})
