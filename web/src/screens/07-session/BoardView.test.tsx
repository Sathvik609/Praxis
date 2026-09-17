import { fireEvent, render, screen } from '@testing-library/react'
import { BoardView } from './BoardView'

test('board view renders nine holes with occupancy and next target', () => {
  const occupancy: Record<string, 'empty' | 'occupied'> = {}
  for (let k = 0; k < 9; k++) occupancy[`hole_${k}`] = k < 5 ? 'occupied' : 'empty'
  render(<BoardView occupancy={occupancy} nextHole={5} />)
  const board = screen.getByLabelText('board view')
  expect(board).toBeInTheDocument()
  expect(screen.getAllByTestId('hole')).toHaveLength(9)
  expect(screen.getByTestId('hole-5')).toHaveAttribute('data-state', 'next')
  expect(screen.getByTestId('hole-0')).toHaveAttribute('data-state', 'occupied')
  expect(screen.getByTestId('hole-8')).toHaveAttribute('data-state', 'empty')
  expect(screen.queryByRole('button')).toBeNull() // no sampling without a handler (replay)
})

test('with a sample handler every hole is a 56 px button and a seated tap reports its index', () => {
  const onSampleHole = vi.fn()
  const occupancy: Record<string, 'empty' | 'occupied'> = { hole_4: 'occupied' }
  render(<BoardView occupancy={occupancy} nextHole={null} onSampleHole={onSampleHole} />)
  const buttons = screen.getAllByRole('button')
  expect(buttons).toHaveLength(9)
  expect(buttons[4].className).toMatch(/h-14 w-14/)
  fireEvent.click(screen.getByRole('button', { name: /hole 5 seated · tap to sample peg colour/ }))
  expect(onSampleHole).toHaveBeenCalledWith(4)
  expect(screen.getByRole('status')).toHaveTextContent(/tap that hole to sample its colour/)
  expect(screen.getByTestId('hole-5')).toHaveAttribute('data-state', 'empty') // no amber ring in any-hole mode
})

test('shows the sampled confirmation once the frame carries a colour', () => {
  render(<BoardView occupancy={{}} nextHole={null} onSampleHole={() => {}} sampled />)
  expect(screen.getByRole('status')).toHaveTextContent(/Peg colour sampled/)
})
