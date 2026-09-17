import { fireEvent, render, screen } from '@testing-library/react'
import { NumberScale } from './NumberScale'

function setup(value: number | null) {
  const onChange = vi.fn()
  render(<NumberScale label="Pain right now" value={value} onChange={onChange} leftAnchor="No pain" rightAnchor="Worst imaginable" />)
  return onChange
}

test('one tab stop: only the selected cell is in the tab order', () => {
  setup(3)
  const radios = screen.getAllByRole('radio')
  expect(radios).toHaveLength(11)
  expect(radios.filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1)
  expect(screen.getByRole('radio', { name: '3' })).toHaveAttribute('tabindex', '0')
})

test('with nothing selected the first cell is the tab stop and nothing is checked', () => {
  setup(null)
  expect(screen.getByRole('radio', { name: '0' })).toHaveAttribute('tabindex', '0')
  expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0)
})

test('arrow keys move and select; Home and End jump to the ends', () => {
  const onChange = setup(3)
  const three = screen.getByRole('radio', { name: '3' })
  fireEvent.keyDown(three, { key: 'ArrowRight' })
  expect(onChange).toHaveBeenLastCalledWith(4)
  expect(screen.getByRole('radio', { name: '4' })).toHaveFocus()
  fireEvent.keyDown(three, { key: 'ArrowLeft' })
  expect(onChange).toHaveBeenLastCalledWith(2)
  fireEvent.keyDown(three, { key: 'Home' })
  expect(onChange).toHaveBeenLastCalledWith(0)
  fireEvent.keyDown(three, { key: 'End' })
  expect(onChange).toHaveBeenLastCalledWith(10)
  expect(screen.getByRole('radio', { name: '10' })).toHaveFocus()
})

test('selected cell is filled, others outlined, and the cells shrink to fit', () => {
  setup(3)
  expect(screen.getByRole('radio', { name: '3' }).className).toMatch(/bg-teal-fill/)
  expect(screen.getByRole('radio', { name: '4' }).className).not.toMatch(/bg-teal-fill/)
  expect(screen.getByRole('radio', { name: '4' }).className).toMatch(/min-w-0/)
})
