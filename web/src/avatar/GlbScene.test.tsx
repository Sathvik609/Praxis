import { render } from '@testing-library/react'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseAvatarMeta } from './glbActions'

vi.mock('./stage', async (orig) => ({
  ...(await orig<typeof import('./stage')>()),
  // what three does when no WebGL context can be created
  makeRenderer: () => {
    throw new Error('Error creating WebGL context.')
  },
}))

import { GlbScene } from './GlbScene'

const meta = parseAvatarMeta(JSON.parse(readFileSync(resolve(__dirname, '../../public/avatar/praxis_avatar.meta.json'), 'utf8')))

test('when no WebGL context can be created the scene reports it, so the panel falls back', () => {
  const lost = vi.fn()
  const clock = { current: { time: 0, playing: true, speed: 1 } }
  render(
    <GlbScene
      asset={{ scene: new THREE.Group(), animations: [], meta }}
      action="flexion"
      side="left"
      clock={clock}
      camera="side"
      closeUp={false}
      compact={false}
      showCues
      onContextLost={lost}
    />,
  )
  expect(lost).toHaveBeenCalledTimes(1)
})
