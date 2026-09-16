import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ChooseExercise } from './ChooseExercise'

function renderChoose() {
  return render(
    <MemoryRouter initialEntries={['/choose']}>
      <Routes>
        <Route path="/choose" element={<ChooseExercise />} />
        <Route path="/setup" element={<div>SETUP</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('assigned exercises first with the three badges; only validated tasks get Begin setup', () => {
  renderChoose()
  expect(screen.getByText('Assessment')).toBeInTheDocument()
  expect(screen.getAllByText('Camera coached')).toHaveLength(2)
  expect(screen.getAllByText('Instructions only')).toHaveLength(3)
  expect(screen.getAllByRole('button', { name: 'Begin setup' })).toHaveLength(3)
  expect(screen.getAllByRole('button', { name: 'View instructions' })).toHaveLength(3)
  expect(screen.getByText(/Level changes need your clinician/)).toBeInTheDocument()
})

test('view instructions opens the paraphrased sheet with a manual log', () => {
  renderChoose()
  fireEvent.click(screen.getAllByRole('button', { name: 'View instructions' })[0])
  expect(screen.getByRole('heading', { name: 'Block towers' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Log 1 set/ })).toBeInTheDocument()
})

test('begin setup navigates to camera setup for the exercise', () => {
  renderChoose()
  fireEvent.click(screen.getAllByRole('button', { name: 'Begin setup' })[1])
  expect(screen.getByText('SETUP')).toBeInTheDocument()
})
