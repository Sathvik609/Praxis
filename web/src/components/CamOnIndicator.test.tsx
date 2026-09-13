import { render, screen } from '@testing-library/react'
import { CamOnIndicator } from './CamOnIndicator'

describe('CamOnIndicator', () => {
  it('renders a red CAM ON badge when the webcam is active', () => {
    render(<CamOnIndicator active />)
    const badge = screen.getByRole('status', { name: /camera active/i })
    expect(badge).toHaveTextContent('CAM ON')
    expect(badge).toHaveAttribute('data-active', 'true')
  })

  it('renders nothing visible when the webcam is off', () => {
    render(<CamOnIndicator active={false} />)
    expect(screen.queryByText('CAM ON')).not.toBeInTheDocument()
  })
})
