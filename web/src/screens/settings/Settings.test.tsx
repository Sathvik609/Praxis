import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { mockApi } from '../../test/api-mock'
import { Settings } from './Settings'

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/session" element={<div>SESSION</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => localStorage.clear())

test('settings switches theme and lists replay clips with a replay entry', async () => {
  mockApi({ '/api/replay/list': { clips: [{ id: 'synthetic_nhpt_01', mode: 'nhpt', sheet: 'nhpt_board', path: 'synthetic_nhpt_01.mp4', synthetic: true }] } })
  renderSettings()
  fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(await screen.findByText('Nine-Hole Peg Test')).toBeInTheDocument()
  expect(screen.getByText('Synthetic render')).toBeInTheDocument()
  // jsdom runs on localhost, so the edge wording applies; hosted builds say "on the Praxis service"
  expect(screen.getByText(/Video is processed on this device, never stored\. Only events/)).toBeInTheDocument()
  expect(screen.queryByText(/Everything runs on this device/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Replay Nine-Hole Peg Test' }))
  expect(screen.getByText('SESSION')).toBeInTheDocument()
})

test('guidance checkboxes persist to localStorage and load back', async () => {
  mockApi({ '/api/replay/list': { clips: [] } })
  const { unmount } = renderSettings()
  expect(screen.getByLabelText(/^Captions/)).toBeChecked()
  expect(screen.getByLabelText(/^Larger text/)).not.toBeChecked()
  fireEvent.click(screen.getByLabelText(/^Larger text/))
  expect(JSON.parse(localStorage.getItem('praxis.guidance') ?? '{}').larger).toBe(true)
  expect(await screen.findByText(/No recordings available yet/)).toBeInTheDocument()
  unmount()
  renderSettings()
  expect(screen.getByLabelText(/^Larger text/)).toBeChecked()
})
