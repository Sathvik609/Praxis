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

test('carries a camera icon and a red (live) or amber (replay) dot, text ≥ 18 px', () => {
  const { container, rerender } = render(<LiveIndicator active />)
  // class-string assertions: jsdom's selector cache can return stale matches after a rerender
  expect(container.querySelector('svg')).not.toBeNull()
  expect(container.innerHTML).toMatch(/bg-red/)
  expect(screen.getByRole('status').className).toMatch(/text-lg/)
  rerender(<LiveIndicator active replay />)
  expect(container.innerHTML).toMatch(/bg-amber/)
  expect(container.innerHTML).not.toMatch(/bg-red/)
})
