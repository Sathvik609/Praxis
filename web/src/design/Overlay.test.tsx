import { fireEvent, render, screen } from '@testing-library/react'
import { Overlay, OverlayActions } from './Overlay'

test('overlay has an accessible description even when none is given', () => {
  render(
    <Overlay open title="Take a rest">
      <p>body</p>
    </Overlay>,
  )
  const dialog = screen.getByRole('dialog', { name: 'Take a rest' })
  expect(dialog).toHaveAccessibleDescription(/continue/)
})

test('a given description is used and Escape closes only when onClose is provided', () => {
  const onClose = vi.fn()
  render(
    <Overlay open title="Sharing" description="Who can see this report." onClose={onClose}>
      <OverlayActions>
        <button type="button">Close</button>
      </OverlayActions>
    </Overlay>,
  )
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Who can see this report.')
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

test('without onClose, Escape is inert', () => {
  render(
    <Overlay open title="Paused">
      <p>body</p>
    </Overlay>,
  )
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})
