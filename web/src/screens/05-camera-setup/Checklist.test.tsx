import { render, screen } from '@testing-library/react'
import { Checklist } from './Checklist'

test('renders status words and hints', () => {
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
      ]}
    />,
  )
  expect(screen.getByText('Pass')).toBeInTheDocument()
  expect(screen.getByText('Check')).toBeInTheDocument()
  expect(screen.getByText(/Move the lamp/)).toBeInTheDocument()
})
