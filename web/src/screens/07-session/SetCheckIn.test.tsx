import { fireEvent, render, screen } from '@testing-library/react'
import { SetCheckIn } from './SetCheckIn'

test('set check-in asks for RPE with an icon and ≥ 56 px buttons; skip sends null, continue sends the value', () => {
  const onSubmit = vi.fn()
  render(<SetCheckIn open setNumber={1} onSubmit={onSubmit} />)
  expect(screen.getByRole('heading', { name: /Set 1 done/ })).toBeInTheDocument()
  expect(document.querySelector('[role="dialog"] svg')).not.toBeNull()
  const cont = screen.getByRole('button', { name: 'Continue to set 2' })
  expect(cont).toBeDisabled()
  expect(cont.className).toMatch(/min-h-14/)
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
  expect(onSubmit).toHaveBeenCalledWith(null)
  fireEvent.click(screen.getByRole('radio', { name: '7' }))
  fireEvent.click(cont)
  expect(onSubmit).toHaveBeenCalledWith(7)
})

test('closed check-in renders nothing', () => {
  render(<SetCheckIn open={false} setNumber={1} onSubmit={vi.fn()} />)
  expect(screen.queryByRole('dialog')).toBeNull()
})
