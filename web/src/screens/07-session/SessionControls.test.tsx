import { fireEvent, render, screen } from '@testing-library/react'
import { SessionControls } from './SessionControls'

const props = () => ({ onPause: vi.fn(), onRest: vi.fn(), onPain: vi.fn(), onEnd: vi.fn(), onToggleTrace: vi.fn() })

test('controls render the fixed actions and fire callbacks', () => {
  const p = props()
  render(<SessionControls {...p} traceOpen={false} />)
  for (const name of ['Pause', 'Take a rest', 'Pain / feel unwell', 'Show trace', 'End session']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  expect(screen.getByRole('button', { name: 'Push to talk' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'End session' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pain / feel unwell' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  fireEvent.click(screen.getByRole('button', { name: 'Take a rest' }))
  expect(p.onEnd).toHaveBeenCalled()
  expect(p.onPain).toHaveBeenCalled()
  expect(p.onToggleTrace).toHaveBeenCalled()
  expect(p.onPause).toHaveBeenCalled()
  expect(p.onRest).toHaveBeenCalled()
})

test('every control has an icon, never wraps, End session is the danger button, Push to talk explains why it is off', () => {
  render(<SessionControls {...props()} traceOpen />)
  const buttons = screen.getAllByRole('button')
  expect(buttons).toHaveLength(6)
  for (const b of buttons) {
    expect(b.querySelector('svg')).not.toBeNull()
    expect(b.className).toMatch(/whitespace-nowrap/)
    expect(b.className).toMatch(/min-h-14/)
  }
  expect(screen.getByRole('button', { name: 'End session' }).className).toMatch(/bg-red-fill/)
  expect(screen.getByRole('button', { name: 'Push to talk' })).toHaveAttribute('title', expect.stringMatching(/Polly/))
  const trace = screen.getByRole('button', { name: 'Hide trace' })
  expect(trace).toHaveAttribute('aria-pressed', 'true')
})
