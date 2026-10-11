/** The critical path with the keyboard only: check-in → Choose → Demonstration → Camera setup →
 *  live session → Pain / feel unwell → End session → feedback → report. Every control is
 *  reached with Tab (never clicked or focused by the test) and used with Enter / Space / arrows,
 *  so a step that is not in the Tab order fails here. */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as hook from '../session/useWebcamStream'
import { renderRoute, settle, stubService } from './harness'

vi.mock('../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))
// The demonstration's "Before you start" opens when the clip ends; the figure here ends at once
// (the real figure plays the whole clip first, the same wait for every user).
vi.mock('../avatar/AvatarPanel', async () => {
  const { useEffect } = await import('react')
  return {
    AvatarPanel: ({ theater, onComplete }: { theater?: boolean; onComplete?: () => void }) => {
      useEffect(() => {
        if (theater) onComplete?.()
      }, [theater, onComplete])
      return <div data-testid="figure" />
    },
  }
})

// recorded streams: Camera setup (sheet found) and the first half of a cup session
const load = (n: string) => (JSON.parse(readFileSync(resolve(__dirname, `../designPreview/fixtures/ws/${n}.json`), 'utf8')) as { messages: { msg: Record<string, unknown> }[] }).messages.map((m) => m.msg)
const calibrate = load('calibrate-cup')
const cupAll = load('cup')
const cup = cupAll.slice(0, Math.floor(cupAll.length / 2))

type User = ReturnType<typeof userEvent.setup>

/** Presses Tab until `target` has focus; fails if it is not reached in `max` presses. */
async function tabTo(user: User, target: HTMLElement, max = 60) {
  for (let i = 0; i < max; i++) {
    if (document.activeElement === target) return
    await user.tab()
  }
  expect(target, `not reachable with Tab: ${target.outerHTML.slice(0, 120)}`).toHaveFocus()
}

const LATE = 100_000
let stream: Record<string, unknown>[] = []
const send = vi.fn((msg: Record<string, unknown>) => {
  // the service answers the feedback with the stored session (as `useSessionFlow` expects)
  if (msg.cmd === 'feedback') stream = [...stream, { type: 'command', cmd: 'feedback', t: LATE, id: LATE + 1, summary: { session_id: 's-0912-cuparm' } }]
})

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  stubService()
  stream = []
  send.mockClear()
  // camera on and connected; Camera setup and the session read the same recorded cup streams
  vi.spyOn(hook, 'useWebcamStream').mockImplementation(({ mode }) => {
    const events = (mode === 'calibrate' ? calibrate : [...cup, ...stream]).slice(-200)
    return { camActive: true, connected: true, lastEvent: events[events.length - 1] as never, events: events as never, sessionId: 'kb', error: null, start: vi.fn(async () => {}), stop: vi.fn(), send, videoRef: { current: null } }
  })
})
afterEach(() => vi.restoreAllMocks())

test('check-in → choose → demo → setup → session → pain → end → feedback → report, keyboard only', async () => {
  const user = userEvent.setup()
  const { path } = await renderRoute('/details/checkin')

  // 03 check-in: the first Tab stop skips the header
  await user.tab()
  expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(document.getElementById('main')).toHaveFocus()
  // pain 0 with the keyboard (one Tab stop for the scale, arrows inside), then the arm
  const scale = screen.getByRole('radiogroup', { name: 'Pain right now' })
  await tabTo(user, within(scale).getByRole('radio', { name: '0' }))
  await user.keyboard(' ')
  expect(within(scale).getByRole('radio', { name: '0' })).toBeChecked()
  await tabTo(user, screen.getByRole('radio', { name: 'Left arm' }))
  await user.keyboard(' ')
  const go = screen.getByRole('button', { name: 'Continue to exercises' })
  await tabTo(user, go)
  await user.keyboard('{Enter}')
  await settle()
  expect(path()).not.toBe('/details/checkin')

  // 04 choose, reached from the hub navigation
  await tabTo(user, screen.getByRole('link', { name: 'Exercises' }))
  await user.keyboard('{Enter}')
  await settle()
  expect(screen.getByRole('heading', { level: 1, name: 'Choose your exercise' })).toBeInTheDocument()
  await tabTo(user, screen.getByRole('button', { name: 'Start session: Waiter – cup' }))
  await user.keyboard('{Enter}')
  await settle()

  // 06 demonstration: the clip ends, "Before you start" takes focus on its primary action
  const before = screen.getByRole('dialog', { name: 'Before you start' })
  const toSetup = within(before).getByRole('button', { name: 'Continue to setup' })
  expect(toSetup).toHaveFocus()
  await user.keyboard('{Enter}')
  await settle()
  expect(path()).toBe('/details/setup')

  // 05 camera setup → session
  const startBtn = screen.getByRole('button', { name: /^Continue( anyway| · .*)?$/ })
  await tabTo(user, startBtn)
  await user.keyboard('{Enter}')
  await settle()
  expect(path()).toBe('/session')
  expect(screen.getByRole('heading', { level: 1, name: /Waiter – cup/ })).toBeInTheDocument()

  // 07b Pain / feel unwell: 3 with the arrows, sent to the coach
  const painBtn = screen.getByRole('button', { name: 'Pain / feel unwell' })
  await tabTo(user, painBtn)
  await user.keyboard('{Enter}')
  await settle()
  const painDialog = screen.getByRole('dialog', { name: 'How is the pain right now?' })
  await tabTo(user, within(painDialog).getByRole('radio', { name: '0' }))
  await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
  await tabTo(user, within(painDialog).getByRole('button', { name: 'Send to coach' }))
  await user.keyboard('{Enter}')
  await settle()
  expect(send).toHaveBeenCalledWith({ cmd: 'pain', pain: 3 })
  expect(painBtn).toHaveFocus() // focus came back to the bar

  // End session → reason → End
  await tabTo(user, screen.getByRole('button', { name: 'End session' }))
  await user.keyboard('{Enter}')
  const endDialog = screen.getByRole('dialog', { name: 'Ending the session' })
  await tabTo(user, within(endDialog).getByRole('radio', { name: 'Finished for today — no problem' }))
  await user.keyboard(' ')
  await tabTo(user, within(endDialog).getByRole('button', { name: 'End session' }))
  await user.keyboard('{Enter}')
  await settle()

  // 08 feedback: Next through the questions, then save
  for (let i = 0; i < 4; i++) {
    const fb = screen.getByRole('dialog')
    const primary = within(fb).getByRole('button', { name: /^(Next|Save and see report)$/ })
    const last = primary.textContent === 'Save and see report'
    await tabTo(user, primary)
    await user.keyboard('{Enter}')
    await settle()
    if (last) break
  }
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'feedback' }))

  // 09 report
  await settle()
  expect(path()).toBe('/report/s-0912-cuparm')
  expect(await screen.findByRole('heading', { level: 1, name: 'Your practice report' })).toBeInTheDocument()
})

test('Home: the affected-area tabs move with the arrow keys', async () => {
  const user = userEvent.setup()
  await renderRoute('/details')
  const tabs = within(screen.getByRole('tablist', { name: 'Affected areas' })).getAllByRole('tab')
  await tabTo(user, tabs[0])
  await user.keyboard('{ArrowRight}')
  expect(tabs[1]).toHaveFocus()
  expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tabpanel')).toBe(document.getElementById(tabs[1].getAttribute('aria-controls')!))
})
