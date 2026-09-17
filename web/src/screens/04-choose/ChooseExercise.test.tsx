import { fireEvent, render, screen, within } from '@testing-library/react'
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

beforeEach(() => localStorage.clear())

test('Assigned shows today’s tasks with the first preselected and one Begin setup in the flow bar', () => {
  renderChoose()
  expect(screen.getByRole('radio', { name: 'Assigned' })).toHaveAttribute('data-state', 'on')
  expect(screen.getAllByText('Camera coached')).toHaveLength(2)
  expect(screen.queryByText('Assessment')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Select Waiter – cup' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Select Arm to the front' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getAllByRole('button', { name: 'Begin setup' })).toHaveLength(1)
  expect(screen.getByText(/Level changes need your clinician/)).toBeInTheDocument()
})

test('All GRASP L2 lists every task with the three badges; instruction cards keep View instructions', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('radio', { name: 'All GRASP L2' }))
  expect(screen.getByText('Assessment')).toBeInTheDocument()
  expect(screen.getAllByText('Camera coached')).toHaveLength(2)
  expect(screen.getAllByText('Instructions only')).toHaveLength(3)
  expect(screen.getAllByRole('button', { name: 'View instructions' })).toHaveLength(3)
  expect(screen.getAllByRole('button', { name: 'Begin setup' })).toHaveLength(1)
})

test('Equipment I have filters by the saved list and What I have edits it', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('radio', { name: 'Equipment I have' }))
  expect(screen.getByRole('heading', { name: 'Waiter – cup' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Wash cloth' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Arm to the front' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'What I have' }))
  const dialog = screen.getByRole('dialog', { name: 'What I have' })
  fireEvent.click(within(dialog).getByLabelText(/Wrist weight/))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
  expect(screen.getByRole('heading', { name: 'Arm to the front' })).toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem('praxis.equipment') ?? '[]')).toContain('weight')
})

test('selecting an instructions-only card makes View instructions the primary; the sheet closes on Escape', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('radio', { name: 'All GRASP L2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Select Block towers' }))
  expect(screen.queryByRole('button', { name: 'Begin setup' })).not.toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: 'View instructions' })[0])
  const dialog = screen.getByRole('dialog', { name: 'Block towers' })
  expect(dialog).toHaveAccessibleDescription(/paraphrased from your program/)
  fireEvent.click(within(dialog).getByRole('button', { name: /Log 1 set/ }))
  expect(within(dialog).getByText(/1 set today/)).toBeInTheDocument()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Block towers' })).not.toBeInTheDocument()
})

test('Begin setup navigates to camera setup for the selected exercise', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('button', { name: 'Select Arm to the front' }))
  fireEvent.click(screen.getByRole('button', { name: 'Begin setup' }))
  expect(screen.getByText('SETUP')).toBeInTheDocument()
})

test('Help me choose asks three questions and picks a card; high pain points to the stop rule', () => {
  renderChoose()
  fireEvent.click(screen.getByRole('button', { name: 'Help me choose' }))
  const dialog = screen.getByRole('dialog', { name: 'Help me choose' })
  fireEvent.click(within(dialog).getByRole('radio', { name: 'About 5 minutes' }))
  fireEvent.click(within(dialog).getByRole('radio', { name: 'None' }))
  fireEvent.click(within(dialog).getByRole('radio', { name: 'No' }))
  expect(within(dialog).getByText(/Arm to the front/)).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Use this pick' }))
  expect(screen.getByRole('button', { name: 'Select Arm to the front' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Help me choose' }))
  const again = screen.getByRole('dialog', { name: 'Help me choose' })
  fireEvent.click(within(again).getByRole('radio', { name: '5 or more' }))
  expect(within(again).getByText(/stop rule/)).toBeInTheDocument()
  expect(within(again).getByRole('button', { name: 'Use this pick' })).toBeDisabled()
})
