import { render, screen } from '@testing-library/react'
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
})
