import { fireEvent, render, screen } from '@testing-library/react'
import { FlowBar } from '../app/FlowBar'
import { Button } from './Button'
import { Card } from './Card'
import { Checkbox } from './Checkbox'
import { Chip } from './Chip'
import { NumberScale } from './NumberScale'
import { Overlay } from './Overlay'
import { Pill } from './Pill'
import { PraxisMark } from './PraxisMark'
import { ProgressDots } from './ProgressDots'
import { Stat } from './Stat'

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

// Design v2: the designers' stylesheet (designer.css) targets these component classes.
test('button renders the ui-btn class and its variant class', () => {
  render(
    <>
      <Button>Start</Button>
      <Button variant="secondary">Back</Button>
    </>,
  )
  expect(screen.getByRole('button', { name: 'Start' })).toHaveClass('ui-btn', 'ui-btn--primary')
  expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('ui-btn', 'ui-btn--secondary')
  expect(screen.getByRole('button', { name: 'Back' })).not.toHaveClass('ui-btn--primary')
})

test('card renders .ui-card with its tone class and an h2.ui-card-title', () => {
  render(
    <Card title="This week" tone="brand">
      <p>body</p>
    </Card>,
  )
  const title = screen.getByRole('heading', { level: 2, name: 'This week' })
  expect(title).toHaveClass('ui-card-title')
  const card = title.closest('.ui-card')!
  expect(card).toHaveClass('ui-card--brand', 'p-6')
})

test('chip carries ui-chip classes and a Sample label is never judge-only (always visible)', () => {
  render(<Chip>Sample history</Chip>)
  const chip = screen.getByText('Sample history')
  expect(chip).toHaveClass('ui-chip', 'ui-chip--neutral')
  expect(chip).not.toHaveClass('judge-only')
})

test('checkbox label is .ui-check and its drawn box is .ui-check-box', () => {
  render(<Checkbox label="Cup" checked={false} onChange={() => {}} />)
  const input = screen.getByRole('checkbox', { name: 'Cup' })
  const label = input.closest('label')!
  expect(label).toHaveClass('ui-check')
  expect(input.nextElementSibling).toHaveClass('ui-check-box')
})

test('pill is a .ui-seg group of .ui-seg-btn items', () => {
  render(<Pill ariaLabel="Side" value="left" onChange={() => {}} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />)
  const group = screen.getByRole('radiogroup', { name: 'Side' })
  expect(group).toHaveClass('ui-seg')
  for (const b of screen.getAllByRole('radio')) expect(b).toHaveClass('ui-seg-btn')
})

test('number scale buttons are .ui-scale-btn', () => {
  render(<NumberScale label="Pain" value={null} onChange={() => {}} leftAnchor="none" rightAnchor="worst" />)
  const radios = screen.getAllByRole('radio')
  expect(radios).toHaveLength(11)
  for (const b of radios) expect(b).toHaveClass('ui-scale-btn')
})

test('overlay content is .ui-dialog over a .ui-scrim', () => {
  render(
    <Overlay open title="Replay">
      <p>body</p>
    </Overlay>,
  )
  expect(screen.getByRole('dialog', { name: 'Replay' })).toHaveClass('ui-dialog')
  expect(document.querySelector('.ui-scrim')).not.toBeNull()
})

test('stat number is .ui-stat-num', () => {
  render(<Stat value={42} unit="s" label="Best time" />)
  expect(screen.getByText('42').closest('.ui-stat-num')).not.toBeNull()
})

test('flow bar is .ui-flowbar; labelId makes its step label a polite live region', () => {
  const { container, rerender } = render(<FlowBar step={1} label="Step 2 of 6" labelId="x" right={<button type="button">Next</button>} />)
  expect(container.querySelector('footer')).toHaveClass('ui-flowbar')
  const label = container.querySelector('span#x')!
  expect(label).toHaveTextContent('Step 2 of 6')
  expect(label).toHaveAttribute('aria-live', 'polite')
  rerender(<FlowBar step={1} label="Step 2 of 6" right={<button type="button">Next</button>} />)
  expect(screen.getByText('Step 2 of 6')).not.toHaveAttribute('aria-live')
})

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
