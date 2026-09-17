import { render, screen } from '@testing-library/react'
import { Checklist } from './Checklist'

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
