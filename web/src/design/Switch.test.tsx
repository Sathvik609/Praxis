import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Switch } from './Switch'

function Harness({ onChange }: { onChange: (v: boolean) => void }) {
  const [on, setOn] = useState(false)
  return (
    <Switch
      checked={on}
      label="Larger text"
      onChange={(v) => {
        setOn(v)
        onChange(v)
      }}
    />
  )
}

test('switch is a labelled role=switch button that toggles aria-checked and reports the new value', () => {
  const onChange = vi.fn()
  render(<Harness onChange={onChange} />)
  const sw = screen.getByRole('switch', { name: 'Larger text' })
  expect(sw.tagName).toBe('BUTTON')
  expect(sw).toHaveAttribute('type', 'button')
  expect(sw).toHaveClass('st-switch')
  expect(sw.querySelector('.st-thumb')).not.toBeNull()
  expect(sw).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(sw)
  expect(onChange).toHaveBeenCalledWith(true)
  expect(sw).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(sw)
  expect(onChange).toHaveBeenLastCalledWith(false)
  expect(sw).toHaveAttribute('aria-checked', 'false')
})
