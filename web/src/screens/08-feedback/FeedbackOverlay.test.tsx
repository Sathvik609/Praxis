import { fireEvent, render, screen } from '@testing-library/react'
import { FeedbackOverlay } from './FeedbackOverlay'

test('feedback collects pain after, effort and comparison and saves', () => {
  const onSave = vi.fn()
  render(<FeedbackOverlay open onSave={onSave} onSkip={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'How was your practice?' })).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/not recorded/)
  expect(screen.getByText(/Camera and microphone are off/)).toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('radio', { name: '2' })[0])
  fireEvent.click(screen.getAllByRole('radio', { name: '4' })[1])
  fireEvent.click(screen.getByRole('radio', { name: 'About the same' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save and view report' }))
  expect(onSave).toHaveBeenCalledWith({ pain_after: 2, effort: 4, compared: 'same' })
})

test('an optional note is sent as detail; blank notes are left out', () => {
  const onSave = vi.fn()
  render(<FeedbackOverlay open onSave={onSave} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /Add a note/ }))
  const box = screen.getByRole('textbox', { name: /note for your therapist/i })
  fireEvent.change(box, { target: { value: '  shoulder ached on the fast arcs  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and view report' }))
  expect(onSave).toHaveBeenCalledWith({ detail: 'shoulder ached on the fast arcs' })
})

test('skip reports nothing as not recorded, never zero', () => {
  const onSkip = vi.fn()
  render(<FeedbackOverlay open onSave={vi.fn()} onSkip={onSkip} />)
  fireEvent.click(screen.getByRole('button', { name: 'Skip optional feedback' }))
  expect(onSkip).toHaveBeenCalled()
})
