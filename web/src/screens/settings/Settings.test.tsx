import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { mockApi } from '../../test/api-mock'
import { Settings } from './Settings'

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/session" element={<div>SESSION</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.text
})

test('settings switches theme and lists replay clips with a replay entry', async () => {
  mockApi({ '/api/replay/list': { clips: [{ id: 'synthetic_nhpt_01', mode: 'nhpt', sheet: 'nhpt_board', path: 'synthetic_nhpt_01.mp4', synthetic: true }] } })
  renderSettings()
  fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(await screen.findByText('Nine-Hole Peg Test')).toBeInTheDocument()
  expect(screen.getByText('Synthetic render')).toBeInTheDocument()
  // jsdom runs on localhost, so the edge wording applies; hosted builds say "on the Praxis service"
  expect(screen.getByText(/Video is processed on this device, never stored\. Only events/)).toBeInTheDocument()
  expect(screen.queryByText(/Everything runs on this device/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Replay Nine-Hole Peg Test' }))
  expect(screen.getByText('SESSION')).toBeInTheDocument()
})

test('guidance checkboxes persist to localStorage and load back', async () => {
  mockApi({ '/api/replay/list': { clips: [] } })
  const { unmount } = renderSettings()
  expect(screen.getByLabelText(/^Spoken instructions/)).not.toBeChecked()
  expect(screen.getByLabelText(/^Larger text/)).not.toBeChecked()
  fireEvent.click(screen.getByLabelText(/^Larger text/))
  expect(JSON.parse(localStorage.getItem('praxis.guidance') ?? '{}').larger).toBe(true)
  // larger text is real: the root font scales at once
  expect(document.documentElement.dataset.text).toBe('large')
  expect(await screen.findByText(/No recordings available yet/)).toBeInTheDocument()
  unmount()
  renderSettings()
  expect(screen.getByLabelText(/^Larger text/)).toBeChecked()
})

test('replay clips are named from the exercise registry, including arm clips by exercise id', async () => {
  mockApi({ '/api/replay/list': { clips: [{ id: 'arm_abd_01', mode: 'arm', exercise: 'abduction', sheet: 'none', path: 'a.mp4', synthetic: true }, { id: 'cup_01', mode: 'cup', sheet: 'cup_targets', path: 'c.mp4', synthetic: false }] } })
  renderSettings()
  expect(await screen.findByText('Arm out to the side')).toBeInTheDocument()
  expect(screen.getByText('Waiter – cup')).toBeInTheDocument()
  expect(screen.queryByText('Arm to the front')).not.toBeInTheDocument()
})

test('a clip of an exercise hidden on 28 Sep is never offered for replay', async () => {
  mockApi({ '/api/replay/list': { clips: [{ id: 'p01_pendulum_1', mode: 'pendulum', exercise: 'pendulum', sheet: 'none', path: 'p.mp4', synthetic: false }, { id: 'cup_01', mode: 'cup', sheet: 'cup_targets', path: 'c.mp4', synthetic: false }] } })
  renderSettings()
  expect(await screen.findByText('Waiter – cup')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^Replay / })).toHaveLength(1)
  expect(screen.queryByText(/pendulum/i)).not.toBeInTheDocument()
})

test('no decorative toggles: captions are stated as always on, and there is no setup-helper toggle', async () => {
  mockApi({ '/api/replay/list': { clips: [] } })
  renderSettings()
  expect(screen.queryByLabelText(/^Captions/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/Helper for setup/)).not.toBeInTheDocument()
  expect(screen.getByText(/Captions are always on/)).toBeInTheDocument()
  await screen.findByText(/No recordings available yet/)
})

const health = (agent?: Record<string, unknown>) => ({ status: 'ok', service: 'praxis-session', opencv_version: '5.0.0', mode: 'edge', models: {}, ...(agent ? { agent } : {}) })

test('Coach line: Claude Sonnet 5 via the Anthropic API (dev) with MCP tools connected', async () => {
  mockApi({ '/api/replay/list': { clips: [] }, '/health': health({ mode: 'anthropic', model: 'claude-sonnet-5', mcp: true, ready: true }) })
  renderSettings()
  const card = screen.getByRole('heading', { name: 'Coach' }).closest('section')!
  expect(await within(card).findByText('Claude Sonnet 5 via Anthropic API (dev)')).toBeInTheDocument()
  expect(within(card).getByText('MCP tools connected')).toBeInTheDocument()
})

test('Coach line: Bedrock, not ready, says why and that the rule coach runs', async () => {
  mockApi({ '/api/replay/list': { clips: [] }, '/health': health({ mode: 'bedrock', model: 'us.anthropic.claude-sonnet-5-v1:0', mcp: false, ready: false, reason: 'PRAXIS_CLOUD_ENABLED is 0' }) })
  renderSettings()
  expect(await screen.findByText('Claude Sonnet 5 via Amazon Bedrock')).toBeInTheDocument()
  expect(screen.getByText(/Not ready: PRAXIS_CLOUD_ENABLED is 0 · the rule-based coach runs/)).toBeInTheDocument()
})

test('Coach line: off (or a service without the agent field) reads as the rule-based coach', async () => {
  mockApi({ '/api/replay/list': { clips: [] }, '/health': health({ mode: 'off', model: '', mcp: false, ready: false }) })
  const { unmount } = renderSettings()
  expect(await screen.findByText('Off — rule-based coach')).toBeInTheDocument()
  unmount()
  mockApi({ '/api/replay/list': { clips: [] }, '/health': health() })
  renderSettings()
  expect(await screen.findByText('Off — rule-based coach')).toBeInTheDocument()
})

test('Coach line: an unreachable service says so instead of guessing', async () => {
  mockApi({ '/api/replay/list': { clips: [] } })
  renderSettings()
  expect(await screen.findByText(/Coach status unavailable/)).toBeInTheDocument()
})
