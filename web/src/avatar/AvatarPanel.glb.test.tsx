/** AvatarPanel with the Blender GLB: which figure mounts (GLB, loading, or the procedural
 *  fallback), what the panel feeds it (action, side, clock, markers, captions), and that a failed
 *  load or a lost WebGL context falls back to the procedural figure unchanged. The WebGL scenes
 *  are mocked; `glbAsset.test.ts` covers the real GLB through three's loader and mixer. */
import { act, cleanup as cleanupAll, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import type { Clock } from './scene'
import { parseAvatarMeta } from './glbActions'
import type { AvatarAsset } from './glbAsset'

const h = vi.hoisted(() => ({
  load: vi.fn<() => Promise<unknown>>(),
  lastGlb: null as null | {
    clock: { current: Clock }
    onContextLost?: () => void
    onTick?: (t: unknown) => void
    onProject?: (p: Record<string, { x: number; y: number }>) => void
    markers: { joint: string; status: string; label: string }[]
    extraJoints?: readonly string[]
  },
}))

vi.mock('./AvatarScene', () => ({
  AvatarScene: ({ clip, figure }: { clip: { name: string; side: string }; figure?: string }) => (
    <div data-testid="scene">
      scene:{clip.name}:{clip.side}:{figure ?? 'body'}
    </div>
  ),
}))
vi.mock('./GlbScene', () => ({
  GlbScene: (p: NonNullable<typeof h.lastGlb> & { action: string; side: string; camera: string }) => {
    h.lastGlb = p
    return (
      <div data-testid="glb-scene">
        glb:{p.action}:{p.side}:{p.camera}
      </div>
    )
  },
}))
vi.mock('./glbAsset', async (orig) => ({
  ...(await orig<typeof import('./glbAsset')>()),
  loadAvatarAsset: () => h.load(),
  peekAvatarAsset: () => null,
}))

import { AvatarPanel } from './AvatarPanel'

const metaJson = JSON.parse(readFileSync(resolve(__dirname, '../../public/avatar/praxis_avatar.meta.json'), 'utf8'))
const asset: AvatarAsset = { scene: new THREE.Group(), animations: [], meta: parseAvatarMeta(metaJson) }

beforeEach(() => {
  h.load.mockReset()
  h.lastGlb = null
  vi.stubGlobal('WebGL2RenderingContext', class {})
})
afterEach(() => vi.unstubAllGlobals())

test('without WebGL the procedural figure mounts at once and the GLB is never fetched', () => {
  vi.unstubAllGlobals()
  render(<AvatarPanel clip="flexion" autoplay={false} />)
  expect(screen.getByTestId('scene')).toHaveTextContent('scene:flexion:left:skeleton')
  expect(h.load).not.toHaveBeenCalled()
})

test('shows a loading state, then the GLB figure playing the mapped action with its captions and focus label', async () => {
  h.load.mockResolvedValue(asset)
  render(<AvatarPanel clip="armFront" autoplay={false} />)
  expect(screen.getByRole('status')).toHaveTextContent(/Loading the figure/)
  expect(await screen.findByTestId('glb-scene')).toHaveTextContent('glb:flexion:left:side')
  expect(screen.queryByTestId('scene')).toBeNull()
  expect(screen.getByText(metaJson.actions.flexion.steps[0].caption)).toBeInTheDocument()
  expect(h.lastGlb!.markers).toEqual([{ joint: 'lShoulder', status: 'focus', label: 'Left shoulder' }])
  expect(screen.queryByRole('button', { name: /· Focus/ })).toBeNull() // design v2: no joint text chips
  expect(screen.getByTestId('view-line')).toHaveTextContent(/^Side view · 1×$/)
  expect(screen.getByTestId('view-line')).toHaveAttribute('title', expect.stringMatching(/motion from IntelliRehabDS · scaled to 90°/))
  expect(screen.queryByTestId('arc-readout')).toBeNull()
})

test('a rejected load (network or parse) falls back to the procedural figure unchanged', async () => {
  h.load.mockRejectedValue(new Error('404'))
  render(<AvatarPanel clip="abduction" autoplay={false} />)
  expect(await screen.findByTestId('scene')).toHaveTextContent('scene:abduction:left:skeleton')
  expect(screen.queryByTestId('glb-scene')).toBeNull()
  expect(screen.getByText(/Reference only/)).toBeInTheDocument()
})

test('a lost WebGL context in GLB mode falls back to the procedural figure', async () => {
  h.load.mockResolvedValue(asset)
  render(<AvatarPanel clip="cup" autoplay={false} />)
  await screen.findByTestId('glb-scene')
  act(() => h.lastGlb!.onContextLost!())
  expect(screen.getByTestId('scene')).toHaveTextContent('scene:cup:left:body')
})

test('the right side mirrors: Waiter – cup plays waiter_cup on the right with the right hand in focus', async () => {
  h.load.mockResolvedValue(asset)
  render(<AvatarPanel clip="cup" side="right" autoplay={false} />)
  expect(await screen.findByTestId('glb-scene')).toHaveTextContent('glb:waiter_cup:right:front')
  expect(h.lastGlb!.markers).toEqual([{ joint: 'rWrist', status: 'focus', label: 'Right hand' }])
})

test('Home idle keeps its own markers; an explicit camera wins over meta.camera', async () => {
  h.load.mockResolvedValue(asset)
  render(<AvatarPanel clip="idle" camera="side" compact showCues={false} markers={[{ joint: 'lElbow', status: 'watch', label: 'Left elbow' }]} />)
  expect(await screen.findByTestId('glb-scene')).toHaveTextContent('glb:idle:left:side')
  expect(h.lastGlb!.markers).toEqual([{ joint: 'lElbow', status: 'watch', label: 'Left elbow' }])
})

test('rep progress paces the action inside meta.rep; null frees it again', async () => {
  h.load.mockResolvedValue(asset)
  const { rerender } = render(<AvatarPanel clip="cup" paced={null} compact />)
  await screen.findByTestId('glb-scene')
  const clock = h.lastGlb!.clock
  expect(clock.current.target ?? null).toBeNull()
  rerender(<AvatarPanel clip="cup" paced={0.5} compact />)
  expect(clock.current.target).toBeCloseTo(2.2 + 0.5 * (13.8 - 2.2))
  rerender(<AvatarPanel clip="cup" paced={1} compact />)
  expect(clock.current.target).toBeCloseTo(13.8)
  rerender(<AvatarPanel clip="cup" paced={null} compact />)
  expect(clock.current.target).toBeNull()
})

test('Slower scales the action clock, Replay restarts it, captions follow the stage ticks', async () => {
  h.load.mockResolvedValue(asset)
  const onStep = vi.fn()
  render(<AvatarPanel clip="flexion" onStep={onStep} />)
  await screen.findByTestId('glb-scene')
  const clock = h.lastGlb!.clock
  fireEvent.click(screen.getByRole('button', { name: 'Slower' }))
  expect(clock.current.speed).toBe(0.5)
  expect(screen.getByText(/0\.5×/)).toBeInTheDocument()
  act(() => h.lastGlb!.onTick!({ caption: 'Hold it', step: 2, ended: false, t: 1.1, angleDeg: null }))
  expect(screen.getByText('Hold it')).toBeInTheDocument()
  expect(onStep).toHaveBeenCalledWith(2)
  clock.current.time = 1.9
  fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
  expect(clock.current.time).toBe(0)
  expect(screen.getByText(metaJson.actions.flexion.steps[0].caption)).toBeInTheDocument()
})

test('Arm out to the side plays its script: palm-down captions, the prescribed hold, Replay rewinds the warp', async () => {
  h.load.mockResolvedValue(asset)
  const { rerender } = render(<AvatarPanel clip="abduction" holdS={2} />)
  await screen.findByTestId('glb-scene')
  expect(screen.getByText('Step 1 of 4 · Sit tall facing the camera, arm by your side')).toBeInTheDocument()
  expect(screen.getByTestId('view-line').getAttribute('data-provenance')).toMatch(/UI-PRMD · scaled to 90° · paced to the prescription/)
  const p = h.lastGlb as unknown as { script: { steps: string[]; total: number } }
  expect(p.script.steps[1]).toMatch(/palm down/)
  expect(p.script.steps[2]).toMatch(/Hold for 2 s/)
  expect(p.script.total).toBeCloseTo(1 + 3 + 2 + 3 + 1)
  const clock = h.lastGlb!.clock
  clock.current.warp = 5
  clock.current.time = 1
  fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
  expect(clock.current.warp).toBe(0)
  expect(clock.current.time).toBe(0)
  rerender(<AvatarPanel clip="abduction" holdS={3} />)
  expect((h.lastGlb as unknown as { script: { steps: string[] } }).script.steps[2]).toMatch(/Hold for 3 s/)
})

test('the cup and peg test play their scripts (same steps as the Demonstration list)', async () => {
  h.load.mockResolvedValue(asset)
  const { rerender } = render(<AvatarPanel clip="cup" />)
  await screen.findByTestId('glb-scene')
  expect(screen.getByText('Step 1 of 5 · Cup off the sheet until the camera finds the four corners, then on dot 1')).toBeInTheDocument()
  rerender(<AvatarPanel clip="nhpt" />)
  expect(screen.getByText(/^Step 1 of 4 · Pick a peg from the dish/)).toBeInTheDocument()
})

test('the stage keeps the figure clear of the labels and the caption bar (insets), and passes the zoom', async () => {
  h.load.mockResolvedValue(asset)
  render(<AvatarPanel clip="idle" camera="front" compact zoom={1.5} overlayTop={64} markers={[{ joint: 'lWrist', status: 'focus', label: 'Left hand' }]} />)
  await screen.findByTestId('glb-scene')
  const p = h.lastGlb as unknown as { zoom: number; insets: { top: number; bottom: number; left: number; right: number } }
  expect(p.zoom).toBe(1.5)
  expect(p.insets.bottom).toBeGreaterThanOrEqual(48)
  expect(p.insets.top).toBeGreaterThanOrEqual(32)
})

const HOT = [
  { key: 'lShoulder', joint: 'lShoulder', label: 'Shoulder', word: 'Watch', status: 'watch' as const },
  { key: 'lElbow', joint: 'lElbow', label: 'Elbow', word: 'Stable', status: 'stable' as const },
  { key: 'lWrist', joint: 'lWrist', label: 'Hand', word: 'Focus', status: 'focus' as const },
]

test('hotspots (GLB loaded): one button per area, "{label} — {word}", pressed on the active one, placed on the projected joint', async () => {
  h.load.mockResolvedValue(asset)
  const onHot = vi.fn()
  render(<AvatarPanel clip="idle" camera="front" compact markers={[]} hotspots={HOT} hotActive="lWrist" onHot={onHot} />)
  await screen.findByTestId('glb-scene')
  // hidden (visibility) until the stage has projected their joints
  const shoulder = screen.getByLabelText('Shoulder — Watch')
  const hand = screen.getByLabelText('Hand — Focus')
  const elbow = screen.getByLabelText('Elbow — Stable')
  expect(elbow).toHaveAttribute('aria-pressed', 'false')
  expect(hand).toHaveAttribute('aria-pressed', 'true')
  expect(shoulder.className).toMatch(/hp-hot hp-hot-watch/)
  expect(hand.className).toMatch(/hp-hot-on/)
  expect(shoulder.querySelector('.hp-hot-dot')).not.toBeNull()
  // the stage projects the hotspot joints; hidden until projected
  expect(h.lastGlb!.extraJoints).toEqual(expect.arrayContaining(['lShoulder', 'lElbow', 'lWrist']))
  expect(shoulder.style.visibility).toBe('hidden')
  act(() => h.lastGlb!.onProject!({ lShoulder: { x: 120, y: 80 }, lWrist: { x: 90, y: 200 } }))
  expect(shoulder.style.visibility).toBe('visible')
  expect(shoulder.style.transform).toBe('translate(120px, 80px) translate(-50%, -50%)')
  expect(screen.getByRole('button', { name: 'Shoulder — Watch' })).toBe(shoulder) // now in the accessibility tree
  expect(elbow.style.visibility).toBe('hidden')
  fireEvent.click(shoulder)
  expect(onHot).toHaveBeenCalledWith('lShoulder')
})

test('theater: the dock (step, progress, Play/Pause, Replay, Slower; Audio is the host\'s, via dockEnd) replaces caption, view line and controls', async () => {
  h.load.mockResolvedValue(asset)
  render(<AvatarPanel clip="abduction" theater holdS={3} limitDeg={60} />)
  await screen.findByTestId('glb-scene')
  expect(document.querySelector('.dth-dock')).not.toBeNull()
  expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
  expect(screen.getByText('Sit tall facing the camera, arm by your side')).toBeInTheDocument()
  expect(document.querySelectorAll('.dth-progress .dth-seg')).toHaveLength(4)
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Slower' }))
  expect(screen.getByRole('button', { name: 'Slower · 0.5×' })).toHaveAttribute('aria-pressed', 'true')
  expect(h.lastGlb!.clock.current.speed).toBe(0.5)
  expect(screen.queryByRole('button', { name: /^Audio/ })).toBeNull()
  expect(screen.queryByTestId('view-line')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Close-up' })).toBeNull()
  expect(screen.queryByText(/Reference only/)).toBeNull()
  // the script follows today's limit
  expect((h.lastGlb as unknown as { script: { steps: string[] } }).script.steps[1]).toMatch(/up to 60°/)
})

test('theater: speakSteps reads the current step aloud once; dockEnd sits at the right of the controls', async () => {
  h.load.mockResolvedValue(asset)
  const said: string[] = []
  vi.stubGlobal('SpeechSynthesisUtterance', class { rate = 1; volume = 1; onend?: () => void; onerror?: () => void; constructor(public text: string) {} })
  vi.stubGlobal('speechSynthesis', { speak: (u: { text: string; onend?: () => void }) => { said.push(u.text); u.onend?.() }, cancel: vi.fn() })
  try {
    const { rerender } = render(<AvatarPanel clip="abduction" theater holdS={3} dockEnd={<button type="button">Skip demo</button>} />)
    await screen.findByTestId('glb-scene')
    expect(said).toEqual([])
    const controls = document.querySelector('.dth-controls')!
    expect(controls.lastElementChild).toContainElement(screen.getByRole('button', { name: 'Skip demo' }))
    rerender(<AvatarPanel clip="abduction" theater holdS={3} speakSteps dockEnd={<button type="button">Skip demo</button>} />)
    expect(said).toEqual(['Sit tall facing the camera, arm by your side'])
  } finally {
    vi.unstubAllGlobals()
  }
})

test('theater readouts: limit line + "{n}° limit", the figure\'s own shoulder angle, and the trunk-lean tag', async () => {
  h.load.mockResolvedValue(asset)
  render(<AvatarPanel clip="abduction" theater limitDeg={60} />)
  await screen.findByTestId('glb-scene')
  expect(document.querySelector('svg.dth-ang-svg line.dth-ang-limit')).not.toBeNull()
  expect(document.querySelector('svg.dth-ang-svg path.dth-ang-arc')).not.toBeNull()
  expect(document.querySelector('.dth-ang-ltag')).toHaveTextContent('60° limit')
  const tags = [...document.querySelectorAll('.dth-ang-tag')]
  expect(tags.map((t) => t.textContent)).toEqual(['0°shoulder', '0°trunk lean'])
  expect(h.lastGlb!.extraJoints).toEqual(expect.arrayContaining(['lShoulder', 'lElbow', 'lWrist', 'rShoulder']))
  // arm straight out to the side in the projection: 90° at the figure's shoulder
  act(() => h.lastGlb!.onProject!({ lShoulder: { x: 200, y: 100 }, lElbow: { x: 260, y: 100 }, lWrist: { x: 320, y: 100 }, rShoulder: { x: 140, y: 100 } }))
  expect(tags[0].querySelector('b')).toHaveTextContent('90°')
  expect(document.querySelector('line.dth-ang-limit')!.getAttribute('x1')).toBe('200')
  // not for the table tasks, and never outside the theater
  cleanupAll()
  render(<AvatarPanel clip="cup" theater />)
  await screen.findByTestId('glb-scene')
  expect(document.querySelector('.dth-ang-ltag')).toBeNull()
})

test('theater: onComplete fires once at the end of the rep and the dock offers Replay', async () => {
  h.load.mockResolvedValue(asset)
  const onComplete = vi.fn()
  render(<AvatarPanel clip="abduction" theater holdS={3} onComplete={onComplete} />)
  await screen.findByTestId('glb-scene')
  const clock = h.lastGlb!.clock
  clock.current.warp = 1 + 3 + 3 + 3 + 0.5 // into the rest after step 4
  await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
  expect(clock.current.warp).toBe(0)
  expect(screen.getByRole('button', { name: 'Pause' })).not.toBeDisabled()
})

test('ctlRef drives the reference figure: play, pause, replay, rate and seek', async () => {
  h.load.mockResolvedValue(asset)
  const ctl = { current: null } as { current: import('./AvatarPanel').AvatarCtl | null }
  render(<AvatarPanel clip="cup" bare autoplay={false} ctlRef={ctl} />)
  await screen.findByTestId('glb-scene')
  const clock = h.lastGlb!.clock
  act(() => ctl.current!.play())
  expect(clock.current.playing).toBe(true)
  act(() => ctl.current!.pause())
  expect(clock.current.playing).toBe(false)
  act(() => ctl.current!.setRate(0.25))
  expect(clock.current.speed).toBe(0.25)
  act(() => ctl.current!.seek(4.5))
  expect(clock.current.time).toBe(4.5)
  expect(clock.current.target).toBe(4.5)
  act(() => ctl.current!.replay())
  expect(clock.current.time).toBe(0)
  expect(clock.current.target ?? null).toBeNull()
  expect(clock.current.playing).toBe(true)
})

test('onJoints gets every projection; jointList adds joints (the cup sheet dots) to project', async () => {
  h.load.mockResolvedValue(asset)
  const onJoints = vi.fn()
  render(<AvatarPanel clip="cup" bare camera="front" onJoints={onJoints} jointList={['dot1', 'dot5', 'cup']} />)
  await screen.findByTestId('glb-scene')
  expect(h.lastGlb!.extraJoints).toEqual(expect.arrayContaining(['dot1', 'dot5', 'cup']))
  act(() => h.lastGlb!.onProject!({ dot1: { x: 10, y: 20 } }))
  expect(onJoints).toHaveBeenCalledWith({ dot1: { x: 10, y: 20 } }, expect.any(HTMLElement))
})
