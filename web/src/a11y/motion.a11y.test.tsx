/** Reduced motion (Settings › Reduced motion or the system setting): the Demonstration figure
 *  waits for Play instead of starting on its own; with motion allowed it plays. Home's idle
 *  figure follows the same rule (`autoplay={!prefersReducedMotion()}`). */
import { screen } from '@testing-library/react'
import { renderRoute, stubService } from './harness'

vi.mock('../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  stubService()
})
afterEach(() => {
  delete document.documentElement.dataset.motion
  vi.restoreAllMocks()
})

const DEMO = '/details/demo?exercise=abduction&side=left'

test('with reduced motion the demonstration does not start by itself', async () => {
  document.documentElement.dataset.motion = 'reduced'
  await renderRoute(DEMO)
  expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
})

test('without it the demonstration plays (and can be paused)', async () => {
  await renderRoute(DEMO)
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
})
