import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { readTester } from '../lib/tester'
import { TesterGate } from './TesterGate'

function mockHealth(teamTest: boolean) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', team_test: teamTest }), { status: 200 })))
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

it('asks for a name on the team test build and saves it', async () => {
  mockHealth(true)
  render(<TesterGate />)
  const input = await screen.findByLabelText('Your name')
  fireEvent.change(input, { target: { value: 'Ravi' } })
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))
  expect(readTester()).toBe('ravi')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('can be skipped: sessions are then saved as guest', async () => {
  mockHealth(true)
  render(<TesterGate />)
  fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
  expect(readTester()).toBe('guest')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('stays hidden without the flag, or once a name is set', async () => {
  mockHealth(false)
  const { unmount } = render(<TesterGate />)
  await new Promise((r) => setTimeout(r, 0))
  expect(screen.queryByRole('dialog')).toBeNull()
  unmount()
  localStorage.setItem('praxis.tester', 'ravi')
  mockHealth(true)
  render(<TesterGate />)
  await new Promise((r) => setTimeout(r, 0))
  expect(screen.queryByRole('dialog')).toBeNull()
})
