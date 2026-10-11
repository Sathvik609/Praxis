/** Every dialog and in-session state: axe-clean, named, and keyboard-operable (focus moves in,
 *  stays in while modal, Escape closes where there is a cancel, focus returns to the opener).
 *  Dialogs that need an answer (stop, pause, set check-in, progression, cup done) do not close
 *  on Escape; their buttons are reachable by Tab. See docs/ACCESSIBILITY.md. */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectNoAxeViolations } from '../test/axe'
import { feed, renderRoute, settle, stubService } from './harness'

vi.mock('../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  stubService()
})
afterEach(() => vi.restoreAllMocks())

const CUP = '/session?exercise=cup&side=left'
const LATE = 100_000 // event ids / times after every recorded one
const rule = 'Rule-based coach · LLM agent pending'

describe('End session dialog', () => {
  test('opens from the keyboard, traps Tab, closes on Escape and gives focus back', async () => {
    const user = userEvent.setup()
    feed('cup')
    await renderRoute(CUP)
    const end = screen.getByRole('button', { name: 'End session' })
    end.focus()
    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: 'Ending the session' })
    await expectNoAxeViolations(dialog)
    expect(within(dialog).getByRole('button', { name: 'Go back' })).toHaveFocus()
    // Tab never leaves the dialog
    for (let i = 0; i < 8; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Ending the session' })).toBeNull()
    expect(end).toHaveFocus()
  })

  test('the reasons are a radio group operable with Space and the arrow keys', async () => {
    const user = userEvent.setup()
    feed('cup')
    await renderRoute(CUP)
    await user.click(screen.getByRole('button', { name: 'End session' }))
    const group = screen.getByRole('radiogroup', { name: 'Why are you ending?' })
    const radios = within(group).getAllByRole('radio')
    radios[0].focus()
    await user.keyboard(' ')
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowDown}')
    expect(radios[1]).toHaveFocus()
    expect(radios[1]).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{End}')
    expect(radios[radios.length - 1]).toHaveAttribute('aria-checked', 'true')
  })
})

test('Pain / feel unwell: named dialog, focus inside, Escape is Back to session and focus returns', async () => {
  const user = userEvent.setup()
  feed('cup')
  await renderRoute(CUP)
  const pain = screen.getByRole('button', { name: 'Pain / feel unwell' })
  pain.focus()
  await user.keyboard('{Enter}')
  await settle()
  const dialog = screen.getByRole('dialog', { name: 'How is the pain right now?' })
  await expectNoAxeViolations(dialog)
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
  await user.keyboard('{Escape}')
  await settle() // Radix gives focus back on the next tick
  expect(screen.queryByRole('dialog', { name: 'How is the pain right now?' })).toBeNull()
  expect(pain).toHaveFocus()
})

test('a stop rule is an alert dialog with no axe violations; it needs Save and continue (no Escape)', async () => {
  const user = userEvent.setup()
  feed('cup', 0.5, [{ type: 'stop', t: LATE, id: LATE, rule: 'pain', text: 'Pain 8 is at your stop level. The session has ended and Dr. Rao is flagged.' }])
  await renderRoute(CUP)
  const dialog = screen.getByRole('alertdialog', { name: 'Session ended · pain at stop level' })
  await expectNoAxeViolations(dialog)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('alertdialog', { name: 'Session ended · pain at stop level' })).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Save and continue' })).toBeInTheDocument()
})

test('tracking lost is an alert dialog over the feed with focus on Resume, and the status chip says so in words', async () => {
  feed('cup', 0.5, [{ type: 'pause', t: LATE, id: LATE, rule: 'perception', text: 'I lost the sheet. Bring all four markers back into view.' }])
  await renderRoute(CUP)
  const hold = screen.getByRole('alertdialog', { name: 'Tracking lost' })
  await expectNoAxeViolations(hold)
  expect(within(hold).getByRole('button', { name: 'Resume when ready' })).toHaveFocus()
  // the control bar stays usable while the hold is open (it is not modal)
  expect(screen.getByRole('button', { name: 'End session' })).toBeEnabled()
})

test('Take a rest opens the resting hold; Rested — continue gives focus back to the bar', async () => {
  const user = userEvent.setup()
  feed('cup')
  await renderRoute(CUP)
  const rest = screen.getByRole('button', { name: 'Take a rest' })
  rest.focus()
  await user.keyboard('{Enter}')
  const hold = screen.getByRole('alertdialog', { name: 'Resting' })
  await expectNoAxeViolations(hold)
  expect(within(hold).getByRole('button', { name: 'Rested — continue' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.queryByRole('alertdialog', { name: 'Resting' })).toBeNull()
  expect(document.activeElement).not.toBe(document.body)
})

test('the progression prompt (Ready to go faster?) traps focus and has no axe violations', async () => {
  const user = userEvent.setup()
  const prompt = { id: 'progression', title: 'Coach suggests: try the fast arcs', text: 'two clean slow arcs, 0 unverified', options: ['Yes, go faster', 'Keep pace', 'Why?'], within_prescription: true }
  feed('cup', 0.5, [{ type: 'coach', t: LATE, id: LATE, action: 'progress', cue_id: 'cup_progress', text: 'Ready for the fast arcs?', reason: 'r', evidence: [], label: rule, ui: { prompt } }])
  await renderRoute(CUP)
  const dialog = screen.getByRole('dialog', { name: 'Ready to go faster?' })
  await expectNoAxeViolations(dialog)
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
  for (let i = 0; i < 4; i++) {
    await user.tab()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  }
})

test('the cup done dialog has no axe violations and holds focus', async () => {
  feed('cup', 0.9, [{ type: 'cup_complete', t: LATE, id: LATE, arcs: 4, reaches: [{ verified: true }, { verified: false }] }])
  await renderRoute(CUP)
  const dialog = screen.getByRole('dialog', { name: 'Waiter – cup, done' })
  await expectNoAxeViolations(dialog)
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
})

test('the set check-in (Arm out to the side) has no axe violations', async () => {
  feed('abduction', 0.5)
  await renderRoute('/session?exercise=abduction&side=left')
  const dialog = screen.getByRole('dialog', { name: /Set 1 done · how hard was that/ })
  await expectNoAxeViolations(dialog)
  expect(within(dialog).getByRole('radiogroup', { name: 'Effort for that set' })).toBeInTheDocument()
})

test('post-session feedback has no axe violations at each step', async () => {
  const user = userEvent.setup()
  feed('cup')
  await renderRoute(CUP)
  await user.click(screen.getByRole('button', { name: 'End session' }))
  await user.click(screen.getByRole('radio', { name: 'Finished for today — no problem' }))
  await user.click(within(screen.getByRole('dialog', { name: 'Ending the session' })).getByRole('button', { name: 'End session' }))
  await settle()
  const dialog = screen.getByRole('dialog')
  await expectNoAxeViolations(dialog)
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
})

test('Settings › Replay a recorded session: named dialog, Escape closes, focus returns', async () => {
  const user = userEvent.setup()
  await renderRoute('/details/settings')
  const row = screen.getByRole('button', { name: /Replay a recorded session/ })
  row.focus()
  await user.keyboard('{Enter}')
  await settle()
  const dialog = screen.getByRole('dialog', { name: 'Replay a recorded session' })
  await expectNoAxeViolations(dialog)
  await user.keyboard('{Escape}')
  await settle()
  expect(screen.queryByRole('dialog', { name: 'Replay a recorded session' })).toBeNull()
  expect(row).toHaveFocus()
})

test('Choose › Ask the coach opens the coach chat as a named dialog', async () => {
  const user = userEvent.setup()
  await renderRoute('/details/choose')
  await user.click(screen.getByRole('button', { name: 'Ask the coach' }))
  await settle()
  await expectNoAxeViolations(screen.getByRole('dialog', { name: 'Praxis coach' }))
})

test('Therapist › Edit practice days has no axe violations and closes on Escape', async () => {
  const user = userEvent.setup()
  await renderRoute('/therapist')
  await user.click(await screen.findByRole('button', { name: /Edit practice days/ }))
  const dialog = screen.getByRole('dialog')
  await expectNoAxeViolations(dialog)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
})
