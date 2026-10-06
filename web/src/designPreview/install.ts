/** Design preview (`pnpm build:design`, `import.meta.env.MODE === 'design'`): a static build with
 *  no session service. Loaded by `main.tsx` before the app renders, and only in that mode, so
 *  the normal build never contains any of it.
 *
 *  - `fetch` to the service's routes (/api, /health, /events) is answered from fixtures
 *    captured from the live service (`mockApi.ts`); everything else (the avatar GLB, fonts)
 *    loads from the bundle as usual.
 *  - `WebSocket` plays recorded session streams (`mockSocket.ts`).
 *  - `getUserMedia` returns a labelled placeholder picture (`fakeCamera.ts`).
 *  - A persistent badge says what this is: "Design preview · sample data · no camera". */
import { installFakeCamera } from './fakeCamera'
import { handle } from './mockApi'
import { PreviewSessionSocket } from './mockSocket'
import './preview.css'

const SERVICE_ROUTE = /^\/(api|health|events)(\/|\?|$)/
const LATENCY_MS = 80 // a short wait so loading states are visible, as over a network
/** The artifact host serves no `.glb`, so the design build ships the same bytes as
 *  `praxis_avatar.glb.wasm` (`vite.config.ts`) and the fetch is redirected; `GLTFLoader`
 *  parses the buffer and never looks at the name or content type. */
const GLB_SUFFIX = '.glb'

function installFetch() {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = typeof input === 'string' ? input : null // the app always passes a path string
    if (path?.endsWith(GLB_SUFFIX)) return realFetch(`${path}.wasm`, init)
    if (!path || !SERVICE_ROUTE.test(path)) return realFetch(input, init)
    const url = new URL(path, 'http://design-preview.invalid')
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: unknown = undefined
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = undefined
      }
    }
    await new Promise((r) => window.setTimeout(r, LATENCY_MS))
    const res = handle(method, url, body)
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } })
  }
}

function installWebSocket() {
  ;(window as unknown as { WebSocket: unknown }).WebSocket = PreviewSessionSocket
}

function showBadge() {
  const el = document.createElement('div')
  el.id = 'design-preview-badge'
  el.setAttribute('role', 'note')
  el.textContent = 'Design preview · sample data · no camera'
  el.title = 'Static preview: screens read data captured from the Praxis service; sessions replay recorded event streams. Nothing is measured or saved.'
  // A tab on the top edge, centred: above every header's text and clear of the fixed
  // in-session controls (bottom bar) and the flow bar's primary action. Never takes a click.
  const s = el.style
  s.position = 'fixed'
  s.top = '0'
  s.left = '50%'
  s.transform = 'translateX(-50%)'
  s.zIndex = '2147483000'
  s.pointerEvents = 'none'
  s.padding = '2px 12px 3px'
  s.borderRadius = '0 0 10px 10px'
  s.background = '#14201E'
  s.color = '#FFFFFF'
  s.borderBottom = '2px solid #C97F14'
  s.font = '700 13px/1.3 Mulish, "Segoe UI", system-ui, sans-serif'
  s.letterSpacing = '0.02em'
  s.whiteSpace = 'nowrap'
  s.boxShadow = '0 2px 6px rgb(0 0 0 / 0.2)'
  document.body.appendChild(el)
}

export function installDesignPreview() {
  installFetch()
  installWebSocket()
  installFakeCamera()
  showBadge()
}
