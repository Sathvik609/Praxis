import { fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import type { FrameEvent, SessionEvent } from '../lib/events'
import { SessionView } from './SessionView'

const holes = Array.from({ length: 9 }, (_, k) => [100 + (k % 3) * 60, 100 + Math.floor(k / 3) * 60, 12])

function frame(over: Partial<FrameEvent> = {}): FrameEvent {
  return {
    type: 'frame',
    t: 100,
    frame_index: 7,
    calibrated: true,
    paused: false,
    mode: 'nhpt',
    fsm: { state: 'in_transit', target: null, reps: 3, finished: false },
    nhpt: { mode: 'nhpt', state: 'in_transit', started: true, completed: false, pegs_done: 3, elapsed_s: 12.34, total_s: null, target: null, reps: 3, finished: false },
    occupancy: null,
    free_pegs_mm: [],
    overlay: { markers_px: {}, holes_px: holes, target: 4 },
    ...over,
  }
}

function renderView(f: FrameEvent | null, events: SessionEvent[] = [], extra: Partial<React.ComponentProps<typeof SessionView>> = {}) {
  const onStop = vi.fn()
  const onPain = vi.fn()
  render(
    <SessionView
      mode="nhpt"
      frame={f}
      events={events}
      camActive
      videoRef={createRef<HTMLVideoElement>()}
      videoSize={{ width: 640, height: 480 }}
      onStop={onStop}
      onPain={onPain}
      {...extra}
    />,
  )
  return { onStop, onPain }
}

describe('SessionView', () => {
  it('shows the FSM state, rep count and NHPT timer from the latest frame event', () => {
    renderView(frame())
    expect(screen.getByTestId('state-badge')).toHaveTextContent('Moving')
    expect(screen.getByTestId('rep-count')).toHaveTextContent('3')
    expect(screen.getByTestId('nhpt-timer')).toHaveTextContent('0:12.3')
  })

  it('always shows Stop session and I\'m in pain as 56px controls and wires them', () => {
    const { onStop, onPain } = renderView(frame())
    const stop = screen.getByRole('button', { name: /stop session/i })
    const pain = screen.getByRole('button', { name: /i'm in pain/i })
    expect(stop.className).toMatch(/min-h-14/)
    expect(pain.className).toMatch(/min-h-14/)
    fireEvent.click(stop)
    fireEvent.click(pain)
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onPain).toHaveBeenCalledTimes(1)
  })

  it('draws nine hole markers and highlights the target hole', () => {
    renderView(frame({ overlay: { markers_px: {}, holes_px: holes, target: 4 } }))
    const overlay = screen.getByTestId('hole-overlay')
    const circles = within(overlay).getAllByTestId('hole')
    expect(circles).toHaveLength(9)
    expect(circles[4]).toHaveAttribute('data-target', 'true')
    expect(circles[0]).toHaveAttribute('data-target', 'false')
  })

  it('explains tracking loss with the missing marker ids', () => {
    const lost: SessionEvent = { type: 'perception_lost', t: 99, reason: 'markers_missing', missing_ids: [0, 2] }
    renderView(frame({ paused: true, calibrated: false }), [lost])
    expect(screen.getByRole('alert')).toHaveTextContent(/tracking lost/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/markers 0, 2/i)
  })

  it('asks for all four markers before calibration', () => {
    renderView(frame({ calibrated: false, fsm: null, nhpt: null }))
    expect(screen.getByText(/show all four corner markers/i)).toBeInTheDocument()
  })

  it('shows the CAM ON indicator while the camera is active', () => {
    renderView(frame())
    expect(screen.getByRole('status', { name: /camera active/i })).toBeInTheDocument()
  })

  it('hides the trace panel until Show trace is pressed, then lists non-frame events newest first', () => {
    const events: SessionEvent[] = [
      { type: 'calibration', t: 1, calibrated: true },
      { type: 'state_change', t: 2, from: 'at_source', to: 'grasped', target: 4 },
      frame(),
      { type: 'rep_complete', t: 3, rep: 1, hole: 4, target: 4, duration_s: 0.8 },
    ]
    renderView(frame(), events)
    expect(screen.queryByTestId('trace-panel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show trace/i }))
    const rows = within(screen.getByTestId('trace-panel')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('rep_complete')
    expect(rows[2]).toHaveTextContent('calibration')
  })

  it('shows the final NHPT time once complete', () => {
    renderView(frame({ nhpt: { mode: 'nhpt', state: 'at_source', started: true, completed: true, pegs_done: 9, elapsed_s: 17, total_s: 17, target: null, reps: 9, finished: false } }))
    expect(screen.getByTestId('nhpt-timer')).toHaveTextContent('0:17.0')
    expect(screen.getByText(/nhpt complete/i)).toBeInTheDocument()
  })
})
