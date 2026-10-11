/**
 * Minimal Chrome DevTools Protocol driver for `e2e-fake-camera.mjs` (no dependencies; the same
 * approach as `a11y-browser.mjs`). One Chrome per fake-camera video: Chrome plays the file as
 * the webcam (`--use-file-for-fake-video-capture`) and grants the camera without a prompt.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ video, headed = false, width = 1280, height = 800 }) {
  if (!CHROME) throw new Error('Chrome not found: set CHROME_PATH.')
  const profile = mkdtempSync(join(tmpdir(), 'praxis-e2e-'))
  const args = [
    headed ? null : '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    video ? `--use-file-for-fake-video-capture=${video}` : null,
    'about:blank',
  ].filter(Boolean)
  const proc = spawn(CHROME, args, { stdio: 'ignore' })
  let port = null
  for (let i = 0; i < 150 && !port; i++) {
    await sleep(100)
    const f = join(profile, 'DevToolsActivePort')
    if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0]
  }
  if (!port) throw new Error('Chrome did not start')
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const page = new Page(ws, width, height)
  await page.init()
  page.close = async () => {
    try {
      ws.close()
    } catch {}
    await new Promise((r) => {
      proc.once('exit', r)
      proc.kill()
      setTimeout(r, 3000)
    })
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  return page
}

class Page {
  constructor(ws, width, height) {
    this.ws = ws
    this.width = width
    this.height = height
    this.seq = 0
    this.pending = new Map()
    this.listeners = []
    this.consoleErrors = []
    this.failedRequests = []
    this.wsSent = [] // {t, opcode, payloadData} binary frames are base64
    this.wsReceived = []
    this.keepWsPayloads = 3 // binary frames kept (the rest are counted)
    this.wsSentCount = 0
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg)
        this.pending.delete(msg.id)
      } else if (msg.method) this.onEvent(msg.method, msg.params)
    })
  }

  cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq
      this.pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)))
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  onEvent(method, p) {
    for (const l of this.listeners.splice(0)) {
      if (l.method === method && (!l.pred || l.pred(p))) l.resolve(p)
      else this.listeners.push(l)
    }
    if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) {
      this.consoleErrors.push({ kind: 'console', text: p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400), url: this.url })
    } else if (method === 'Runtime.exceptionThrown') {
      this.consoleErrors.push({ kind: 'exception', text: (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 400), url: this.url })
    } else if (method === 'Log.entryAdded' && p.entry.level === 'error') {
      this.consoleErrors.push({ kind: 'log', text: `${p.entry.text} ${p.entry.url ?? ''}`.slice(0, 400), url: this.url })
    } else if (method === 'Network.responseReceived' && p.response.status >= 400) {
      this.failedRequests.push({ status: p.response.status, url: p.response.url, page: this.url })
    } else if (method === 'Network.loadingFailed' && !p.canceled) {
      this.failedRequests.push({ status: p.errorText, url: this.requests?.get(p.requestId) ?? p.requestId, page: this.url })
    } else if (method === 'Network.requestWillBeSent') {
      ;(this.requests ??= new Map()).set(p.requestId, p.request.url)
    } else if (method === 'Network.webSocketFrameSent') {
      this.wsSentCount++
      if (p.response.opcode === 2 && this.wsSent.length < this.keepWsPayloads) this.wsSent.push(p.response.payloadData)
      else if (p.response.opcode === 1) this.wsSent.push(p.response.payloadData)
    } else if (method === 'Network.webSocketFrameReceived') {
      this.wsReceived.push(p.response.payloadData)
      if (this.wsReceived.length > 40000) this.wsReceived.splice(0, 10000)
    } else if (method === 'Network.webSocketFrameError') {
      this.failedRequests.push({ status: 'ws-frame-error', url: p.errorMessage, page: this.url })
    }
  }

  once(method, pred, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const l = { method, pred, resolve }
      this.listeners.push(l)
      setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeout)
    })
  }

  async init() {
    await this.cdp('Page.enable')
    await this.cdp('Runtime.enable')
    await this.cdp('Log.enable')
    await this.cdp('Network.enable')
    await this.cdp('Emulation.setDeviceMetricsOverride', { width: this.width, height: this.height, deviceScaleFactor: 1, mobile: false })
  }

  async goto(url, settle = 800) {
    this.url = url
    const loaded = this.once('Page.loadEventFired').catch(() => null)
    await this.cdp('Page.navigate', { url })
    await loaded
    await sleep(settle)
  }

  async eval(expression) {
    const r = await this.cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }

  /** Poll `expression` until it is truthy; returns its value (throws on timeout). */
  async waitFor(expression, { timeout = 15000, every = 250, what = expression } = {}) {
    const end = Date.now() + timeout
    let last
    while (Date.now() < end) {
      try {
        last = await this.eval(expression)
        if (last) return last
      } catch (e) {
        last = e.message
      }
      await sleep(every)
    }
    throw new Error(`timeout (${timeout} ms) waiting for: ${what} (last: ${JSON.stringify(last)?.slice(0, 200)})`)
  }

  /** Click the first visible button / link / [role=button] whose text includes `text`. */
  async click(text, { exact = false, within = 'document', near = null } = {}) {
    // "Start session@Nine-Hole": the button whose card (a close ancestor) mentions "Nine-Hole".
    if (!near && text.includes('@')) [text, near] = text.split('@')
    const ok = await this.eval(`(() => {
      const want = ${JSON.stringify(text)}
      const near = ${JSON.stringify(near)}
      const els = [...${within}.querySelectorAll('button, a, [role=button], [role=radio], [role=tab], label, [role=switch], [role=menuitem]')]
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
      // the smallest ancestor that mentions \`near\` must hold no other button with the same text
      const isNear = (e) => {
        if (!near) return true
        for (let p = e; p; p = p.parentElement) {
          if ((p.innerText || '').includes(near)) return [...p.querySelectorAll(e.tagName)].filter((o) => norm(o.innerText) === norm(e.innerText)).length === 1
        }
        return false
      }
      const hit = els.find((e) => vis(e) && !e.disabled && isNear(e) && (${exact} ? norm(e.innerText) === want || e.getAttribute('aria-label') === want : norm(e.innerText).includes(want) || (e.getAttribute('aria-label') || '').includes(want)))
      if (!hit) return false
      hit.scrollIntoView({ block: 'center' })
      hit.click()
      return true
    })()`)
    if (!ok) throw new Error(`no clickable element with text ${JSON.stringify(text)} on ${await this.eval('location.pathname + location.search')}`)
    await sleep(300)
  }

  async text() {
    return this.eval('document.body.innerText')
  }

  async buttons() {
    return this.eval(`[...document.querySelectorAll('button, a, [role=button]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).map((e) => (e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim() + (e.disabled ? ' [disabled]' : '')).filter(Boolean)`)
  }

  async screenshot(path) {
    const r = await this.cdp('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(r.data, 'base64'))
    return path
  }

  /** Session-service JSON events received over the WebSocket (parsed). */
  events(type) {
    const out = []
    for (const s of this.wsReceived) {
      if (type && !s.includes(`"${type}"`)) continue
      try {
        const e = JSON.parse(s)
        if (!type || e.type === type) out.push(e)
      } catch {}
    }
    return out
  }
}
