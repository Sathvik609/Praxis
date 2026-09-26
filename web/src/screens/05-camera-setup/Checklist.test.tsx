import { fireEvent, render, screen } from '@testing-library/react'
import { Checklist } from './Checklist'

test('a self-check row says the patient checks it and has a 56 px toggle', () => {
  const onTick = vi.fn()
  const { rerender } = render(<Checklist checks={[{ id: 'hip_in_view', label: 'Hip in view', status: 'pending', hint: 'Use a chair without arms.', source: 'self' }]} onTick={onTick} />)
  expect(screen.getByText('You check')).toBeInTheDocument()
  const b = screen.getByRole('button', { name: 'Hip in view: yes, I can see it' })
  expect(b.className).toMatch(/min-h-14/)
  fireEvent.click(b)
  expect(onTick).toHaveBeenCalledWith('hip_in_view')
  rerender(<Checklist checks={[{ id: 'hip_in_view', label: 'Hip in view', status: 'pass', hint: 'Use a chair without arms.', source: 'self' }]} onTick={onTick} />)
  expect(screen.getByText('You checked')).toBeInTheDocument()
  expect(screen.queryByText('Use a chair without arms.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /ticked, tap to undo/ })).toHaveAttribute('aria-pressed', 'true')
})

test('renders status words, an icon per row and hints at body size', () => {
  render(
    <Checklist
      checks={[
        { id: 'camera', label: 'Camera permission', status: 'pass', hint: null },
        {
          id: 'lighting',
          label: 'Lighting and steady tracking',
          status: 'check',
          hint: 'Move the lamp so your hand is not in shadow',
        },
        { id: 'markers', label: 'Sheet found', status: 'pending', hint: null },
      ]}
    />,
  )
  expect(screen.getByText('Pass')).toBeInTheDocument()
  expect(screen.getByText('Check')).toBeInTheDocument()
  expect(screen.getByText('Waiting')).toBeInTheDocument()
  const hint = screen.getByText(/Move the lamp/)
  expect(hint.className).toMatch(/text-lg/)
  expect(screen.getAllByRole('listitem')).toHaveLength(3)
  expect(document.querySelectorAll('li svg')).toHaveLength(3)
})
