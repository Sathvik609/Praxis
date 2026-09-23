/** AvatarPanel with the Blender GLB: which figure mounts (GLB, loading, or the procedural
 *  fallback), what the panel feeds it (action, side, clock, markers, captions), and that a failed
 *  load or a lost WebGL context falls back to the procedural figure unchanged. The WebGL scenes
 *  are mocked; `glbAsset.test.ts` covers the real GLB through three's loader and mixer. */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import type { Clock } from './scene'
import { parseAvatarMeta } from './glbActions'
import type { AvatarAsset } from './glbAsset'

const h = vi.hoisted(() => ({
  load: vi.fn<() => Promise<unknown>>(),
  lastGlb: null as null | { clock: { current: Clock }; onContextLost?: () => void; onTick?: (t: unknown) => void },
}))

vi.mock('./AvatarScene', () => ({
  AvatarScene: ({ clip, figure }: { clip: { name: string; side: string }; figure?: string }) => (
    <div data-testid="scene">
      scene:{clip.name}:{clip.side}:{figure ?? 'body'}
    </div>
  ),
}))
vi.mock('./GlbScene', () => ({
  GlbScene: (p: { action: string; side: string; camera: string; clock: { current: Clock }; onContextLost?: () => void; onTick?: (t: unknown) => void }) => {
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
  expect(screen.getByRole('button', { name: /Left shoulder · Focus/ })).toBeInTheDocument()
  expect(screen.getByText(/motion from IntelliRehabDS · scaled to 90°/)).toBeInTheDocument()
  expect(screen.queryByTestId('arc-readout')).toBeNull()
})

test('a rejected load (network or parse) falls back to the procedural figure unchanged', async () => {
  h.load.mockRejectedValue(new Error('404'))
  render(<AvatarPanel clip="abduction" autoplay={false} />)
  expect(await screen.findByTestId('scene')).toHaveTextContent('scene:abduction:left:skeleton')
  expect(screen.queryByTestId('glb-scene')).toBeNull()
  expect(screen.getByRole('button', { name: /Left shoulder · Focus/ })).toBeInTheDocument()
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
  expect(screen.getByRole('button', { name: /Right hand · Focus/ })).toBeInTheDocument()
})

test('Home idle keeps its own markers; an explicit camera wins over meta.camera', async () => {
  h.load.mockResolvedValue(asset)
  render(<AvatarPanel clip="idle" camera="side" compact showCues={false} markers={[{ joint: 'lElbow', status: 'watch', label: 'Left elbow' }]} />)
  expect(await screen.findByTestId('glb-scene')).toHaveTextContent('glb:idle:left:side')
  expect(screen.getByRole('button', { name: /Left elbow · Watch/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Focus/ })).toBeNull()
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
