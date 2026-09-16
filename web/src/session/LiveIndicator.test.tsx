import { render, screen } from '@testing-library/react'
import { LiveIndicator } from './LiveIndicator'

test('shows live · not recording when active and nothing when idle', () => {
  const { rerender } = render(<LiveIndicator active />)
  expect(screen.getByText('Live · not recording')).toBeInTheDocument()
  rerender(<LiveIndicator active={false} />)
  expect(screen.queryByText('Live · not recording')).toBeNull()
  rerender(<LiveIndicator active replay />)
  expect(screen.getByText('Replay')).toBeInTheDocument()
})
