/** Shared harness for the accessibility tests: the real route table, the design preview's
 *  captured service data (`designPreview/mockApi.ts`) as `fetch`, and recorded session streams
 *  fed through the webcam hook. Test files call `vi.mock('../avatar/AvatarScene', …)` themselves
 *  (WebGL is not available in jsdom). */
import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MemoryRouter, useLocation, useRoutes, type Location } from 'react-router-dom'
import { routes } from '../app/routes'
import { handle } from '../designPreview/mockApi'
import * as hook from '../session/useWebcamStream'

type Msg = { at: number; msg: Record<string, unknown> }
const cache = new Map<string, Record<string, unknown>[]>()
function recording(name: string): Record<string, unknown>[] {
  let all = cache.get(name)
  if (!all) {
    const raw = readFileSync(resolve(__dirname, `../designPreview/fixtures/ws/${name}.json`), 'utf8')
    all = (JSON.parse(raw) as { messages: Msg[] }).messages.map((m) => m.msg)
    cache.set(name, all)
  }
  return all
}

export const send = vi.fn()

/** The webcam hook with the camera on and the socket connected, holding the first `share` of a
 *  recorded stream (the last 200 events, as the hook keeps), plus any `extra` events after it. */
export function feed(name: string, share = 0.5, extra: Record<string, unknown>[] = []) {
  const all = recording(name)
  const events = [...all.slice(0, Math.max(1, Math.floor(all.length * share))), ...extra].slice(-200)
  return vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true, connected: true, lastEvent: events[events.length - 1] as never, events: events as never,
    sessionId: 'a11y', error: null, start: vi.fn(async () => {}), stop: vi.fn(), send, videoRef: { current: null },
  })
}

/** `fetch` answered by the design preview's fixtures (the same data the static preview shows). */
export function stubService() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const res = handle((init?.method ?? 'GET').toUpperCase(), url, body)
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } })
  })
}

/** Lets pending API reads and their state updates land (several screens chain two reads). */
export async function settle(rounds = 4) {
  for (let i = 0; i < rounds; i++) await act(() => new Promise((r) => setTimeout(r, 0)))
}

/** The app's route table in a MemoryRouter (`useRoutes`: the data router's fetch-based
 *  navigation does not run under jsdom). `path()` is the current location's pathname. */
export async function renderRoute(path: string) {
  const at: { current: Location | null } = { current: null }
  function Routes() {
    const location = useLocation()
    useEffect(() => {
      at.current = location
    })
    return useRoutes(routes)
  }
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes />
    </MemoryRouter>,
  )
  await settle()
  return { ...view, path: () => at.current?.pathname ?? '' }
}
