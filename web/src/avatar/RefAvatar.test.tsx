import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))
vi.mock('./AvatarPanel', () => ({
  AvatarPanel: (p: Record<string, unknown>) => {
    h.props.push(p)
    return <div data-testid="avatar" />
  },
}))

import { RefAvatar, demoRequested, refActionTime, refMode } from './RefAvatar'

const ev = (type: string, t: number, extra: Record<string, unknown> = {}) => ({ type, t, id: Math.round(t * 10), ...extra })
const frame = () => ({ type: 'frame', t: 10, id: 1, arm: { state: 'start_pose' } }) as never

test('refMode follows real events', () => {
  expect(refMode([], frame(), { open: true }, 10)).toBe('idle')
  expect(refMode([ev('perception_lost', 9)], frame(), { open: false }, 10)).toBe('dim-lost')
  expect(refMode([ev('perception_lost', 8), ev('perception_regained', 9)], frame(), { open: false }, 10)).toBe('run')
  expect(refMode([ev('compensation_lean', 8)], frame(), { open: false }, 10)).toBe('dim-cue') // < 4 s
  expect(refMode([ev('compensation_lean', 5)], frame(), { open: false }, 10)).toBe('run') // ≥ 4 s
  expect(refMode([ev('coach', 9.5, { action: 'correct' })], frame(), { open: false }, 10)).toBe('dim-cue')
  expect(refMode([ev('coach', 9.5, { action: 'instruct' })], frame(), { open: false }, 10)).toBe('run')
})

test('the figure rests once both sets are done', () => {
  expect(refMode([ev('arm_complete', 9, { sets: 2, reps: 16 })], frame(), { open: false }, 10)).toBe('idle')
})

test('demonstration is triggered by the coach avatar clip', () => {
  expect(demoRequested([ev('coach', 3, { ui: { avatar_clip: 'arm_lift' } })])).toBe(3)
  expect(demoRequested([ev('coach', 3, { ui: {} })])).toBeNull()
  expect(demoRequested([ev('coach', 3, { ui: { avatar_clip: 'abduction' } }), ev('coach', 5, { ui: {} })])).toBe(3)
  expect(demoRequested([])).toBeNull()
})

test('footer shows the Lift / Hold / Lower tempo and the reference reps ticks, as in the artifact', () => {
  render(<RefAvatar clip="abduction" mode="run" demoAt={null} holdS={3} side="left" />)
  const tempo = screen.getByRole('list', { name: 'Rep tempo' })
  expect(tempo).toHaveTextContent('Lift 3 s')
  expect(tempo).toHaveTextContent('Hold 3 s')
  expect(tempo).toHaveTextContent('Lower 3 s')
  expect(screen.getByText('Reference reps')).toBeInTheDocument()
  expect(screen.getByLabelText('0 of 8 reference reps').children).toHaveLength(8)
})

test('hold time comes from the prescription (frame), lift and lower stay 3 s', () => {
  render(<RefAvatar clip="abduction" mode="run" demoAt={null} holdS={2} side="left" repsPerSet={6} />)
  expect(screen.getByRole('list', { name: 'Rep tempo' })).toHaveTextContent('Hold 2 s')
  expect(screen.getByLabelText('0 of 6 reference reps').children).toHaveLength(6)
})

test('mode comes only from props: tag text per mode, no toggles of its own', () => {
  const { rerender } = render(<RefAvatar clip="abduction" mode="idle" demoAt={null} holdS={3} side="left" />)
  expect(screen.getByText('Reference · ready')).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
  rerender(<RefAvatar clip="abduction" mode="dim-lost" demoAt={null} holdS={3} side="left" />)
  expect(screen.getByText('Reference · waiting for you')).toBeInTheDocument()
  expect(screen.getByLabelText('Reference figure')).toHaveClass('av-dim')
  rerender(<RefAvatar clip="abduction" mode="dim-cue" demoAt={null} holdS={3} side="left" />)
  expect(screen.getByText('Reference · listen to the coach')).toBeInTheDocument()
})

test('before the coach asks for a demonstration the figure waits; the request starts it', () => {
  const { rerender } = render(<RefAvatar clip="abduction" mode="run" demoAt={null} holdS={3} side="left" />)
  expect(screen.getByText('Reference · ready')).toBeInTheDocument()
  rerender(<RefAvatar clip="abduction" mode="run" demoAt={4} holdS={3} side="left" />)
  expect(screen.getByText('Reference · demonstration')).toBeInTheDocument()
  expect(screen.getByText('Watch once, then follow')).toBeInTheDocument()
})

test('the stage is the bare figure, mirrored to face the patient, never paced by the patient', () => {
  h.props = []
  render(<RefAvatar clip="abduction" mode="run" demoAt={2} holdS={3} side="right" />)
  const p = h.props[h.props.length - 1]
  expect(p).toMatchObject({ bare: true, clip: 'abduction', camera: 'front', side: 'left' })
  expect(p.paced).toBeUndefined()
  expect(p.jointList).toEqual(['lShoulder', 'lElbow', 'lWrist', 'rShoulder', 'rElbow', 'rWrist'])
})

const am = { rep: [0, 8] as [number, number], pace: { lift: [[0, 0], [0.5, 1], [1, 2]] as [number, number][], hold: [2, 5] as [number, number], lower: [[0, 8], [1, 5]] as [number, number][], peak_deg: 90, rest_deg: 0 } }

test('the figure tops out at the prescribed target: 60° on a gentle day, the recorded peak otherwise', () => {
  expect(refActionTime(am, 1, false)).toBe(2) // top of the recorded lift (90°)
  expect(refActionTime(am, 1, false, 90)).toBe(2)
  expect(refActionTime(am, 1, false, 60)).toBeCloseTo(1 + 1 / 3) // 60 / 90 of the way up
  expect(refActionTime(am, 0, false, 60)).toBe(0)
  // lowering from the 60° top joins the way down at the same elevation
  expect(refActionTime(am, 1, true, 60)).toBeCloseTo(8 - 3 * (2 / 3))
})

test('the target line is labelled with the target it is drawn at, never a fixed 90°', () => {
  const { container, rerender } = render(<RefAvatar clip="abduction" mode="run" demoAt={null} holdS={3} side="left" limitDeg={60} />)
  expect(container.querySelector('.av-tick-t')).toHaveTextContent('60°')
  rerender(<RefAvatar clip="abduction" mode="run" demoAt={null} holdS={3} side="left" />)
  expect(container.querySelector('.av-tick-t')).toHaveTextContent('90°')
})
