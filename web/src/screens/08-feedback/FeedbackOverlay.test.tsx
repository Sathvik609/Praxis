import { fireEvent, render, screen } from '@testing-library/react'
import { PRESCRIPTION, mockApi } from '../../test/api-mock'
import { FeedbackOverlay } from './FeedbackOverlay'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  mockApi({ '/api/prescription': PRESCRIPTION })
})
afterEach(() => vi.unstubAllGlobals())

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))

test('three steps, one question each; the dialog keeps the name "How was your practice?"', () => {
  render(<FeedbackOverlay open onSave={vi.fn()} onSkip={vi.fn()} />)
  expect(screen.getByRole('dialog', { name: 'How was your practice?' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'How much pain, right now?' })).toBeInTheDocument()
  expect(screen.getByText('1 of 3')).toBeInTheDocument()
  next()
  expect(screen.getByRole('heading', { name: 'How hard was that?' })).toBeInTheDocument()
  next()
  expect(screen.getByRole('heading', { name: 'Could you do this again tomorrow?' })).toBeInTheDocument()
  expect(screen.getByText('3 of 3')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save and see report' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('heading', { name: 'How hard was that?' })).toBeInTheDocument()
})

test('the payload: pain, difficulty with its effort, again tomorrow, ended_early', () => {
  const onSave = vi.fn()
  render(<FeedbackOverlay open onSave={onSave} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: '2' }))
  next()
  fireEvent.click(screen.getByRole('radio', { name: /^Hard/ }))
  next()
  fireEvent.click(screen.getByRole('radio', { name: /^Not sure/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Save and see report' }))
  expect(onSave).toHaveBeenCalledWith({ ended_early: false, pain_after: 2, difficulty: 'hard', effort: 7, again_tomorrow: 'not_sure' })
})

test('unanswered questions are left out, never zero', () => {
  const onSave = vi.fn()
  render(<FeedbackOverlay open onSave={onSave} onSkip={vi.fn()} />)
  next()
  next()
  fireEvent.click(screen.getByRole('button', { name: 'Save and see report' }))
  expect(onSave).toHaveBeenCalledWith({ ended_early: false })
})

test('ended early: a fourth step asks what got in the way (pick several)', () => {
  const onSave = vi.fn()
  render(<FeedbackOverlay open early onSave={onSave} onSkip={vi.fn()} />)
  expect(screen.getByText('1 of 4')).toBeInTheDocument()
  next()
  next()
  next()
  expect(screen.getByRole('heading', { name: 'What got in the way?' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Too tired' }))
  fireEvent.click(screen.getByRole('button', { name: 'Ran out of time' }))
  expect(screen.getByRole('button', { name: 'Too tired' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Save and see report' }))
  expect(onSave).toHaveBeenCalledWith({ ended_early: true, barriers: ['tired', 'time'] })
})

test('an optional note on the last step is sent as detail; blank notes are left out', () => {
  const onSave = vi.fn()
  render(<FeedbackOverlay open onSave={onSave} onSkip={vi.fn()} />)
  next()
  next()
  fireEvent.click(screen.getByRole('button', { name: /Add a note/ }))
  fireEvent.change(screen.getByRole('textbox', { name: /note for your therapist/i }), { target: { value: '  shoulder ached on the fast arcs  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and see report' }))
  expect(onSave).toHaveBeenCalledWith({ ended_early: false, detail: 'shoulder ached on the fast arcs' })
})

test('pain at the prescription stop level says the therapist will be flagged; below it there is no therapist line', async () => {
  render(<FeedbackOverlay open onSave={vi.fn()} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: '6' }))
  expect(screen.queryByText(/therapist/i)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: '7' }))
  expect(await screen.findByText('Your therapist will be flagged.')).toBeInTheDocument()
})

test('the therapist line follows the prescription pain_max, not a literal', async () => {
  mockApi({ '/api/prescription': { ...PRESCRIPTION, stop_rules: { ...PRESCRIPTION.stop_rules, pain_max: 5 } } })
  render(<FeedbackOverlay open onSave={vi.fn()} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: '5' }))
  expect(await screen.findByText('Your therapist will be flagged.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: '4' }))
  expect(screen.queryByText('Your therapist will be flagged.')).not.toBeInTheDocument()
})

test('no therapist line when the prescription cannot be read', () => {
  mockApi({})
  render(<FeedbackOverlay open onSave={vi.fn()} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: '9' }))
  expect(screen.queryByText(/therapist/i)).not.toBeInTheDocument()
})

test('faces are decorative; each number button is named by its number', () => {
  render(<FeedbackOverlay open onSave={vi.fn()} onSkip={vi.fn()} />)
  expect(document.querySelector('.fb-faces')).toHaveAttribute('aria-hidden', 'true')
  const scale = screen.getByRole('radiogroup', { name: 'Pain right now, 0 to 10' })
  for (let n = 0; n <= 10; n++) expect(screen.getByRole('radio', { name: String(n) })).toBeInTheDocument()
  expect(scale.querySelectorAll('[role=radio]')).toHaveLength(11)
})

test('the pain before the session comes from the check-in and the change is shown', () => {
  sessionStorage.setItem('praxis.checkin', JSON.stringify({ pain: 3 }))
  render(<FeedbackOverlay open onSave={vi.fn()} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: '5' }))
  expect(screen.getByText('Up 2')).toBeInTheDocument()
  expect(screen.getByText(/Before you started/)).toHaveTextContent('Before you started: 3')
})

test('the effort badge says it comes from the answer', () => {
  render(<FeedbackOverlay open onSave={vi.fn()} onSkip={vi.fn()} />)
  next()
  expect(screen.getByText('effort 7/10 (from your answer)')).toBeInTheDocument()
  expect(screen.getByText('effort 2/10 (from your answer)')).toBeInTheDocument()
})

test('pain reported during the session is pre-selected, still editable, and saved as pain_after', () => {
  const onSave = vi.fn()
  render(<FeedbackOverlay open reportedPain={8} onSave={onSave} onSkip={vi.fn()} />)
  expect(screen.getByRole('radio', { name: '8' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByText('You told us 8 during the session. Change it if it has changed.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: '6' }))
  expect(screen.getByRole('radio', { name: '8' })).toHaveAttribute('aria-checked', 'false')
  next()
  next()
  fireEvent.click(screen.getByRole('button', { name: 'Save and see report' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ pain_after: 6 }))
})

test('no pain reported during the session: nothing is pre-selected', () => {
  render(<FeedbackOverlay open reportedPain={null} onSave={vi.fn()} onSkip={vi.fn()} />)
  expect(screen.queryByRole('radio', { checked: true })).toBeNull()
  expect(screen.queryByText(/during the session/)).toBeNull()
})

test('a pain report that arrives while the dialog is closed is pre-selected when it opens', () => {
  const view = render(<FeedbackOverlay open={false} reportedPain={null} onSave={vi.fn()} onSkip={vi.fn()} />)
  view.rerender(<FeedbackOverlay open={false} reportedPain={8} onSave={vi.fn()} onSkip={vi.fn()} />)
  view.rerender(<FeedbackOverlay open reportedPain={8} onSave={vi.fn()} onSkip={vi.fn()} />)
  expect(screen.getByRole('radio', { name: '8' })).toHaveAttribute('aria-checked', 'true')
})

test('Skip on the first step reports nothing (not recorded, never zero)', () => {
  const onSkip = vi.fn()
  render(<FeedbackOverlay open onSave={vi.fn()} onSkip={onSkip} />)
  fireEvent.click(screen.getByRole('button', { name: 'Skip feedback' }))
  expect(onSkip).toHaveBeenCalled()
})
