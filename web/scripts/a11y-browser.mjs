#!/usr/bin/env node
/**
 * axe-core (4.13.0) in headless Chrome over the built design preview: every WCAG 2.0 / 2.1 A and
 * AA rule, including colour contrast, which jsdom cannot compute (see `src/test/axe.ts`). Each
 * screen is checked in the light and the dark theme at 1280 x 800.
 *
 *   pnpm build:design && node scripts/a11y-browser.mjs [--json out.json]
 *
 * Uses Chrome over the DevTools protocol (no extra dependency): CHROME_PATH, else the default
 * macOS / Linux install paths. The preview answers the service from captured fixtures and plays
 * recorded session streams, so no service or camera is needed. Not part of CI (needs Chrome);
 * results are recorded in docs/ACCESSIBILITY.md.
 *
 * Exit code 1 when any violation is found outside the three D-CONTRAST exceptions below.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(WEB, 'dist-design')
const AXE = readFileSync(join(WEB, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null

/** The three contrast pairs kept by product decision D-CONTRAST (docs/RISKS.md, 6 Oct; pinned in
 *  `src/design/contrast.test.ts`). Nothing else is excluded. Colours as axe reports them. */
const D_CONTRAST = [
  { fg: '#a15c00', bg: '#ecedf0', why: 'light --amber-ink on --bg (4.43:1)' },
  { fg: '#ffffff', bg: '#6a88ee', why: 'white on the light primary gradient top stop (3.30:1)' },
  { fg: '#ffffff', bg: '#3a84ff', why: 'white on the dark primary gradient top stop (3.54:1)' },
]
const excepted = (node) => {
  const d = node.any?.[0]?.data
  return !!d && D_CONTRAST.some((x) => d.fgColor?.toLowerCase() === x.fg && d.bgColor?.toLowerCase() === x.bg)
}

const SCREENS = [
  ['Home', '/details'],
  ['Check-in', '/details/checkin'],
  ['Choose exercise', '/details/choose'],
  ['Demonstration', '/details/demo?exercise=cup&side=left'],
  ['Camera setup', '/details/setup?exercise=cup&side=left', 3000],
  ['Live Waiter – cup', '/session?exercise=cup&side=left&replay=synthetic_cup_01', 5000],
  ['Live NHPT', '/session?exercise=nhpt&hand=left&replay=synthetic_nhpt_01', 5000],
  ['Live Arm out to the side', '/session?exercise=abduction&side=left', 5000],
  ['Session report', '/report/s-0912-cuparm'],
  ['Progress', '/details/progress'],
  ['Calendar', '/details/calendar'],
  ['Settings', '/details/settings'],
  ['Therapist', '/therapist'],
  ['Coach chat', '/details/coach'],
]

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist-design/ is missing: run `pnpm build:design` first.')
  process.exit(2)
}

// --- static server for dist-design -------------------------------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' }
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(DIST, path === '/' ? 'index.html' : path)
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// --- Chrome over the DevTools protocol ---------------------------------------------------------
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
if (!CHROME) {
  console.error('Chrome not found: set CHROME_PATH.')
  process.exit(2)
}
const profile = mkdtempSync(join(tmpdir(), 'praxis-a11y-'))
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,800', '--no-first-run', '--use-fake-ui-for-media-stream', 'about:blank'], { stdio: 'ignore' })
let port = null
for (let i = 0; i < 100 && !port; i++) {
  await new Promise((r) => setTimeout(r, 100))
  const f = join(profile, 'DevToolsActivePort')
  if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]
}
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
const waiters = []
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data)
  if (msg.method) {
    for (const w of waiters.splice(0)) {
      if (w.method === msg.method) w.resolve()
      else waiters.push(w)
    }
  }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }))
/** A fresh document per check (the query changes), so no state carries over in the page. */
let loads = 0
async function open(route) {
  const loaded = once('Page.loadEventFired')
  await cdp('Page.navigate', { url: `${origin}/index.html?n=${++loads}#${route}` })
  await loaded
}
await cdp('Page.enable')
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })

const RUN = `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
  .then((r) => r.violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 140), any: n.any.map((a) => ({ data: a.data })) })) })))`

const report = []
let unexpected = 0
for (const [name, route, wait = 1500] of SCREENS) {
  for (const theme of ['light', 'dark']) {
    await open('/details')
    await evaluate(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('praxis.theme', ${JSON.stringify(theme)})`)
    await open(route)
    await new Promise((r) => setTimeout(r, wait))
    await evaluate(AXE)
    const violations = await evaluate(RUN)
    const kept = []
    let excused = 0
    for (const v of violations) {
      const nodes = v.id === 'color-contrast' ? v.nodes.filter((n) => !excepted(n)) : v.nodes
      excused += v.nodes.length - nodes.length
      if (nodes.length) kept.push({ ...v, nodes })
    }
    unexpected += kept.reduce((s, v) => s + v.nodes.length, 0)
    report.push({ screen: name, route, theme, excused, violations: kept })
    const line = kept.length ? kept.map((v) => `${v.id} ×${v.nodes.length}`).join(', ') : 'none'
    console.log(`${name.padEnd(26)} ${theme.padEnd(5)} D-CONTRAST excused ${String(excused).padStart(2)} · violations: ${line}`)
    for (const v of kept) for (const n of v.nodes.slice(0, 6)) {
      const d = n.any?.[0]?.data
      console.log(`    ${v.id}: ${n.target}${d?.contrastRatio ? ` · ${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}:1 (needs ${d.expectedContrastRatio})` : ''}`)
    }
  }
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2))
ws.close()
await new Promise((r) => {
  chrome.once('exit', r)
  chrome.kill()
})
server.close()
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
console.log(unexpected ? `\n${unexpected} node(s) with violations outside D-CONTRAST.` : '\nNo violations outside D-CONTRAST.')
process.exit(unexpected ? 1 : 0)
