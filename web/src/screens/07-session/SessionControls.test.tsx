import { fireEvent, render, screen } from '@testing-library/react'
import { SessionControls } from './SessionControls'

const props = () => ({ onPause: vi.fn(), onRest: vi.fn(), onPain: vi.fn(), onEnd: vi.fn(), onToggleTrace: vi.fn() })

test('controls render the fixed actions and fire callbacks', () => {
  const p = props()
  render(<SessionControls {...p} traceOpen={false} />)
  for (const name of ['Pause', 'Take a rest', 'Pain / feel unwell', 'Show trace', 'End session']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  fireEvent.click(screen.getByRole('button', { name: 'Pain / feel unwell' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  fireEvent.click(screen.getByRole('button', { name: 'Take a rest' }))
  expect(p.onPain).toHaveBeenCalled()
  expect(p.onToggleTrace).toHaveBeenCalled()
  expect(p.onPause).toHaveBeenCalled()
  expect(p.onRest).toHaveBeenCalled()
})

test('a control that does nothing is not shown: no disabled Push to talk', () => {
  render(<SessionControls {...props()} traceOpen={false} />)
  expect(screen.queryByRole('button', { name: /Push to talk/ })).not.toBeInTheDocument()
})

test('every control has an icon, never wraps, is ≥ 56 px; End session is the danger button', () => {
  render(<SessionControls {...props()} traceOpen />)
  const buttons = screen.getAllByRole('button')
  expect(buttons).toHaveLength(5)
  for (const b of buttons) {
    expect(b.querySelector('svg')).not.toBeNull()
    expect(b.className).toMatch(/whitespace-nowrap/)
    expect(b.className).toMatch(/min-h-14/)
  }
  expect(screen.getByRole('button', { name: 'End session' }).className).toMatch(/bg-red-fill/)
  const trace = screen.getByRole('button', { name: 'Hide trace' })
  expect(trace).toHaveAttribute('aria-pressed', 'true')
})

test('Pain / feel unwell has safety styling: thick red outline, red tint, icon and text', () => {
  render(<SessionControls {...props()} traceOpen={false} />)
  const pain = screen.getByRole('button', { name: 'Pain / feel unwell' })
  expect(pain.className).toMatch(/border-red-ink/)
  expect(pain.className).toMatch(/bg-tint-red/)
  expect(pain.className).toMatch(/border-4/)
  expect(pain.querySelector('svg')).not.toBeNull()
})

test('End session asks first; Keep going cancels, Yes confirms', () => {
  const p = props()
  render(<SessionControls {...p} traceOpen={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'End session' }))
  expect(p.onEnd).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'End this session?' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Keep going' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(p.onEnd).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'End session' }))
  fireEvent.click(screen.getByRole('button', { name: 'Yes, end session' }))
  expect(p.onEnd).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
