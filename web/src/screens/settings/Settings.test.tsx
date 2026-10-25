import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { readDay, writeDay, type DayCheckin } from '../../lib/day'
import { ME, mockApi } from '../../test/api-mock'
import { Settings } from './Settings'

/** Render, then let the three service calls (profile, replay list, health) settle. */
async function renderSettings(path = '/settings') {
  const r = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/session" element={<div>SESSION</div>} />
        <Route path="/details/checkin" element={<div>CHECKIN</div>} />
      </Routes>
    </MemoryRouter>,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return r
}

const SAM = { ...ME, name: 'Sam P.', goal: 'Lift a kettle safely.', program: { ...ME.program, short: 'Hospital GRASP L2 · v4 · Dr. Lee', clinician: 'Dr. Mia Lee, PT' } }
const NHPT_CLIP = { id: 'synthetic_nhpt_01', mode: 'nhpt', sheet: 'nhpt_board', path: 'synthetic_nhpt_01.mp4', synthetic: true }
const health = (agent?: Record<string, unknown>) => ({ status: 'ok', service: 'praxis-session', opencv_version: '5.0.0', mode: 'edge', models: {}, ...(agent ? { agent } : {}) })
const CHECKIN = (pain: number, tier: DayCheckin['tier']): DayCheckin => ({ pain, location: 'shoulder', energy: 'ok', minutes: 14, new_symptoms: false, side: 'left', tier, flagged: false, reasons: [], synced: true, at: '2026-10-06T09:00:00Z' })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  const d = document.documentElement.dataset
  for (const k of ['text', 'contrast', 'motion', 'judge', 'theme', 'themePref']) delete d[k]
})

async function openReplay() {
  fireEvent.click(screen.getByRole('button', { name: /^Replay a recorded session/ }))
  return screen.findByRole('dialog')
}

test('theme is a Light / Dark / Auto choice, dark by default', async () => {
  mockApi({})
  await renderSettings()
  const group = screen.getByRole('radiogroup', { name: 'Theme' })
  expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Light', 'Dark', 'Auto'])
  expect(within(group).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(within(group).getByRole('radio', { name: 'Light' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  fireEvent.click(within(group).getByRole('radio', { name: 'Auto' }))
  expect(document.documentElement.dataset.themePref).toBe('auto')
  expect(screen.getByText('Follows your device')).toBeInTheDocument()
})

test('profile and plan come from the service, never a seeded name', async () => {
  mockApi({ '/api/patients/me': SAM })
  await renderSettings()
  expect(await screen.findByText('Sam P.')).toBeInTheDocument()
  expect(screen.queryByText(/Alex M\./)).not.toBeInTheDocument()
  expect(screen.getByText(/goal: lift a kettle safely/)).toBeInTheDocument()
  expect(screen.getByText('Hospital GRASP L2 · v4 · Dr. Lee')).toBeInTheDocument()
  expect(screen.getByText('Read-only')).toBeInTheDocument()
  expect(screen.getAllByText(/Dr\. Mia Lee/).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: /^Sam P\./ }))
  expect(screen.getByText('CHECKIN')).toBeInTheDocument()
})

test('an unreachable service shows no invented profile', async () => {
  mockApi({})
  await renderSettings()
  expect(await screen.findByText(/Profile unavailable/)).toBeInTheDocument()
  expect(screen.queryByText(/Alex M\./)).not.toBeInTheDocument()
  expect(screen.queryByText(/Dr\. Anita Rao|Dr\. Rao/)).not.toBeInTheDocument()
})

test('replay clips open in a modal with the synthetic label and start a replay session', async () => {
  mockApi({ '/api/replay/list': { clips: [NHPT_CLIP] } })
  await renderSettings()
  expect(screen.queryByText('Nine-Hole Peg Test')).not.toBeInTheDocument()
  const dialog = await openReplay()
  expect(await within(dialog).findByText('Nine-Hole Peg Test')).toBeInTheDocument()
  expect(within(dialog).getByText('Computer-made clip')).toBeInTheDocument()
  expect(within(dialog).getByText(/same OpenCV pipeline and coach as a live session/)).toBeInTheDocument()
  expect(within(dialog).getByText('Left hand')).toBeInTheDocument() // the peg test is a hand task; "rendered" is said once, by the tag
  expect(within(dialog).queryByText(/rendered test clip/)).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Replay Nine-Hole Peg Test' }))
  expect(screen.getByText('SESSION')).toBeInTheDocument()
})

test('?replay=1 (No camera? from camera setup) opens the replay list straight away', async () => {
  mockApi({ '/api/replay/list': { clips: [NHPT_CLIP] } })
  await renderSettings('/settings?replay=1')
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('Nine-Hole Peg Test')).toBeInTheDocument()
  // the replay screen draws only what OpenCV found, so the list says so before a black panel surprises anyone
  expect(within(dialog).getByText(/not the video itself/)).toBeInTheDocument()
})

test('replay clips are named from the exercise registry, including arm clips by exercise id', async () => {
  mockApi({ '/api/replay/list': { clips: [{ id: 'arm_abd_01', mode: 'arm', exercise: 'abduction', sheet: 'none', path: 'a.mp4', synthetic: true }, { id: 'cup_01', mode: 'cup', sheet: 'cup_targets', path: 'c.mp4', synthetic: false }] } })
  await renderSettings()
  const dialog = await openReplay()
  expect(await within(dialog).findByText('Arm out to the side')).toBeInTheDocument()
  expect(within(dialog).getByText('Waiter – cup')).toBeInTheDocument()
  expect(within(dialog).queryByText('Arm to the front')).not.toBeInTheDocument()
  expect(within(dialog).getByText(/recorded with consent/)).toBeInTheDocument()
})

test('a clip of an exercise hidden on 28 Sep is never offered for replay', async () => {
  mockApi({ '/api/replay/list': { clips: [{ id: 'p01_pendulum_1', mode: 'pendulum', exercise: 'pendulum', sheet: 'none', path: 'p.mp4', synthetic: false }, { id: 'cup_01', mode: 'cup', sheet: 'cup_targets', path: 'c.mp4', synthetic: false }] } })
  await renderSettings()
  const dialog = await openReplay()
  expect(await within(dialog).findByText('Waiter – cup')).toBeInTheDocument()
  expect(within(dialog).getAllByRole('button', { name: /^Replay / })).toHaveLength(1)
  expect(within(dialog).queryByText(/pendulum/i)).not.toBeInTheDocument()
})

test('no recordings and an unreachable service are both said plainly', async () => {
  mockApi({ '/api/replay/list': { clips: [] } })
  const { unmount } = await renderSettings()
  expect(await within(await openReplay()).findByText(/No recordings available yet/)).toBeInTheDocument()
  unmount()
  mockApi({})
  await renderSettings()
  expect(await within(await openReplay()).findByText(/Could not list recordings/)).toBeInTheDocument()
})

test('guidance switches persist and apply at once; larger text is off by default', async () => {
  mockApi({})
  const { unmount } = await renderSettings()
  // larger text is off by default since 10 Oct (pages fit a 1336 x 759 laptop window at 16 px)
  const larger = screen.getByRole('switch', { name: 'Larger text' })
  expect(larger).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(larger)
  expect(JSON.parse(localStorage.getItem('praxis.guidance') ?? '{}').larger).toBe(true)
  expect(document.documentElement.dataset.text).toBe('large')
  unmount()
  await renderSettings()
  expect(screen.getByRole('switch', { name: 'Larger text' })).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(screen.getByRole('switch', { name: 'Larger text' }))
  expect(document.documentElement.dataset.text).toBeUndefined()
})

test('Audio: spoken coach cues are off by default (24 Oct), persist when switched on, and captions stay', async () => {
  mockApi({})
  const { unmount } = await renderSettings()
  const audio = screen.getByRole('switch', { name: 'Audio' })
  expect(audio).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(audio)
  expect(JSON.parse(localStorage.getItem('praxis.prefs') ?? '{}').audio).toBe(true)
  unmount()
  await renderSettings()
  expect(screen.getByRole('switch', { name: 'Audio' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByText(/captions are always shown too/i)).toBeInTheDocument()
})

test('display switches set attributes on the page and persist', async () => {
  mockApi({})
  await renderSettings()
  const d = document.documentElement.dataset
  fireEvent.click(screen.getByRole('switch', { name: 'High contrast' }))
  expect(d.contrast).toBe('high')
  fireEvent.click(screen.getByRole('switch', { name: 'Reduced motion' }))
  expect(d.motion).toBe('reduced')
  fireEvent.click(screen.getByRole('switch', { name: 'Show technical details' }))
  expect(d.judge).toBe('1')
  expect(JSON.parse(localStorage.getItem('praxis.prefs') ?? '{}')).toMatchObject({ contrast: true, motion: true, judge: true })
  fireEvent.click(screen.getByRole('switch', { name: 'Show technical details' }))
  expect(d.judge).toBeUndefined()
})

test('no decorative toggles or invented facts', async () => {
  mockApi({ '/api/patients/me': SAM })
  await renderSettings()
  await screen.findByText('Sam P.')
  for (const gone of [/Push to talk/, /Helper for setup/, /Reminder/i, /Delete account/, /Optional short clips/, /Mon–Fri/, /replies within/, /support@/, /^Support$/]) {
    expect(screen.queryByText(gone)).not.toBeInTheDocument()
  }
  expect(screen.queryByRole('switch', { name: /Captions$/ })).not.toBeInTheDocument()
})

test("reset today's check-in clears an ordinary check-in on this device", async () => {
  mockApi({})
  writeDay({ ...readDay(), checkin: CHECKIN(2, 'full') })
  await renderSettings()
  const reset = screen.getByRole('button', { name: /^Reset today's check-in/ })
  expect(reset).toHaveTextContent('Checked in today · pain 2')
  fireEvent.click(reset)
  expect(screen.getByRole('status')).toHaveTextContent("Today's check-in was cleared on this device.")
  expect(readDay().checkin).toBeNull()
  expect(screen.getByRole('button', { name: /^Reset today's check-in/ })).toBeDisabled()
})

test('a rest day is not wiped, but the row offers to check in again (25 Oct: it said it could not be reset)', async () => {
  mockApi({})
  writeDay({ ...readDay(), checkin: CHECKIN(8, 'rest'), stopped: 'rest' })
  await renderSettings()
  const row = screen.getByRole('button', { name: /^Reset today's check-in/ })
  expect(row).toHaveTextContent('Today says rest · tap to check in again')
  fireEvent.click(row)
  expect(screen.getByText('CHECKIN')).toBeInTheDocument()
  expect(readDay().stopped).toBe('rest')
})

test('a day a stop rule ended cannot be reset', async () => {
  mockApi({})
  writeDay({ ...readDay(), checkin: CHECKIN(2, 'full'), stopped: 'session' })
  await renderSettings()
  const reset = screen.getByRole('button', { name: /^Reset today's check-in/ })
  expect(reset).toBeDisabled()
  expect(reset).toHaveTextContent("A stop rule ended today, so it can't be reset")
  fireEvent.click(reset)
  expect(readDay().stopped).toBe('session')
})

test('the theme row names Dark as the default (24 Oct)', async () => {
  mockApi({})
  await renderSettings()
  fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
  expect(document.body.textContent).not.toMatch(/Light is the default/)
  fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
  expect(screen.getByText(/Low-glare navy · the default/)).toBeInTheDocument()
})

test('privacy, cloud and help rows say what is real', async () => {
  mockApi({})
  await renderSettings()
  // jsdom runs on localhost, so the edge wording applies; hosted builds say "on the Praxis service"
  expect(screen.getByText('On this device, never stored')).toBeInTheDocument()
  expect(screen.getByText('Default')).toBeInTheDocument()
  expect(screen.getByText('Edge mode · this laptop')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Camera setup/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Equipment and sheets/ })).toBeInTheDocument()
  // push-to-talk was removed on 21 Oct: nothing promises a microphone
  expect(screen.queryByText(/microphone/i)).not.toBeInTheDocument()
})

test('export my data downloads the service record and this device, as JSON', async () => {
  const fetchMock = mockApi({ '/api/patients/me': SAM, '/api/sessions': { sessions: [] } })
  const createObjectURL = vi.fn(() => 'blob:x')
  const saved = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    await renderSettings()
    fireEvent.click(screen.getByRole('button', { name: /^Export my data/ }))
    await vi.waitFor(() => expect(click).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/sessions'))).toBe(true)
  } finally {
    click.mockRestore()
    Object.assign(URL, saved)
  }
})

test('Coach row: Claude Sonnet 5 via the Anthropic API with MCP tools connected', async () => {
  mockApi({ '/health': health({ mode: 'anthropic', model: 'claude-sonnet-5', mcp: true, ready: true }) })
  await renderSettings()
  expect(await screen.findByText('Claude Sonnet 5 via Anthropic API')).toBeInTheDocument()
  expect(screen.getByText('MCP tools connected')).toBeInTheDocument()
})

test('Coach row: Anthropic API not ready says why and that the rule coach runs', async () => {
  mockApi({ '/health': health({ mode: 'anthropic', model: 'claude-haiku-5-5', mcp: false, ready: false, reason: 'ANTHROPIC_API_KEY is not set' }) })
  await renderSettings()
  expect(await screen.findByText('Claude Haiku 5.5 via Anthropic API')).toBeInTheDocument()
  expect(screen.getByText(/Not ready: ANTHROPIC_API_KEY is not set · the rule-based coach runs/)).toBeInTheDocument()
})

test('Coach row: off (or a service without the agent field) reads as the rule-based coach', async () => {
  mockApi({ '/health': health({ mode: 'off', model: '', mcp: false, ready: false }) })
  const { unmount } = await renderSettings()
  expect(await screen.findByText('Rule-based coach (AI agent off)')).toBeInTheDocument()
  unmount()
  mockApi({ '/health': health() })
  await renderSettings()
  expect(await screen.findByText('Rule-based coach (AI agent off)')).toBeInTheDocument()
})

test('Coach row: an unreachable service says so instead of guessing', async () => {
  mockApi({})
  await renderSettings()
  expect(await screen.findByText(/Coach status unavailable/)).toBeInTheDocument()
})
