#!/usr/bin/env node
/**
 * End-to-end check through a real browser with a simulated camera: camera setup -> detection ->
 * session -> coach -> feedback -> report, as a judge would see it. Chrome plays an OpenCV-rendered
 * clip as its webcam (`--use-file-for-fake-video-capture`), the app streams the frames to the
 * session service exactly as it does with a laptop camera, and this script drives the screens
 * over the DevTools protocol (no extra dependency; `e2e-cdp.mjs`).
 *
 *   # 1. the fake-camera clips (git-ignored, ~3 min to render)
 *   cd services/session && uv run python tools/make_fake_camera.py
 *   # 2. one origin: the built web app served by the session service (any free port)
 *   cd web && pnpm build
 *   cd services/session && PRAXIS_WEB_DIST=../../web/dist PRAXIS_DB=/tmp/praxis-e2e.db \
 *       uv run uvicorn praxis_session.main:app --port 8100
 *   # 3. the checks (screenshots + results.json in --out)
 *   cd web && node scripts/e2e-fake-camera.mjs --origin http://127.0.0.1:8100 --out /tmp/praxis-e2e
 *
 * Options: --only setup,nhpt,cup,loss,replay,arm,agent (default: all but agent) · --headed ·
 * --videos <dir> (default evaluation/fake_camera). `agent` needs the service started with
 * PRAXIS_AGENT=anthropic (real model calls, ~$0.20 a session) and runs the cup clip where a hand
 * covers the two near corner markers during arc 2 (one covered corner rides on the 3-marker fit).
 * Use a fresh PRAXIS_DB: the run writes sessions and a check-in for today.
 *
 * Exit code 1 when any check fails. Synthetic clips: this validates the product path, not
 * real-world accuracy.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, sleep } from './e2e-cdp.mjs'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt)
const ORIGIN = arg('origin', 'http://127.0.0.1:8100')
const VIDEOS = resolve(arg('videos', join(WEB, '..', 'evaluation', 'fake_camera')))
const OUT = resolve(arg('out', join(WEB, '..', 'evaluation', 'fake_camera', 'e2e')))
const HEADED = process.argv.includes('--headed')
const ONLY = (arg('only', 'setup,nhpt,cup,loss,replay,arm') || '').split(',')
mkdirSync(OUT, { recursive: true })
if (!existsSync(join(VIDEOS, 'index.json'))) {
  console.error(`No clips in ${VIDEOS}: run services/session/tools/make_fake_camera.py first.`)
  process.exit(2)
}
const INDEX = JSON.parse(readFileSync(join(VIDEOS, 'index.json'), 'utf8'))

const results = []
const notes = []
function check(id, pass, detail = '') {
  results.push({ id, pass: !!pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}${detail ? `  · ${detail}` : ''}`)
}
const note = (s) => {
  notes.push(s)
  console.log(`      ${s}`)
}
let shotN = 0
const shot = (page, name) => page.screenshot(join(OUT, `${String(++shotN).padStart(2, '0')}_${name}.png`))
const flat = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

async function withChrome(video, fn) {
  const page = await launch({ video: video ? join(VIDEOS, `${video}.mjpeg`) : undefined, headed: HEADED })
  try {
    await fn(page)
  } catch (e) {
    check(`${video ?? 'no-camera'}: ran without a driver error`, false, e.message)
    try {
      await shot(page, `error_${video}`)
    } catch {}
  } finally {
    // what the service sent, for debugging a failed check: counts per type + the last of each
    const byType = {}
    for (const e of page.events()) byType[e.type] = { n: (byType[e.type]?.n ?? 0) + 1, last: e }
    writeFileSync(join(OUT, `events_${video ?? 'replay'}_${++shotN}.json`), JSON.stringify(byType, null, 1))
    const errs = page.consoleErrors
    const failed = page.failedRequests
    check(`${video ?? 'no-camera'}: no console errors`, errs.length === 0, errs.slice(0, 3).map((e) => `${e.kind}: ${e.text}`).join(' | '))
    check(`${video ?? 'no-camera'}: no failed network requests`, failed.length === 0, failed.slice(0, 3).map((f) => `${f.status} ${f.url}`).join(' | '))
    await page.close()
  }
}

/** The judge view (Settings -> Demo and judging -> Show technical details), through the UI. */
async function judgeOn(page) {
  await page.goto(`${ORIGIN}/details/settings`)
  const on = await page.eval(`document.documentElement.dataset.judge === '1'`)
  if (!on) await page.click('Show technical details')
  await page.waitFor(`document.documentElement.dataset.judge === '1'`, { what: 'judge view on' })
}

/** The rows the app shows (stepper + coach pill) and the service's latest setup_checks. */
async function setupState(page) {
  const ui = await page.eval(`(() => ({
    pill: document.querySelector('.cs-coach-text')?.innerText ?? null,
    yes: document.querySelector('.cs-coach-yes')?.innerText ?? null,
    steps: [...document.querySelectorAll('.cs-step')].map((li) => li.querySelector('.cs-step-label').innerText + ':' + li.className.replace(/.*cs-step-/, '')),
    live: !!document.querySelector('.cs-live') && document.querySelector('.cs-live').innerText.includes('Live · not recording'),
    cont: [...document.querySelectorAll('.cs-continue')].map((b) => b.innerText)[0] ?? null,
  }))()`)
  const sc = page.events('setup_checks').at(-1)
  return { ui, checks: sc?.checks ?? [], allPass: sc?.all_required_pass ?? null }
}

/** On-screen alignment: the overlay canvas covers the video exactly and mirrors with it. */
async function overlayAlignment(page) {
  return page.eval(`(() => {
    const v = document.querySelector('video'); const c = v?.parentElement?.querySelector('canvas')
    if (!v || !c) return null
    const rv = v.getBoundingClientRect(), rc = c.getBoundingClientRect()
    const sv = getComputedStyle(v), sc = getComputedStyle(c)
    return { video: [rv.x, rv.y, rv.width, rv.height].map(Math.round), canvas: [rc.x, rc.y, rc.width, rc.height].map(Math.round),
      fit: sv.objectFit, vT: sv.transform + ' ' + sv.scale, cT: sc.transform + ' ' + sc.scale, vw: v.videoWidth, vh: v.videoHeight,
      // mirrored on screen: a negative x in either the transform matrix or the CSS \`scale\` property (Tailwind 4)
      vMirror: /^matrix[(]-1/.test(sv.transform) !== /^-/.test(sv.scale), cMirror: /^matrix[(]-1/.test(sc.transform) !== /^-/.test(sc.scale) }
  })()`)
}
function alignmentOk(a) {
  if (!a) return [false, 'no video/canvas']
  const same = a.video.every((x, i) => Math.abs(x - a.canvas[i]) <= 1)
  const mirrorSame = a.vMirror === a.cMirror
  // object-fit: cover crops the video when the box is not 4:3; the canvas would then be stretched
  const aspect = a.video[2] / a.video[3]
  const fitOk = a.fit !== 'cover' || Math.abs(aspect - 4 / 3) < 0.02
  return [same && mirrorSame && fitOk, `video ${a.video} canvas ${a.canvas} fit ${a.fit} aspect ${aspect.toFixed(3)} mirrored video ${a.vMirror} canvas ${a.cMirror} (${a.vT} / ${a.cT}) intrinsic ${a.vw}x${a.vh}`]
}

/** Overlay geometry from the service vs where the renderer put the sheet (raw frame px). */
function geometryError(clip, markersPx, targetsPx) {
  const g = INDEX[clip]?.geometry
  if (!g || !markersPx) return null
  let worst = 0
  for (const [id, c] of Object.entries(markersPx)) {
    const corners = c.length === 4 && Array.isArray(c[0]) ? c : null
    const centre = corners ? [corners.reduce((s, p) => s + p[0], 0) / 4, corners.reduce((s, p) => s + p[1], 0) / 4] : c
    const t = g.markers_px[id]
    if (t) worst = Math.max(worst, Math.hypot(centre[0] - t[0], centre[1] - t[1]))
  }
  for (const [i, p] of (targetsPx ?? []).entries()) {
    const t = g.targets_px[i]
    if (t && p) worst = Math.max(worst, Math.hypot(p[0] - t[0], p[1] - t[1]))
  }
  return worst
}

/** The first binary frame the browser sent: 8-byte capture time + JPEG. Saved so it can be
 *  inspected; ArUco ids only decode on an unmirrored image, so a calibrated fix with the right
 *  ids at the rendered positions is the proof that what is sent is unmirrored. */
function saveSentFrame(page, name) {
  const b64 = page.wsSent.find((p) => p.length > 1000)
  if (!b64) return null
  const buf = Buffer.from(b64, 'base64')
  const jpg = buf.subarray(8)
  const path = join(OUT, `sent_frame_${name}.jpg`)
  writeFileSync(path, jpg)
  return { path, jpeg: jpg[0] === 0xff && jpg[1] === 0xd8 }
}

/** The live screen's overlay: geometry from the service's `frame` events vs the rendered sheet,
 *  and the canvas sitting on (and mirrored with) the video. */
async function sessionOverlayChecks(page, label, clip, targetsKey) {
  const f = page.events('frame').filter((e) => e.overlay?.markers_px).at(-1)
  const err = geometryError(clip, f?.overlay?.markers_px, f?.overlay?.[targetsKey])
  check(`${label} live: overlay geometry (markers + ${targetsKey}) within 3 px of the rendered sheet`, err != null && err < 3, `max error ${err?.toFixed(2)} px`)
  const [ok, why] = alignmentOk(await overlayAlignment(page))
  check(`${label} live: overlay canvas aligned with the (mirrored) video`, ok, why)
}

// --- 1. Camera setup -------------------------------------------------------------------------

const SETUP_CASES = [
  // clip, exercise, expected failing row, expected words in the hint shown to the patient
  ['setup_nhpt_covered', 'nhpt', 'markers', /bottom-left corner/],
  ['setup_nhpt_dark', 'nhpt', 'lighting', /Too dark/],
  ['setup_nhpt_blur', 'nhpt', 'lighting', /blurry/],
  ['setup_nhpt_half_out', 'nhpt', 'markers', /top-left corner.*bottom-left corner|bottom-left corner.*top-left corner/],
]

async function setupGood(clip, exercise) {
  await withChrome(clip, async (page) => {
    await page.goto(`${ORIGIN}/details/setup?exercise=${exercise}&side=left`)
    await page.waitFor(`document.querySelector('.cs-live') !== null`, { what: 'camera live', timeout: 10000 })
    await sleep(5000)
    let s = await setupState(page)
    await shot(page, `setup_${exercise}_good`)
    const req = s.checks.filter((c) => ['camera', 'task_area', 'markers', 'angle', 'lighting'].includes(c.id))
    check(`setup ${exercise}: required rows Pass on the good clip`, s.allPass === true && req.every((c) => c.status === 'pass'), req.map((c) => `${c.id}=${c.status}`).join(' '))
    check(`setup ${exercise}: "Live · not recording" shown`, s.ui.live)
    check(`setup ${exercise}: "Continue anyway" exists`, (await page.buttons()).some((b) => /Continue anyway|^Continue/.test(b)), s.ui.cont)
    const cal = page.events('calibration').at(-1)
    const err = geometryError(clip, cal?.markers_px, cal?.targets_px)
    check(`setup ${exercise}: overlay geometry within 3 px of the rendered sheet`, err != null && err < 3, `max error ${err?.toFixed(2)} px`)
    const [ok, why] = alignmentOk(await overlayAlignment(page))
    check(`setup ${exercise}: overlay canvas aligned with the (mirrored) video`, ok, why)
    const sent = saveSentFrame(page, `setup_${exercise}`)
    check(`setup ${exercise}: frames sent unmirrored (ArUco ids decode at the rendered positions)`, !!sent?.jpeg && cal?.calibrated && cal.missing.length === 0 && err < 3, sent?.path)
    // the patient's own check, then the still-pose countdown and auto-continue into the session
    note(`setup ${exercise} pill: "${s.ui.pill}" · steps ${s.ui.steps.join(' ')}`)
    if (s.ui.yes) await page.click(s.ui.yes)
    let auto = false
    try {
      await page.waitFor(`location.pathname === '/session'`, { timeout: 12000, what: 'auto-continue to the session' })
      auto = true
    } catch {
      s = await setupState(page)
      note(`setup ${exercise} after 12 s: pill "${s.ui.pill}" · steps ${s.ui.steps.join(' ')}`)
    }
    check(`setup ${exercise}: good clip reaches the session by itself (self-check, still pose, auto-continue)`, auto)
  })
}

async function setupFailure(clip, exercise, row, hint) {
  await withChrome(clip, async (page) => {
    await page.goto(`${ORIGIN}/details/setup?exercise=${exercise}&side=left`)
    await page.waitFor(`document.querySelector('.cs-live') !== null`, { what: 'camera live', timeout: 10000 })
    await sleep(5000)
    // the patient's self-check first, if the pill offers it
    let s = await setupState(page)
    if (s.ui.yes) {
      await page.click(s.ui.yes)
      await sleep(1000)
      s = await setupState(page)
    }
    await shot(page, `setup_fail_${clip.replace('setup_nhpt_', '')}`)
    const r = s.checks.find((c) => c.id === row)
    check(`setup ${clip}: service row "${row}" is not Pass`, r && r.status !== 'pass', r ? `${r.status}: ${r.hint}` : 'row missing')
    check(`setup ${clip}: the hint the patient sees is the specific one`, hint.test(s.ui.pill ?? ''), `pill "${s.ui.pill}"`)
    if (clip === 'setup_nhpt_covered') {
      // the clip uncovers the corner after 10 s: the row must turn Pass
      await sleep(8000)
      const after = await setupState(page)
      const m = after.checks.find((c) => c.id === 'markers')
      await shot(page, 'setup_fail_covered_then_uncovered')
      check(`setup ${clip}: markers row turns Pass once the corner is uncovered`, m?.status === 'pass', `${m?.status} · pill "${after.ui.pill}"`)
    }
  })
}

// --- shared flow ----------------------------------------------------------------------------

async function checkIn(page) {
  await page.waitFor(`location.pathname === '/details/checkin'`, { what: 'check-in screen' })
  await shot(page, 'checkin')
  await page.click('2', { exact: true })
  await page.click('Left arm')
  await page.click('Nowhere')
  await page.click('Comfortable')
  await page.click('Full session')
  await page.click('Continue to camera setup')
}

/** Home -> Start session -> Choose -> Demonstration -> (check-in) -> Camera setup -> Session. */
async function flowToSession(page, name, exercise) {
  await page.goto(`${ORIGIN}/details`)
  await page.click('Start session')
  await page.waitFor(`location.pathname === '/details/choose'`)
  await page.click(`Start session@${name}`)
  await page.waitFor(`location.pathname === '/details/demo'`, { what: 'demonstration' })
  await sleep(1500)
  await shot(page, `${exercise}_demo`)
  // the demonstration plays, then "Before you start" offers the next step
  const cta = await page.waitFor(`[...document.querySelectorAll('button')].map((b) => b.innerText.trim()).find((t) => /^Continue( to (check-in|setup))?$/.test(t))`, { timeout: 60000, what: 'demonstration CTA' })
  await page.click(cta, { exact: true })
  await sleep(800)
  if (await page.eval(`location.pathname === '/details/checkin'`)) await checkIn(page)
  await page.waitFor(`location.pathname === '/details/setup'`, { what: 'camera setup' })
  await page.waitFor(`document.querySelector('.cs-live') !== null`, { what: 'camera live' })
  await sleep(4000)
  const s = await setupState(page)
  if (s.ui.yes) await page.click(s.ui.yes)
  try {
    await page.waitFor(`location.pathname === '/session'`, { timeout: 12000, what: 'auto-continue' })
  } catch {
    note(`${exercise}: setup did not continue by itself (pill "${s.ui.pill}"); tapping Continue`)
    await page.click('Continue')
  }
  await page.waitFor(`location.pathname === '/session'`)
  // Every getUserMedia restarts the clip: the session sees it from frame 0.
}

async function liveText(page) {
  return flat(await page.text())
}

/** Captions the coach showed, sampled every `every` ms until `until` is truthy. */
async function watch(page, { until, timeout, every = 500, onTick }) {
  const captions = new Set()
  const end = Date.now() + timeout
  let done = false
  while (Date.now() < end) {
    const cap = await page.eval(`document.querySelector('.sx-coach-text, .sx-caption, [data-testid=coach-caption]')?.innerText ?? null`).catch(() => null)
    if (cap) captions.add(flat(cap))
    if (onTick) await onTick()
    if (await page.eval(until).catch(() => false)) {
      done = true
      break
    }
    await sleep(every)
  }
  return { captions: [...captions], done }
}

async function openTrace(page) {
  const has = await page.eval(`[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Show trace')`)
  if (has) await page.click('Show trace', { exact: true })
  await sleep(1500)
  return flat(await page.eval(`(document.querySelector('[data-testid=trace-panel], .sx-trace, [aria-label*=trace i]') ?? document.body).innerText`))
}

async function latencyLine(page) {
  const t = await liveText(page)
  const m = /capture→event (-?[\d.]+)\/(-?[\d.]+) ms · event→cue (\S+)/.exec(t)
  const skew = await page.eval('performance.timeOrigin + performance.now() - Date.now()')
  return m ? { p50: +m[1], p95: +m[2], raw: `${m[0]} (perf clock - Date.now() ${skew.toFixed(1)} ms)` } : null
}

async function feedbackAndReport(page, exercise) {
  // 08 feedback overlay -> 09 report
  await sleep(1500)
  await shot(page, `${exercise}_end_of_session`)
  const before = await liveText(page)
  note(`${exercise} end screen: ${before.slice(0, 300)}`)
  await page.waitFor(`!!document.querySelector('[role=dialog]') || location.pathname.includes('/report')`, { timeout: 15000, what: 'feedback overlay' }).catch(() => null)
  for (let i = 0; i < 8 && !(await page.eval(`location.pathname.includes('/report')`)); i++) {
    // 08 feedback: answer each unanswered radio group (pain 2, else the first option), then Next
    await page.eval(`(() => {
      const d = document.querySelector('[role=dialog]'); if (!d) return
      for (const g of d.querySelectorAll('[role=radiogroup]')) {
        if (g.querySelector('[aria-checked=true]')) continue
        const r = [...g.querySelectorAll('[role=radio]')]
        ;(r.find((x) => x.getAttribute('aria-label') === '2') ?? r[0])?.click()
      }
    })()`)
    await sleep(300)
    const btns = await page.buttons()
    const next = btns.find((b) => /^(Next|Save and see report|See (my |the )?report|View report|Finish for today|Finish|Done)$/i.test(b))
    if (!next) break
    if (/Save and see report/.test(next)) await shot(page, `${exercise}_feedback_last_step`)
    await page.click(next, { exact: true })
    await sleep(1200)
  }
  const onReport = await page.eval(`location.pathname.includes('/report')`)
  await sleep(1500)
  await shot(page, `${exercise}_report`)
  return { onReport, text: await liveText(page) }
}

/** Waiter – cup is over: the done modal ("Finish for today") or the feedback is up. The
 *  progression prompt is a dialog too, so a dialog alone is not the end. */
const CUP_DONE = `location.pathname !== '/session' || /Finish for today|All 4 arcs complete|How much pain/.test(document.body.innerText)`

/** The progression prompt's accept button ("Yes, go faster"), if it is on screen. */
const progressionYes = (page) => page.eval(`[...document.querySelectorAll('button')].map((b) => b.innerText.trim()).find((t) => /^Yes, go faster$|^Yes$/.test(t)) ?? null`)

// --- 2. NHPT ---------------------------------------------------------------------------------

async function nhpt() {
  await withChrome('nhpt_session', async (page) => {
    await judgeOn(page)
    await flowToSession(page, 'Nine-Hole', 'nhpt')
    await sleep(2000)
    await shot(page, 'nhpt_live_start')
    await sessionOverlayChecks(page, 'nhpt', 'nhpt_session', 'holes_px')
    await openTrace(page) // the latency line lives in the trace header (judge view)
    const lat = []
    let lateShot = false
    const r = await watch(page, {
      until: `/9 of 9 seated/.test(document.body.innerText) || location.pathname !== '/session' || !!document.querySelector('[role=dialog]')`,
      timeout: 70000,
      onTick: async () => {
        if (lat.length < 200) lat.push(await latencyLine(page))
        if (!lateShot && /[6-8] of 9 seated/.test(await liveText(page))) {
          lateShot = true
          await shot(page, 'nhpt_live_trace_open')
        }
      },
    })
    const t = await liveText(page)
    const truth = INDEX.nhpt_session.marks
    const tStart = truth.find((m) => m.what === 'lift').t
    const tEnd = truth.filter((m) => m.what === 'seated').at(-1).t
    const truthTotal = tEnd - tStart
    const done = page.events('nhpt_complete').at(-1) ?? page.events('assessment_complete').at(-1)
    // count the test's own per-peg splits: the session ends on nhpt_complete (ninth seat), so the
    // ninth rep_complete (fired once the hand is clear) never arrives
    const holes = page.events('nhpt_split').map((e) => e.hole)
    const seated = holes.length
    const onScreen = (/\d of 9 seated/.exec(t) ?? [''])[0]
    check('nhpt: nine pegs counted live, each hole once', r.done && seated === 9 && new Set(holes).size === 9 && onScreen === '9 of 9 seated', `nhpt_split holes ${holes}; screen "${onScreen}"`)
    const timer = page.events('frame').map((f) => f.nhpt?.elapsed_s ?? f.timer?.elapsed_s).filter((x) => x != null)
    check('nhpt: timer runs (elapsed increases)', timer.length > 5 && timer.at(-1) > timer[0], `first ${timer[0]} last ${timer.at(-1)}`)
    note(`nhpt truth total ${truthTotal.toFixed(2)} s (clip)`)
    check('nhpt: verified / unverified counts shown', /\d+ verified · \d+ unverified/.test(t), (/\d+ verified · \d+ unverified/.exec(t) ?? [''])[0])
    check('nhpt: coach captions shown', r.captions.length > 0, r.captions.slice(0, 4).join(' | '))
    check('nhpt: rule coach labelled', /rule-based coach/i.test(t))
    const trace = flat(await page.eval(`document.querySelector('[data-testid=trace-rows]')?.parentElement?.innerText ?? ''`))
    check('nhpt: Show trace lists OpenCV event -> decision -> action', /rep_complete|peg/i.test(trace) && /(decision|coach|rule)/i.test(trace), trace.slice(0, 240))
    const l = lat.filter(Boolean).at(-1)
    check('latency line on the live screen is plausible', l && l.p50 > 0 && l.p50 < 1500 && l.p95 >= l.p50 && l.p95 < 5000, l ? l.raw : 'no latency line found')
    const rep = await feedbackAndReport(page, 'nhpt')
    check('nhpt: reached the report', rep.onReport, rep.text.slice(0, 200))
    const total = /(\d+(?:\.\d+)?)\s*s/.exec(rep.text)
    note(`nhpt report: ${rep.text.slice(0, 600)}`)
    check('nhpt: report shows 9 pegs and a total time near the clip truth', /9/.test(rep.text) && total, `truth ${truthTotal.toFixed(1)} s; report first time ${total?.[0]}; complete event ${JSON.stringify(done ?? {}).slice(0, 200)}`)
  })
}

// --- 3. Waiter - cup -------------------------------------------------------------------------

async function cup(clip = 'cup_session', label = 'cup') {
  await withChrome(clip, async (page) => {
    await judgeOn(page)
    await flowToSession(page, 'Waiter', label)
    await sleep(2000)
    await shot(page, `${label}_live_start`)
    await sessionOverlayChecks(page, label, clip, 'dots_px')
    let prompted = false
    let accepted = false
    const r = await watch(page, {
      until: CUP_DONE,
      timeout: 150000,
      every: 400,
      onTick: async () => {
        if (!accepted && (await progressionYes(page))) {
          prompted = true
          await shot(page, `${label}_progression_prompt`)
          await page.click(await progressionYes(page), { exact: true })
          accepted = true
        }
      },
    })
    await shot(page, `${label}_live_late`)
    const t = await liveText(page)
    const reaches = page.events().filter((e) => e.type === 'rep_complete' || e.type === 'reach_complete')
    const phases = new Set(page.events('frame').map((f) => f.cup?.phase).filter(Boolean))
    check(`${label}: progression prompt appeared and Yes was accepted`, prompted && accepted)
    check(`${label}: fast arcs ran after Yes`, phases.has('fast'), `phases seen ${[...phases]}`)
    check(`${label}: reaches counted (clip has 32)`, reaches.length >= 31 && reaches.length <= 32, `${reaches.length} reach events; screen ${(/\d+ verified · \d+ unverified/.exec(t) ?? [''])[0]}`)
    check(`${label}: coach captions shown`, r.captions.length > 0, r.captions.slice(0, 4).join(' | '))
    const rep = await feedbackAndReport(page, label)
    note(`${label} report: ${rep.text.slice(0, 600)}`)
    check(`${label}: reached the report`, rep.onReport)
  })
}

// --- 4. Perception loss ----------------------------------------------------------------------

async function loss() {
  await withChrome('nhpt_loss', async (page) => {
    await flowToSession(page, 'Nine-Hole', 'loss')
    let paused = null
    let resumed = false
    await watch(page, {
      until: `/9 of 9 seated/.test(document.body.innerText) || location.pathname !== '/session'`,
      timeout: 80000,
      onTick: async () => {
        const t = await liveText(page)
        if (!paused && /Tracking lost|Paused|can't see the sheet|cannot see the sheet/i.test(t)) {
          paused = t
          await shot(page, 'loss_paused')
        } else if (paused && !resumed && page.events('perception_regained').length) {
          resumed = true
          await sleep(1200)
          await shot(page, 'loss_resumed')
        }
      },
    })
    const lost = page.events('perception_lost')
    check('loss: perception_lost when the sheet leaves for ~4 s', lost.length > 0)
    check('loss: session pauses and says why', !!paused, paused ? paused.slice(paused.search(/Tracking lost|Paused/i), paused.search(/Tracking lost|Paused/i) + 160) : 'no pause copy seen')
    check('loss: resumes by itself when the sheet is back', resumed && page.events('perception_regained').length > 0)
    const done = page.events('nhpt_complete').at(-1)
    const holes = (done?.pegs ?? []).map((p) => p.hole)
    const m = INDEX.nhpt_loss.marks
    const truth = m.filter((x) => x.what === 'seated').at(-1).t - m.find((x) => x.what === 'lift').t
    check('loss: after the loss each hole is still counted once (no phantom peg)', holes.length === 9 && new Set(holes).size === 9, `holes ${holes}`)
    check('loss: NHPT time spans first lift to ninth seat (clip truth incl. the loss)', done && Math.abs(done.total_s - truth) < 1.0, `total ${done?.total_s?.toFixed(2)} s vs truth ${truth.toFixed(2)} s`)
    const rep = await feedbackAndReport(page, 'loss')
    check('loss: NHPT report marked limited after tracking loss', /limited/i.test(rep.text), rep.text.slice(0, 200))
  })
}

// --- 5. Replay -------------------------------------------------------------------------------

async function replay() {
  for (const [clip, ex, name] of [
    ['synthetic_nhpt_01', 'nhpt', 'Nine-Hole Peg Test'],
    ['synthetic_cup_01', 'cup', 'Waiter – cup'],
  ]) {
    await withChrome(null, async (page) => {
      await judgeOn(page)
      await page.click('Replay a recorded session')
      await sleep(1000)
      await page.click(`Replay ${name}`) // the row's aria-label
      await page.waitFor(`location.pathname === '/session'`, { what: 'replay session' })
      await sleep(2500)
      check(`replay ${clip}: Replay badge shown`, /Replay/.test(await liveText(page)))
      let accepted = false
      const r = await watch(page, {
        until: ex === 'nhpt' ? `/9 of 9 seated/.test(document.body.innerText) || location.pathname !== '/session'` : CUP_DONE,
        timeout: 150000,
        onTick: async () => {
          if (ex === 'cup' && !accepted && (await progressionYes(page))) {
            await page.click(await progressionYes(page), { exact: true })
            accepted = true
          }
        },
      })
      // the ninth rep_complete fires once the hand is clear, a moment after "9 of 9 seated"
      for (let i = 0; ex === 'nhpt' && i < 10 && page.events().filter((e) => e.type === 'rep_complete').length < 9; i++) await sleep(500)
      await shot(page, `replay_${ex}`)
      const reps = page.events().filter((e) => e.type === (ex === 'nhpt' ? 'rep_complete' : 'reach_complete')).length
      check(`replay ${clip}: runs to the end with counts`, r.done && reps >= (ex === 'nhpt' ? 9 : 28), `${reps} rep events${ex === 'cup' ? `, progression accepted ${accepted}` : ''}`)
    })
  }
}

// --- Arm out to the side: setup with no person ------------------------------------------------

async function arm() {
  await withChrome('setup_nhpt_good', async (page) => {
    await page.goto(`${ORIGIN}/details/setup?exercise=abduction&side=left`)
    await sleep(6000)
    const s = await setupState(page)
    await shot(page, 'arm_setup_no_person')
    check('arm setup: loads with no person and explains what to do', !!s.ui.pill && s.ui.steps.length > 0, `pill "${s.ui.pill}" · steps ${s.ui.steps.join(' ')}`)
  })
}

// --- 6. Agent on, covered marker mid-session ----------------------------------------------------

async function agent() {
  await withChrome('cup_covered', async (page) => {
    await judgeOn(page)
    await flowToSession(page, 'Waiter', 'agent')
    // the clip restarts with the session's getUserMedia: clip time ~= seconds since now
    const t0 = Date.now()
    const clipT = () => (Date.now() - t0) / 1000
    const marks = INDEX.cup_covered.marks
    const coveredAt = marks.find((m) => m.what === 'marker_covered').t
    const uncoveredAt = marks.find((m) => m.what === 'marker_uncovered').t
    let thinkingSeen = false
    let pausedAt = null
    let pausedCopy = null
    let resumeAt = null
    let accepted = false
    await openTrace(page)
    await watch(page, {
      until: CUP_DONE,
      timeout: 200000,
      every: 400,
      onTick: async () => {
        const t = await liveText(page)
        if (!thinkingSeen && /Coach is thinking/.test(t)) {
          thinkingSeen = true
          await shot(page, 'agent_thinking')
        }
        if (pausedAt == null && page.events('pause').length) {
          pausedAt = clipT()
          await sleep(300)
          pausedCopy = await liveText(page)
          await shot(page, 'agent_paused_covered_marker')
        }
        // the agent's resume offer ("Yes, resume") must come only once the corner is clear again
        const resume = await page.eval(`[...document.querySelectorAll('button')].map((b) => b.innerText.trim()).find((x) => x === 'Yes, resume') ?? null`)
        if (resume && resumeAt == null) {
          resumeAt = clipT()
          await shot(page, 'agent_resume_offered')
          await page.click(resume, { exact: true })
        }
        if (!accepted && (await progressionYes(page))) {
          await page.click(await progressionYes(page), { exact: true })
          accepted = true
        }
      },
    })
    await shot(page, 'agent_end')
    // a checkpoint run (e.g. the session end) may still be going: give it time to finish
    for (let i = 0; i < 40 && page.events('agent_status').at(-1)?.state === 'thinking'; i++) await sleep(500)
    const status = page.events('agent_status').map((e) => e.state)
    const agentLines = page.events('coach').filter((e) => e.source === 'agent')
    note(`agent lines: ${agentLines.map((e) => `"${e.text}"`).join(' | ').slice(0, 900)}`)
    check('agent: agent lines appear (source: agent)', agentLines.length > 0, `${agentLines.length} agent coach events`)
    check('agent: status chip goes thinking -> idle', thinkingSeen && status.includes('thinking') && status.at(-1) === 'idle', `states ${[...new Set(status)].join(',')}; last ${status.at(-1)}; "Coach is thinking…" seen ${thinkingSeen}`)
    const sid = page.events().find((e) => e.session_id)?.session_id
    const trace = sid ? await (await fetch(`${ORIGIN}/api/trace?session=${sid}`)).json() : null
    const rows = trace?.rows ?? []
    const tools = rows.filter((r) => r.kind === 'tool' || r.type === 'tool' || r.tool)
    note(`agent tool calls: ${tools.map((r) => `${r.tool ?? r.name}${r.ok === false ? ' ✕' : ''}`).join(', ').slice(0, 500)}`)
    const panel = flat(await page.eval(`document.querySelector('[data-testid=trace-rows]')?.innerText ?? ''`))
    check('agent: trace shows tool calls with OpenCV results', tools.length > 0 && /perception\.|check_setup|get_events/.test(panel), `${tools.length} tool rows; panel: ${panel.slice(0, 200)}`)
    // the clip covers the two bottom corners (markers 2 and 3): "bottom-right", "bottom two corners"
    const corner = /(top|bottom)[- ](left|right)|bottom (two )?corners|both bottom/i
    const paused = page.events('pause')[0]
    check('agent: the covered markers pause the session (stop rule)', !!paused, paused ? `${paused.rule}: ${paused.text} at clip ~${pausedAt?.toFixed(1)} s (markers covered ${coveredAt.toFixed(1)}-${uncoveredAt.toFixed(1)} s)` : 'no pause')
    const named = agentLines.find((e) => corner.test(e.text)) ?? (corner.test(pausedCopy ?? '') ? { text: 'on screen' } : null)
    check('agent: names the covered corners', !!named, named?.text ?? '')
    // A tracking-loss pause resumes by itself on `perception_regained`; a failed-reps pause waits
    // for the agent's "Yes, resume" (offered only after a fresh passing camera check). Either way
    // the session must not carry on while the corners are covered. Clip time of an event: its
    // wall time minus the wall time of the clip's first lift.
    const firstLift = page.events('reach_complete')[0]?.t_lift
    const offset = firstLift != null ? firstLift - marks.find((m) => m.what === 'lift').t : null
    const resumed = page.events('resume').map((e) => e.t - offset).filter((x) => x >= coveredAt && x < coveredAt + 60)
    const back = resumeAt ?? resumed[0]
    check('agent: resume only after the markers are back', back != null && back >= uncoveredAt - 0.5, `${resumeAt != null ? 'agent offered resume' : 'auto-resume on regain'} at clip ~${back?.toFixed(1)} s; markers uncovered at ${uncoveredAt.toFixed(1)} s`)
    await feedbackAndReport(page, 'agent')
  })
}

// --- run ---------------------------------------------------------------------------------------

const t0 = Date.now()
if (ONLY.includes('setup')) {
  await setupGood('setup_nhpt_good', 'nhpt')
  await setupGood('setup_cup_good', 'cup')
  for (const c of SETUP_CASES) await setupFailure(...c)
}
if (ONLY.includes('arm')) await arm()
if (ONLY.includes('nhpt')) await nhpt()
if (ONLY.includes('cup')) await cup()
if (ONLY.includes('loss')) await loss()
if (ONLY.includes('replay')) await replay()
if (ONLY.includes('agent')) await agent()

const failed = results.filter((r) => !r.pass)
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ origin: ORIGIN, seconds: Math.round((Date.now() - t0) / 1000), results, notes }, null, 1))
console.log(`\n${results.length - failed.length}/${results.length} checks passed · screenshots and results.json in ${OUT}`)
process.exit(failed.length ? 1 : 0)
