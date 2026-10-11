import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { PraxisEvent } from '../../lib/events'
import { statusLabel } from '../../session/liveStatus'
import type { CoachEvent, Overlay } from '../../session/useCoach'
import { SessionHeader, SxBar, SxCoach, SxEndDialog, SxFeed, SxHold, SxStats, sxClock, sxHold, useHoldSeconds, useSxSession } from './SessionChrome'
import { TracePanel } from './TracePanel'
import { mockApi, PRESCRIPTION } from '../../test/api-mock'

test('the judge line has its own row at the foot of the feed, not the top-right band stack (e2e 11 Oct)', () => {
  // The NHPT line ("OpenCV 5 · findContours + HoughCircles occupancy · ...") is wider than the
  // top-right stack, which grows leftwards over the "You" tag; at the foot it truncates instead.
  const { container } = render(
    <SxFeed replay={false} camActive status="tracking" videoRef={{ current: null }} frame={null} note="left hand" band="Cup found" mono="OpenCV 5 · findContours + HoughCircles occupancy · holes: hough · dnn hand · 44 fps max" onRetry={() => {}} />,
  )
  const mono = screen.getByText(/findContours/)
  expect(mono).toHaveClass('sx-mono', 'sx-mono-row')
  expect(mono.closest('.sx-foot')).toBeNull()
  expect(container.querySelector('.sx-foot')).toHaveTextContent('Cup found')
})

const barProps = () => ({
  onPause: vi.fn(),
  onRest: vi.fn(),
  onPain: vi.fn(),
  onEnd: vi.fn(),
  traceOpen: false,
  onTrace: vi.fn(),
})

const statsProps = { metricLabel: 'Lifts', metric: '3 of 8', head: 'Rep 3 of 8', dots: null }

type CoachLike = Parameters<typeof sxHold>[0]
function coachWithOverlay(o: Overlay | null, decisions: CoachEvent[] = []): CoachLike {
  return { overlay: o, decisions, clearOverlay: vi.fn() }
}
const noRest = { since: null, start: vi.fn(), end: vi.fn(), cancel: vi.fn() }
const noPrompt = { prompt: null }

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('SxBar', () => {
  it('bar always offers Pause, Take a rest, Pain / feel unwell, End session (artifact .sx-btn look)', () => {
    render(<SxBar {...barProps()} />)
    for (const n of ['Pause', 'Take a rest', 'Pain / feel unwell', 'End session']) expect(screen.getByRole('button', { name: n })).toHaveClass('sx-btn')
  })

  it('fires each control', () => {
    const p = barProps()
    render(<SxBar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'Take a rest' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pain / feel unwell' }))
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
    expect(p.onPause).toHaveBeenCalled()
    expect(p.onRest).toHaveBeenCalled()
    expect(p.onPain).toHaveBeenCalled()
    expect(p.onEnd).toHaveBeenCalled()
    expect(p.onTrace).toHaveBeenCalled()
  })

  it('Show trace is the artifact link button (CSS shows it in Judge view only) and says its state', () => {
    render(<SxBar {...barProps()} traceOpen />)
    const trace = screen.getByRole('button', { name: 'Hide trace' })
    expect(trace).toHaveClass('sx-trace-btn')
    expect(trace).toHaveAttribute('aria-pressed', 'true')
  })

  it('no hands-free voice hint: no voice commands exist', () => {
    render(<SxBar {...barProps()} />)
    expect(screen.queryByText(/Hands free/)).toBeNull()
    expect(screen.queryByText(/Praxis, rest/)).toBeNull()
  })

  it('Take a rest is disabled while resting', () => {
    render(<SxBar {...barProps()} resting />)
    expect(screen.getByRole('button', { name: 'Take a rest' })).toBeDisabled()
    // the safety controls never are
    expect(screen.getByRole('button', { name: 'Pain / feel unwell' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'End session' })).toBeEnabled()
  })

  it('has no voice volume and no captions switch: the coach is caption-only, captions always on', () => {
    render(<SxBar {...barProps()} />)
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })
})

describe('SessionHeader', () => {
  it('header shows Live · not recording when the camera is on', () => {
    render(<SessionHeader title="x" sub="y" live status="tracking" label={statusLabel('tracking', 'arm')} />)
    expect(screen.getByText('Live · not recording')).toBeVisible()
    expect(screen.getByText('Live · not recording')).toHaveClass('sx-rec')
    expect(screen.getByRole('status')).toHaveTextContent('Tracking')
  })

  it('replay says so in the header', () => {
    render(<SessionHeader title="x" sub="y" live replay status="replay" label={statusLabel('replay', 'arm')} />)
    expect(screen.getByText('Replay · processed on the service')).toBeVisible()
    expect(screen.queryByText('Live · not recording')).toBeNull()
  })

  it('no marker while the camera is off', () => {
    render(<SessionHeader title="x" sub="y" status="connecting" label={statusLabel('connecting', 'arm')} />)
    expect(screen.queryByText('Live · not recording')).toBeNull()
  })

  it('keeps the agent status chip', () => {
    render(<SessionHeader title="x" sub="y" live status="tracking" label={statusLabel('tracking', 'arm')} agent={{ state: 'thinking', trigger: 'set_complete', label: 'Claude agent' }} />)
    expect(screen.getByTestId('agent-status')).toHaveTextContent('Coach is thinking…')
  })
})

describe('SxCoach', () => {
  it('coach label is visible text, not a tooltip', () => {
    render(<SxCoach caption="Lift slowly" label="Rule-based coach · LLM agent pending" source="rule" />)
    expect(screen.getByText('Rule-based coach · LLM agent pending')).toBeVisible()
    expect(screen.getByText('Lift slowly')).toHaveClass('sx-coach-text')
  })

  it('rule and agent differ by label text and icon, never by colour alone', () => {
    const { container } = render(<SxCoach caption="Move the cup left." label="Claude agent · Amazon Bedrock" source="agent" />)
    expect(screen.getByText('Claude agent · Amazon Bedrock').closest('[data-source]')).toHaveAttribute('data-source', 'agent')
    const agentIcon = container.querySelector('[data-source="agent"] svg')?.getAttribute('class')
    const { container: rule } = render(<SxCoach caption="x" label="Rule-based coach" source="rule" />)
    const ruleIcon = rule.querySelector('[data-source="rule"] svg')?.getAttribute('class')
    expect(agentIcon).toBeTruthy()
    expect(agentIcon).not.toEqual(ruleIcon)
  })

  it('eyebrow and tone use the artifact classes', () => {
    const { container } = render(<SxCoach caption="That's dot 4; next is dot 3." label="Rule-based coach" source="rule" eyebrow="Coach · Correction" tone="amber" />)
    expect(screen.getByText('Coach · Correction')).toBeInTheDocument()
    expect(container.querySelector('section')).toHaveClass('sx-coach', 'cup-coach-amber')
  })

  it('watch is the posture eyebrow', () => {
    const { container } = render(<SxCoach caption="Sit tall." label="Rule-based coach" source="rule" watch />)
    expect(screen.getByText('Coach · posture')).toBeInTheDocument()
    expect(container.querySelector('section')).toHaveClass('sx-coach-watch')
  })

  it('always shows the caption: there is no captions-off state', () => {
    render(<SxCoach caption="Lift slowly" label="Rule-based coach" source="rule" />)
    expect(screen.getByText('Lift slowly')).toBeInTheDocument()
    expect(screen.queryByText(/Captions are off/)).toBeNull()
  })
})

describe('SxStats', () => {
  it('stats always show verified and unverified', () => {
    render(<SxStats {...statsProps} verified={5} unverified={2} />)
    expect(screen.getByText('5 verified · 2 unverified')).toBeInTheDocument()
  })

  it('zero counts still show, alongside the sub line and extra', () => {
    render(<SxStats {...statsProps} verified={0} unverified={0} sub="hand covered the cup or markers lost" extra={<span>Exertion: low</span>} />)
    expect(screen.getByText('0 verified · 0 unverified')).toBeInTheDocument()
    expect(screen.getByText('hand covered the cup or markers lost')).toBeInTheDocument()
    expect(screen.getByText('Exertion: low')).toBeInTheDocument()
  })

  it('dots use the artifact states and an accessible summary', () => {
    const { container } = render(<SxStats {...statsProps} verified={1} unverified={0} dots={{ label: '1 of 3 done', items: ['done', 'now', 'todo'] }} />)
    expect(screen.getByRole('img', { name: '1 of 3 done' })).toBeInTheDocument()
    expect(container.querySelectorAll('.sx-d-done')).toHaveLength(1)
    expect(container.querySelectorAll('.sx-d-now')).toHaveLength(1)
    expect(container.querySelectorAll('.sx-d-todo')).toHaveLength(1)
  })
})

describe('sxHold', () => {
  it('hold timer counts from the overlay event time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const h = sxHold(coachWithOverlay({ kind: 'paused', rule: 'perception', text: 'I lost you.', t: 4 }), noRest, false, false, vi.fn(), vi.fn(), noPrompt)
    expect(h.open).toBe(true)
    expect(h.since).toBe(4)
    expect(h.clock).toBe('event')
    expect(h.title).toBe('Tracking lost')
    expect(h.text).toBe('I lost you.')
    expect(h.primary.label).toBe('Resume when ready')
  })

  it('resume sends the command and clears the overlay; end finishes early', () => {
    const coach = coachWithOverlay({ kind: 'paused', rule: 'patient', text: '', t: 2, id: 5 })
    const send = vi.fn()
    const finish = vi.fn()
    const h = sxHold(coach, noRest, false, false, finish, send, noPrompt)
    expect(h.title).toBe('Paused')
    expect(h.text).toMatch(/Counting is on hold/)
    h.primary.onClick()
    expect(send).toHaveBeenCalledWith({ cmd: 'resume' })
    expect(coach.clearOverlay).toHaveBeenCalled()
    h.onEnd()
    expect(finish).toHaveBeenCalledWith(true, 'paused')
  })

  it('a service rest break offers "Rested — continue"', () => {
    const h = sxHold(coachWithOverlay({ kind: 'rest', rule: 'exertion', text: 'Take a minute.', t: 9 }), noRest, false, false, vi.fn(), vi.fn(), noPrompt)
    expect(h.title).toBe('Rest break')
    expect(h.primary.label).toBe('Rested — continue')
  })

  it("the patient's own rest counts on the wall clock and wins over the pause it sent", () => {
    const rest = { since: 1234, start: vi.fn(), end: vi.fn(), cancel: vi.fn() }
    const finish = vi.fn()
    const h = sxHold(coachWithOverlay({ kind: 'paused', rule: 'patient', text: '', t: 3 }), rest, false, false, finish, vi.fn(), noPrompt)
    expect(h.kind).toBe('resting')
    expect(h.title).toBe('Resting')
    expect(h.since).toBe(1234)
    expect(h.clock).toBe('wall')
    h.primary.onClick()
    expect(rest.end).toHaveBeenCalled()
    h.onEnd()
    expect(rest.cancel).toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(true, 'rest')
  })

  it('closed when stopped (SessionOverlay explains a stop) or while feedback is open', () => {
    const o: Overlay = { kind: 'paused', rule: 'patient', text: '', t: 1 }
    expect(sxHold(coachWithOverlay(o), noRest, true, false, vi.fn(), vi.fn(), noPrompt).open).toBe(false)
    expect(sxHold(coachWithOverlay(o), noRest, false, true, vi.fn(), vi.fn(), noPrompt).open).toBe(false)
    expect(sxHold(coachWithOverlay(null), noRest, false, false, vi.fn(), vi.fn(), noPrompt).open).toBe(false)
  })

  it('carries the coach cue said during the pause and an open resume prompt', () => {
    const cue = { type: 'coach', t: 5, id: 7, action: 'instruct', cue_id: 'x', text: 'Marker 2 is covered — move the cup a little left.', reason: '', evidence: [6], ui: {}, label: 'Claude agent · Amazon Bedrock', source: 'agent' } as CoachEvent
    const coach = coachWithOverlay({ kind: 'paused', rule: 'failed_reps', text: 'Three reps were not verified.', t: 4, id: 6 }, [cue])
    const h = sxHold(coach, noRest, false, false, vi.fn(), vi.fn(), { prompt: { kind: 'resume' } })
    expect(h.note).toEqual({ text: cue.text, label: 'Claude agent · Amazon Bedrock', source: 'agent' })
    expect(h.prompt).toBe(true)
    expect(h.resumeByPrompt).toBe(true)
    const h2 = sxHold(coach, noRest, false, false, vi.fn(), vi.fn(), { prompt: { kind: 'dose' } })
    expect(h2.prompt).toBe(true)
    expect(h2.resumeByPrompt).toBe(false)
  })

  it('no prompt inside the rest hold (it stays in the coach slot)', () => {
    const rest = { since: 1, start: vi.fn(), end: vi.fn(), cancel: vi.fn() }
    expect(sxHold(coachWithOverlay(null), rest, false, false, vi.fn(), vi.fn(), { prompt: { kind: 'resume' } }).prompt).toBe(false)
  })
})

describe('useHoldSeconds', () => {
  it('event clock: seconds since the overlay event, right after a remount, then ticking', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useHoldSeconds({ open: true, since: 4, clock: 'event' }, 10))
    expect(result.current).toBe(6)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current).toBe(8)
  })

  it('wall clock: seconds since the rest started', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const { result } = renderHook(() => useHoldSeconds({ open: true, since: 95_000, clock: 'wall' }, null))
    expect(result.current).toBe(5)
    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(result.current).toBe(70)
  })
})

describe('SxHold', () => {
  const base = { open: true, kind: 'paused' as const, title: 'Tracking lost', text: 'I lost you.', seconds: 65, primary: { label: 'Resume when ready', onClick: vi.fn() }, onEnd: vi.fn() }

  it('an alert dialog over the feed with the time, the primary action and End session instead', () => {
    const onEnd = vi.fn()
    const primary = { label: 'Resume when ready', onClick: vi.fn() }
    render(<SxHold {...base} primary={primary} onEnd={onEnd} />)
    expect(screen.getByRole('alertdialog', { name: 'Tracking lost' })).toHaveAccessibleDescription('I lost you.')
    expect(screen.getByLabelText('paused for 65 seconds')).toHaveTextContent('1:05')
    fireEvent.click(screen.getByRole('button', { name: 'Resume when ready' }))
    expect(primary.onClick).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'End session instead' }))
    expect(onEnd).toHaveBeenCalled()
  })

  it('under a minute reads in seconds; a rest says resting', () => {
    render(<SxHold {...base} kind="resting" title="Resting" seconds={12} />)
    expect(screen.getByLabelText('resting for 12 seconds')).toHaveTextContent('12 s')
  })

  it('shows the cue said during the pause with its label, and the prompt; the prompt can be the resume', () => {
    render(
      <SxHold
        {...base}
        note={{ text: 'Marker 2 is covered.', label: 'Claude agent · Amazon Bedrock', source: 'agent' }}
        prompt={<button type="button">Yes, resume</button>}
        resumeByPrompt
      />,
    )
    expect(screen.getByText('Marker 2 is covered.')).toBeInTheDocument()
    expect(screen.getByText('Claude agent · Amazon Bedrock')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Yes, resume' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume when ready' })).toBeNull()
    expect(screen.getByRole('button', { name: 'End session instead' })).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(<SxHold {...base} open={false} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('SxEndDialog', () => {
  it('end dialog pain option opens the pain check, others end with a reason', async () => {
    mockApi({ '/api/prescription': { ...PRESCRIPTION, stop_rules: { ...PRESCRIPTION.stop_rules, pain_max: 6 } } })
    const onPain = vi.fn()
    const onEnd = vi.fn()
    const { rerender } = render(<SxEndDialog open done={3} noun="lift" onPain={onPain} onEnd={onEnd} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Ending the session' })).toBeInTheDocument()
    expect(screen.getByText(/The 3 lifts the camera verified so far are saved either way/)).toBeInTheDocument()
    // the prescription's stop level (stop_rules.pain_max), the one the service's stop rule uses
    expect(await screen.findByText(/Pain of 6 or more ends practice for today/)).toBeInTheDocument()
    expect(screen.queryByText(/Pain of 7/)).toBeNull()
    vi.unstubAllGlobals()
    const end = screen.getByRole('button', { name: 'End session' })
    expect(end).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'I have pain or feel unwell' }))
    fireEvent.click(end)
    expect(onPain).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
    rerender(<SxEndDialog open done={3} noun="lift" onPain={onPain} onEnd={onEnd} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Too tired to continue' }))
    expect(screen.getByRole('radio', { name: 'Too tired to continue' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(onEnd).toHaveBeenCalledWith('tired')
  })

  it('Go back and Escape close it; one verified rep reads singular', () => {
    const onClose = vi.fn()
    render(<SxEndDialog open done={1} noun="peg" onPain={vi.fn()} onEnd={vi.fn()} onClose={onClose} />)
    expect(screen.getByText(/The 1 peg the camera verified so far is saved either way/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closed renders nothing', () => {
    render(<SxEndDialog open={false} done={0} noun="lift" onPain={vi.fn()} onEnd={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('useSxSession', () => {
  it('has no caption state: an old stored captionsPanel:false or spoken:true changes nothing', () => {
    localStorage.setItem('praxis.prefs', JSON.stringify({ captionsPanel: false }))
    localStorage.setItem('praxis.guidance', JSON.stringify({ spoken: true }))
    const { result } = renderHook(() => useSxSession())
    expect(result.current).not.toHaveProperty('captions')
    expect(result.current).not.toHaveProperty('toggleCaptions')
  })

  it('the end dialog', () => {
    const { result } = renderHook(() => useSxSession())
    expect(result.current.endOpen).toBe(false)
    act(() => result.current.openEnd())
    expect(result.current.endOpen).toBe(true)
    act(() => result.current.closeEnd())
    expect(result.current.endOpen).toBe(false)
  })
})

describe('sxClock', () => {
  it('formats event seconds as m:ss', () => {
    expect(sxClock(0)).toBe('0:00')
    expect(sxClock(75.9)).toBe('1:15')
    expect(sxClock(undefined)).toBe('0:00')
  })
})

describe('TracePanel in the light chrome', () => {
  it('uses theme tokens, not the dark-stage inks', () => {
    const events: PraxisEvent[] = [
      { type: 'rep_complete', t: 1, id: 1 },
      { type: 'coach', t: 1.2, id: 2, action: 'instruct', cue_id: 'x', text: 'Good.', reason: 'rep', evidence: [1], ui: {}, label: 'Rule-based coach', tool_calls: [{ tool: 'get_events' }] },
      { type: 'pause', t: 2, id: 3, rule: 'perception' },
    ]
    const { container } = render(<TracePanel events={events} agentRows={[]} />)
    const html = container.innerHTML
    expect(html).not.toMatch(/#4CCBA1|#8AB8FF|stage-a|text-white/)
    expect(container.firstElementChild).toHaveClass('bg-surface', 'text-ink')
  })
})
