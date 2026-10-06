import { fireEvent, render, screen } from '@testing-library/react'
import { Button } from './Button'
import { Chip } from './Chip'
import { NumberScale } from './NumberScale'
import { PraxisMark } from './PraxisMark'
import { ProgressDots } from './ProgressDots'

test('button has 56px min height class and full width option', () => {
  render(
    <Button variant="primary" full>
      Go
    </Button>,
  )
  const b = screen.getByRole('button', { name: 'Go' })
  expect(b.className).toMatch(/min-h-14/)
  expect(b.className).toMatch(/w-full/)
})

test('chip always renders its text', () => {
  render(<Chip tone="amber">unverified</Chip>)
  expect(screen.getByText('unverified')).toBeInTheDocument()
})

test('number scale is a radiogroup with anchors and reports changes', () => {
  const onChange = vi.fn()
  render(
    <NumberScale
      label="Pain right now"
      value={2}
      onChange={onChange}
      leftAnchor="No pain"
      rightAnchor="Worst imaginable"
    />,
  )
  expect(screen.getByRole('radiogroup', { name: 'Pain right now' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: '2' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: '7' }))
  expect(onChange).toHaveBeenCalledWith(7)
  expect(screen.getByText('No pain')).toBeInTheDocument()
})

test('progress dots expose count as text', () => {
  render(<ProgressDots total={9} done={5} />)
  expect(screen.getByLabelText('5 of 9')).toBeInTheDocument()
})

// Task 2 (design v2) gives Button the designers' `ui-btn ui-btn--<variant>` classes.
it.todo('button renders the ui-btn class')

test('Praxis mark is the favicon artwork, decorative, 32 px by default', () => {
  const { container, rerender } = render(<PraxisMark className="ui-logo" />)
  const svg = container.querySelector('svg')!
  expect(svg).toHaveAttribute('aria-hidden', 'true')
  expect(svg).toHaveAttribute('width', '32')
  expect(svg).toHaveAttribute('height', '32')
  expect(svg).toHaveAttribute('viewBox', '0 0 64 64')
  expect(svg).toHaveClass('ui-logo')
  // The gradient id is unique per instance so two marks on one page never share a reference.
  const fill = svg.querySelector('rect')!.getAttribute('fill')!
  const id = svg.querySelector('linearGradient')!.id
  expect(fill).toBe(`url(#${id})`)
  rerender(<PraxisMark size={52} />)
  expect(container.querySelector('svg')).toHaveAttribute('width', '52')
})
