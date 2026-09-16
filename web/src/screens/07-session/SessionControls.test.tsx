import { fireEvent, render, screen } from '@testing-library/react'
import { SessionControls } from './SessionControls'

test('controls render the fixed actions and fire callbacks', () => {
  const onEnd = vi.fn()
  const onPain = vi.fn()
  const onToggleTrace = vi.fn()
  render(
    <SessionControls
      onPause={vi.fn()}
      onRest={vi.fn()}
      onPain={onPain}
      onEnd={onEnd}
      traceOpen={false}
      onToggleTrace={onToggleTrace}
    />,
  )
  for (const name of ['Pause', 'Take a rest', 'Pain / feel unwell', 'Show trace', 'End session']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  expect(screen.getByRole('button', { name: 'Push to talk' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'End session' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pain / feel unwell' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
  expect(onEnd).toHaveBeenCalled()
  expect(onPain).toHaveBeenCalled()
  expect(onToggleTrace).toHaveBeenCalled()
})
