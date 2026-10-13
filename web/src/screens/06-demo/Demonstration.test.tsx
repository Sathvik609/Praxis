import { act, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MutableRefObject, ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const ctl = vi.hoisted(() => ({ replay: vi.fn() }))

// The theater's figure is the real AvatarPanel elsewhere (AvatarPanel.test.tsx); here it is a stub
// that exposes what the screen hands it and lets a test finish the clip.
vi.mock('../../avatar/AvatarPanel', () => ({
  AvatarPanel: (p: { theater?: boolean; limitDeg?: number; holdS?: number; side: string; patientSide?: string; onComplete?: () => void; ctlRef?: MutableRefObject<unknown> }) => {
    if (p.ctlRef) p.ctlRef.current = { replay: ctl.replay }
    return (
      <div data-testid="avatar" data-theater={String(!!p.theater)} data-limit={p.limitDeg ?? ''} data-hold={p.holdS ?? ''} data-side={p.side} data-patient-side={p.patientSide}>
        <button type="button" onClick={p.onComplete}>finish clip</button>
      </div>
    )
  },
}))

import { readDay, todayKey, writeSide } from '../../lib/day'
import { mockApi, PRESCRIPTION } from '../../test/api-mock'
import { Demonstration } from './Demonstration'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  ctl.replay.mockClear()
})

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

function DemoAt({ id, side = 'left' }: { id: string; side?: string | null }) {
  return (
    <MemoryRouter initialEntries={[`/details/demo?exercise=${id}${side ? `&side=${side}` : ''}`]}>
      <Routes>
        <Route path="/details/demo" element={<Demonstration />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

/** Render, then let the prescription request settle inside act. */
async function render(ui: ReactElement) {
  const r = rtlRender(ui)
  await act(async () => {})
  return r
}

const HOUR = 3600e3
function seedDay(d: { checkin?: { pain: number; at?: number; tier?: string; new_symptoms?: boolean } | null; stopped?: string | null; lastPainAfter?: number | null }) {
  const c = d.checkin
  localStorage.setItem(
    'praxis.day',
    JSON.stringify({
      date: todayKey(),
      checkin: c ? { pain: c.pain, location: 'shoulder', energy: 'comfortable', minutes: 14, new_symptoms: c.new_symptoms ?? false, side: 'left', tier: c.tier ?? (c.pain >= 7 ? 'rest' : c.pain >= 4 ? 'gentle' : 'full'), flagged: false, reasons: [], synced: true, at: new Date(c.at ?? Date.now()).toISOString() } : null,
      done: [],
      demosSeen: [],
      current: null,
      finished: [],
      stopped: d.stopped ?? null,
      lastPainAfter: d.lastPainAfter ?? null,
    }),
  )
}

const finishClip = () => act(() => screen.getByRole('button', { name: 'finish clip' }).click())
const posted = (fetchMock: ReturnType<typeof mockApi>, path: string) =>
  fetchMock.mock.calls.filter(([u, init]) => String(u).includes(path) && init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)))

test('the demonstration is the artifact theater: title, side, day position, mirrored figure, stop line', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  seedDay({ checkin: { pain: 2 } })
  await render(<DemoAt id="abduction" />)
  const theater = screen.getByTestId('demo-theater')
  expect(within(theater).getByRole('heading', { level: 1, name: 'Arm out to the side' })).toBeInTheDocument()
  expect(screen.getByText('Demonstration · Arm strengthening · shoulder · Left arm')).toBeInTheDocument()
  expect(screen.getByTestId('day-title')).toHaveTextContent('Exercise 1 of 2')
  const fig = screen.getByTestId('avatar')
  expect(fig).toHaveAttribute('data-theater', 'true')
  expect(fig).toHaveAttribute('data-side', 'right') // mirrored so it faces the patient
  expect(fig).toHaveAttribute('data-patient-side', 'left')
  expect(screen.getByText('Stop if your pain rises or you feel dizzy.')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('opening the demonstration records the exercise as the day\'s current one', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  await render(<DemoAt id="abduction" />)
  expect(readDay().current).toBe('abduction')
})

test('Exit goes back to Choose exercise', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  await render(<DemoAt id="cup" />)
  await userEvent.click(screen.getByRole('button', { name: 'Exit' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/details/choose')
})

test('when the clip ends, "Before you start" lists target, watch-for and stop-if; Watch again replays', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  seedDay({ checkin: { pain: 2 } })
  await render(<DemoAt id="abduction" />)
  finishClip()
  const modal = screen.getByRole('dialog', { name: 'Before you start' })
  expect(within(modal).getByText('Arm out to the side · Left arm')).toBeInTheDocument()
  expect(within(modal).getByText('Your target')).toBeInTheDocument()
  expect(within(modal).getByText('2 × 8 · hold 3 s · no higher than shoulder')).toBeInTheDocument()
  expect(within(modal).getByText('Watch for')).toBeInTheDocument()
  expect(within(modal).getByText('Stop if')).toBeInTheDocument()
  expect(within(modal).getByText(/The figure is a reference only\. Your reps are checked by the camera/)).toBeInTheDocument()
  await userEvent.click(within(modal).getByRole('button', { name: 'Watch again' }))
  expect(ctl.replay).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog', { name: 'Before you start' })).toBeNull()
})

test('without a check-in today the CTA goes to check-in with the exercise and side', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  await render(<DemoAt id="cup" side="right" />)
  finishClip()
  await userEvent.click(screen.getByRole('button', { name: 'Continue to check-in' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/details/checkin?next=cup&side=right')
  expect(readDay().demosSeen).toContain('cup')
})

test('a recent check-in goes straight to camera setup', async () => {
  const fetchMock = mockApi({ '/api/prescription': PRESCRIPTION })
  seedDay({ checkin: { pain: 2, at: Date.now() - 0.5 * HOUR } })
  await render(<DemoAt id="abduction" />)
  finishClip()
  await userEvent.click(screen.getByRole('button', { name: 'Continue to setup' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/details/setup?exercise=abduction&side=left')
  expect(posted(fetchMock, '/api/checkin')).toHaveLength(0)
})

test('quick pain check goes through the service and stops at 7', async () => {
  const fetchMock = mockApi({ '/api/prescription': PRESCRIPTION, '/api/checkin': { tier: 'rest', flagged: true, reasons: ['pain 8 ≥ 7'] } })
  seedDay({ checkin: { pain: 2, at: Date.now() - 3 * HOUR } }) // older than 2 h → needPain
  await render(<DemoAt id="abduction" />)
  finishClip()
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  const check = screen.getByRole('dialog', { name: 'Quick pain check' })
  await userEvent.click(within(check).getByRole('radio', { name: '8' }))
  await userEvent.click(within(check).getByRole('button', { name: 'Continue to setup' }))
  expect(await screen.findByText(/rest today/i)).toBeInTheDocument()
  expect(posted(fetchMock, '/api/checkin')).toEqual([expect.objectContaining({ pain: 8, new_symptoms: false })])
  expect(screen.getByText('Your therapist has been told.')).toBeInTheDocument()
  expect(readDay().stopped).toBe('rest')
  expect(readDay().checkin).toMatchObject({ pain: 8, tier: 'rest', flagged: true })
  expect(screen.queryByTestId('where')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Back to Home' }))
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/details$/)
})

test('a high pain-after from the last session asks again; a low answer goes on to setup', async () => {
  const fetchMock = mockApi({ '/api/prescription': PRESCRIPTION, '/api/checkin': { tier: 'full', flagged: false, reasons: [] } })
  seedDay({ checkin: { pain: 2 }, lastPainAfter: 5 })
  await render(<DemoAt id="cup" />)
  finishClip()
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await userEvent.click(screen.getByRole('radio', { name: '3' }))
  await userEvent.click(screen.getByRole('button', { name: 'Continue to setup' }))
  expect(await screen.findByTestId('where')).toHaveTextContent('/details/setup?exercise=cup&side=left')
  expect(posted(fetchMock, '/api/checkin')).toEqual([expect.objectContaining({ pain: 3 })])
  expect(readDay().lastPainAfter).toBeNull()
  expect(readDay().checkin?.pain).toBe(3)
})

test('the limit line comes from the prescription, not the dose text (gentle → lower bound)', async () => {
  const rx = { ...PRESCRIPTION, allowed_adaptations: { ...PRESCRIPTION.allowed_adaptations, abduction: { hold_s: [2, 3], target_deg: [55, 90], reps: [6, 8] } } }
  mockApi({ '/api/prescription': rx })
  seedDay({ checkin: { pain: 5 } }) // gentle: dose text says "up to 60°"
  await render(<DemoAt id="abduction" />)
  expect(await screen.findByTestId('avatar')).toHaveAttribute('data-hold', '2')
  await waitFor(() => expect(screen.getByTestId('avatar')).toHaveAttribute('data-limit', '55'))
})

test('a full day shows the prescribed abduction target as the limit', async () => {
  mockApi({ '/api/prescription': { ...PRESCRIPTION, exercises: { ...PRESCRIPTION.exercises, abduction: { ...PRESCRIPTION.exercises.abduction, target_deg: 80 } } } })
  seedDay({ checkin: { pain: 1 } })
  await render(<DemoAt id="abduction" />)
  await waitFor(() => expect(screen.getByTestId('avatar')).toHaveAttribute('data-limit', '80'))
  expect(screen.getByTestId('avatar')).toHaveAttribute('data-hold', '3')
})

test('the cup and peg test draw no angle limit', async () => {
  const fetchMock = mockApi({ '/api/prescription': PRESCRIPTION })
  await render(<DemoAt id="cup" />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(screen.getByTestId('avatar')).toHaveAttribute('data-limit', '')
})

test.each(['pendulum', 'arm', 'flexion', 'external_rotation', 'internal_rotation'])('a deep link to hidden %s goes back to Choose and shows nothing of it', async (id) => {
  const fetchMock = mockApi({})
  await render(<DemoAt id={id} />)
  expect(screen.getByTestId('where')).toHaveTextContent('/details/choose')
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)/)
  expect(fetchMock).not.toHaveBeenCalled()
})

test('without a side in the link the saved side is used, not a silent left', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  writeSide('right')
  await render(<DemoAt id="abduction" side={null} />)
  expect(screen.getByText(/· Right arm$/)).toBeInTheDocument()
})

test('a day stopped at check-in lets you watch but not start', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  seedDay({ checkin: { pain: 8 }, stopped: 'rest' })
  await render(<DemoAt id="abduction" />)
  finishClip()
  const modal = screen.getByRole('dialog', { name: 'Before you start' })
  expect(within(modal).getByText(/No exercises today/)).toBeInTheDocument()
  expect(within(modal).getByRole('button', { name: /^Continue/ })).toBeDisabled()
})

// 13 Oct team test: returning testers wanted to go straight on without watching the clip.
test('Skip demo goes straight on to camera setup without waiting for the clip', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  seedDay({ checkin: { pain: 2, at: Date.now() - 0.5 * HOUR } })
  await render(<DemoAt id="abduction" />)
  await userEvent.click(screen.getByRole('button', { name: 'Skip demo' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/details/setup?exercise=abduction&side=left')
  expect(readDay().demosSeen).toContain('abduction')
})

test('Skip demo without a check-in today still goes through the check-in', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  await render(<DemoAt id="cup" side="right" />)
  await userEvent.click(screen.getByRole('button', { name: 'Skip demo' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/details/checkin?next=cup&side=right')
})

test('a day stopped at check-in offers no Skip demo', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  seedDay({ checkin: { pain: 8 }, stopped: 'rest' })
  await render(<DemoAt id="abduction" />)
  expect(screen.queryByRole('button', { name: 'Skip demo' })).toBeNull()
})
