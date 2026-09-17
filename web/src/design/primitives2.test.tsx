import { fireEvent, render, screen } from '@testing-library/react'
import { Button } from './Button'
import { Card } from './Card'
import { Checkbox } from './Checkbox'
import { Field } from './Field'
import { Pill } from './Pill'
import { Stat } from './Stat'

test('button carries hover, focus and pressed state classes and a decorative icon', () => {
  render(<Button icon={<svg data-testid="i" />}>Start</Button>)
  const b = screen.getByRole('button', { name: 'Start' })
  expect(b.className).toMatch(/focus-visible:ring-4/)
  expect(b.className).toMatch(/hover:/)
  expect(b.className).toMatch(/active:translate-y-px/)
  expect(screen.getByTestId('i')).toBeInTheDocument()
})

test('pill is a radio group that reports the chosen value', () => {
  const onChange = vi.fn()
  render(<Pill ariaLabel="View" value="front" options={[{ value: 'front', label: 'Front' }, { value: 'side', label: 'Side' }]} onChange={onChange} />)
  expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Front' })).toHaveAttribute('data-state', 'on')
  fireEvent.click(screen.getByRole('radio', { name: 'Side' }))
  expect(onChange).toHaveBeenCalledWith('side')
})

test('checkbox is keyboard-operable and labelled', () => {
  const onChange = vi.fn()
  render(<Checkbox label="I am ready" checked={false} onChange={onChange} />)
  const box = screen.getByRole('checkbox', { name: 'I am ready' })
  fireEvent.click(box)
  expect(onChange).toHaveBeenCalledWith(true)
})

test('field links its label and stat never wraps its number', () => {
  render(
    <>
      <Field label="Program code" defaultValue="GRASP-L2" />
      <Stat value="41.2" unit="s" label="Nine-Hole Peg Test" />
      <Card title="This week">body</Card>
    </>,
  )
  expect(screen.getByLabelText('Program code')).toHaveValue('GRASP-L2')
  expect(screen.getByText('41.2').className).toMatch(/whitespace-nowrap/)
  expect(screen.getByRole('heading', { name: 'This week' })).toBeInTheDocument()
})
