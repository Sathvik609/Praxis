/** axe (WCAG 2.1 A/AA + landmark/heading best practice) over every screen, rendered through the
 *  real route table with the design preview's captured service data (`designPreview/mockApi.ts`)
 *  and, for the live screens, a recorded event stream fed through the webcam hook. One test per
 *  screen; dialogs and in-session states are checked in `dialogs.a11y.test.tsx`.
 *  See docs/ACCESSIBILITY.md and `test/axe.ts` (what is and is not checked in jsdom). */
import { act, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { expectNoAxeViolations } from '../test/axe'

vi.mock('../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import { routes } from '../app/routes'
import { handle } from '../designPreview/mockApi'
import * as hook from '../session/useWebcamStream'

type Msg = { at: number; msg: Record<string, unknown> }
function recording(name: string): Msg[] {
  const raw = readFileSync(resolve(__dirname, `../designPreview/fixtures/ws/${name}.json`), 'utf8')
  return (JSON.parse(raw) as { messages: Msg[] }).messages
}

/** The webcam hook with the camera on and the socket connected, holding the first `share` of a
 *  recorded stream (last 200 events, as the hook keeps). */
export function feed(name: string, share = 0.5) {
  const all = recording(name).map((m) => m.msg)
  const events = all.slice(0, Math.max(1, Math.floor(all.length * share))).slice(-200)
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true, connected: true, lastEvent: events[events.length - 1] as never, events: events as never,
    sessionId: 'a11y', error: null, start: vi.fn(async () => {}), stop: vi.fn(), send: vi.fn(), videoRef: { current: null },
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const res = handle((init?.method ?? 'GET').toUpperCase(), url, body)
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => vi.restoreAllMocks())

export async function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(<RouterProvider router={router} />)
  // let every API read settle (several screens chain two reads)
  for (let i = 0; i < 4; i++) await act(() => new Promise((r) => setTimeout(r, 0)))
  return { ...view, router }
}

const PAGES: [string, string][] = [
  ['Home', '/details'],
  ['Check-in', '/details/checkin'],
  ['Choose exercise', '/details/choose'],
  ['Exercises hub', '/details/exercises'],
  ['Demonstration · cup', '/details/demo?exercise=cup&side=left'],
  ['Demonstration · arm', '/details/demo?exercise=abduction&side=left'],
  ['Progress', '/details/progress'],
  ['Calendar', '/details/calendar'],
  ['Settings', '/details/settings'],
  ['Coach chat drawer', '/details/coach'],
  ['Session report · cup + arm', '/report/s-0912-cuparm'],
  ['Session report · NHPT', '/report/s-0912-nhpt'],
  ['Assessment result', '/report'],
  ['Therapist dashboard', '/therapist'],
]

test.each(PAGES)('%s has no axe violations', async (_name, path) => {
  await renderRoute(path)
  await expectNoAxeViolations(document.body, { page: true })
})

const SETUP: [string, string, string][] = [
  ['Camera setup · NHPT', '/details/setup?exercise=nhpt&side=left', 'calibrate-nhpt'],
  ['Camera setup · cup', '/details/setup?exercise=cup&side=left', 'calibrate-cup'],
  ['Camera setup · arm', '/details/setup?exercise=abduction&side=left', 'calibrate-arm'],
]
test.each(SETUP)('%s has no axe violations', async (_name, path, rec) => {
  feed(rec, 1)
  await renderRoute(path)
  await expectNoAxeViolations(document.body, { page: true })
})

const LIVE: [string, string, string][] = [
  ['Live Waiter – cup', '/session?exercise=cup&side=left', 'cup'],
  ['Live NHPT', '/session?exercise=nhpt&side=left', 'nhpt'],
  ['Live Arm out to the side', '/session?exercise=abduction&side=left', 'abduction'],
]
test.each(LIVE)('%s has no axe violations', async (_name, path, rec) => {
  feed(rec, 0.5)
  await renderRoute(path)
  await expectNoAxeViolations(document.body, { page: true })
})
