#!/usr/bin/env node
/**
 * Capture the fixtures the static design preview (`pnpm build:design`) serves instead of the
 * session service. Build-time only: the preview bundle never talks to this URL.
 *
 *   node scripts/capture-design-fixtures.mjs [--base https://d235zashbh751z.cloudfront.net]
 *
 * Writes `src/designPreview/fixtures/`:
 *   http.json          every GET the web app makes (path -> JSON body), incl. each /api/sessions/{id}
 *   calendar.json      { default: GET /api/calendar, days: every day from several ranged reads }
 *   ws/<exercise>.json one recorded replay session per visible exercise that has a replay clip:
 *                      server->client messages with ms offsets, plus the session summary and
 *                      decision trace read afterwards (GET only).
 *
 * Read-only against the service: the script never sends `feedback`, so no session is stored.
 * Frames never reach the browser in replay, so the recordings hold events only (no video).
 * Arm out to the side has no replay clip; its stream comes from `record-design-streams.py`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const argBase = process.argv.indexOf('--base')
const BASE = (argBase > 0 ? process.argv[argBase + 1] : process.env.PRAXIS_CAPTURE_BASE) || 'https://d235zashbh751z.cloudfront.net'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'designPreview', 'fixtures')
const VISIBLE = new Set(['abduction', 'cup', 'nhpt']) // 28 Sep lock; hidden exercises are out of scope

async function getJson(path) {
  const r = await fetch(BASE + path)
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
  return r.json()
}

const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

async function captureHttp() {
  const http = {}
  const paths = ['/health', '/api/patients/me', '/api/prescription', '/api/sessions', '/api/flags', '/api/progress', '/api/therapist/patients', '/api/replay/list', '/api/trace?n=200']
  for (const p of paths) {
    http[p] = await getJson(p)
    console.log('GET', p)
  }
  for (const s of http['/api/sessions'].sessions) {
    const p = `/api/sessions/${s.id}`
    http[p] = await getJson(p)
    console.log('GET', p)
  }
  return http
}

async function captureCalendar() {
  const def = await getJson('/api/calendar')
  // Several ranged reads (the service allows 62 days each) from ~4 months back to ~5 months ahead.
  const days = {}
  let from = addDays(def.today, -126)
  const end = addDays(def.today, 154)
  while (from <= end) {
    const to = addDays(from, 55)
    const c = await getJson(`/api/calendar?from=${from}&to=${to}`)
    for (const d of c.days) days[d.date] = d
    console.log('GET /api/calendar', from, to)
    from = addDays(to, 1)
  }
  return { default: def, days }
}

function recordReplay(clip) {
  const wsBase = BASE.replace(/^http/, 'ws')
  const q = new URLSearchParams({ mode: clip.pipeline ?? clip.mode, sheet: clip.sheet, replay: clip.id })
  const url = `${wsBase}/ws/session?${q}`
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const t0 = Date.now()
    const messages = []
    let sessionId = null
    let endTimer = null
    const guard = setTimeout(() => finish(new Error('timed out after 6 min')), 6 * 60_000)
    function finish(err) {
      clearTimeout(guard)
      if (endTimer) clearTimeout(endTimer)
      try {
        ws.close()
      } catch {
        /* already closed */
      }
      if (err) reject(err)
      else resolve({ sessionId, messages })
    }
    ws.onopen = () => {
      // What the app sends on open when a check-in is stored (useSessionFlow): a pain-2 day.
      ws.send(JSON.stringify({ cmd: 'checkin', pain: 2, energy: 'ok', minutes: 10, new_symptoms: false }))
    }
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data))
      messages.push({ at: Date.now() - t0, msg })
      if (msg.type === 'replay_start') sessionId = msg.session_id ?? sessionId
      if (msg.type === 'replay_end') endTimer = setTimeout(() => finish(), 2500) // trailing coach events
      if (messages.length % 200 === 0) process.stdout.write(`  ${clip.id}: ${messages.length} messages\n`)
    }
    ws.onerror = (e) => finish(new Error(`websocket error ${e.message ?? ''}`))
    ws.onclose = () => finish()
  })
}

async function main() {
  await mkdir(join(OUT, 'ws'), { recursive: true })
  const http = await captureHttp()
  await writeFile(join(OUT, 'http.json'), JSON.stringify(http, null, 1))
  const cal = await captureCalendar()
  await writeFile(join(OUT, 'calendar.json'), JSON.stringify(cal, null, 1))

  const clips = http['/api/replay/list'].clips.filter((c) => VISIBLE.has(c.exercise ?? c.mode))
  for (const clip of clips) {
    console.log('recording replay', clip.id)
    const { sessionId, messages } = await recordReplay(clip)
    const sid = sessionId ?? messages.find((m) => m.msg.session_id)?.msg.session_id
    const summary = sid ? await getJson(`/api/session/${sid}/summary`) : null
    const trace = sid ? await getJson(`/api/trace?session=${sid}&n=200`) : null
    const exercise = clip.exercise ?? clip.mode
    const rec = {
      exercise,
      mode: clip.pipeline ?? clip.mode,
      clip: clip.id,
      source: `recorded replay of ${clip.id} over the live Praxis service's WebSocket on ${new Date().toISOString().slice(0, 10)}`, // no host name: the bundle must not name a URL it could call
      synthetic_clip: !!clip.synthetic,
      session_id: sid,
      summary,
      trace,
      messages,
    }
    await writeFile(join(OUT, 'ws', `${exercise}.json`), JSON.stringify(rec))
    console.log(`  ${clip.id}: ${messages.length} messages over ${(messages.at(-1)?.at ?? 0) / 1000}s, session ${sid}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
