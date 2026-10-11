/** axe (WCAG 2.1 A/AA + landmark/heading best practice) over every screen, rendered through the
 *  real route table with the design preview's captured service data and, for Camera setup and
 *  the live screens, a recorded event stream fed through the webcam hook (`harness.tsx`). One
 *  test per screen; dialogs and in-session states are in `dialogs.a11y.test.tsx`.
 *  See docs/ACCESSIBILITY.md and `test/axe.ts` (what is and is not checked in jsdom). */
import { screen, within } from '@testing-library/react'
import { expectNoAxeViolations, expectPageStructure } from '../test/axe'
import { feed, renderRoute, stubService } from './harness'

vi.mock('../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  stubService()
})
afterEach(() => vi.restoreAllMocks())

async function expectAccessiblePage() {
  await expectNoAxeViolations(undefined, { page: true })
  expectPageStructure()
}

const PAGES: [string, string][] = [
  ['Home', '/details'],
  ['Check-in', '/details/checkin'],
  ['Choose exercise', '/details/choose'],
  ['Exercises hub', '/details/exercises'],
  ['Demonstration · cup', '/details/demo?exercise=cup&side=left'],
  ['Demonstration · arm', '/details/demo?exercise=abduction&side=left'],
  ['Progress', '/details/progress'],
  ['Calendar', '/details/calendar'],
  ['Settings', '/details/settings'],
  ['Session report · cup + arm', '/report/s-0912-cuparm'],
  ['Session report · NHPT', '/report/s-0912-nhpt'],
  ['Assessment result', '/report'],
  ['Therapist dashboard', '/therapist'],
]

test.each(PAGES)('%s has no axe violations', async (_name, path) => {
  await renderRoute(path)
  await expectAccessiblePage()
})

const SETUP: [string, string, string][] = [
  ['Camera setup · NHPT', '/details/setup?exercise=nhpt&side=left', 'calibrate-nhpt'],
  ['Camera setup · cup', '/details/setup?exercise=cup&side=left', 'calibrate-cup'],
  ['Camera setup · arm', '/details/setup?exercise=abduction&side=left', 'calibrate-arm'],
]
test.each(SETUP)('%s has no axe violations', async (_name, path, rec) => {
  feed(rec, 1)
  await renderRoute(path)
  await expectAccessiblePage()
})

// mid-set: the arm recording's set check-in opens at about half way (checked as a dialog)
const LIVE: [string, string, string, number][] = [
  ['Live Waiter – cup', '/session?exercise=cup&side=left', 'cup', 0.5],
  ['Live NHPT', '/session?exercise=nhpt&side=left', 'nhpt', 0.5],
  ['Live NHPT · replay (board view)', '/session?exercise=nhpt&hand=left&replay=synthetic_nhpt_01', 'nhpt', 0.5],
  ['Live Waiter – cup · replay', '/session?exercise=cup&side=left&replay=synthetic_cup_01', 'cup', 0.5],
  ['Live Arm out to the side', '/session?exercise=abduction&side=left', 'abduction', 0.25],
]
test.each(LIVE)('%s has no axe violations', async (_name, path, rec, share) => {
  feed(rec, share)
  await renderRoute(path)
  await expectAccessiblePage()
  // the replay draws the board view instead of the camera (found by the browser pass, 10 Oct)
  if (path.includes('synthetic_nhpt')) expect(screen.getByRole('group', { name: 'board view' })).toBeInTheDocument()
})

test('Coach chat drawer (deep link) is a named modal dialog with no axe violations', async () => {
  await renderRoute('/details/coach')
  await expectNoAxeViolations(screen.getByRole('dialog', { name: 'Praxis coach' }))
})

test.each(LIVE)('%s: the coach caption is the one polite announcer; counters are not live', async (_name, path, rec, share) => {
  feed(rec, share)
  await renderRoute(path)
  const caption = screen.getByRole('region', { name: 'Coach' }).querySelector('[aria-live="polite"]')
  expect(caption?.textContent).toBeTruthy()
  const speaking = [...document.querySelectorAll('[aria-live="polite"]')].filter((el) => el.textContent?.trim())
  expect(speaking).toEqual([caption])
  const progress = screen.getByRole('region', { name: 'Progress' })
  expect(progress.querySelector('[aria-live], [role="status"], [role="log"], [role="alert"]')).toBeNull()
  // the state chip is a status (announced on change only: connecting, tracking, lost, paused)
  expect(within(screen.getByRole('banner')).getByRole('status')).toHaveTextContent(/\w/)
})
