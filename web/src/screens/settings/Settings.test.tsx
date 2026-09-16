import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { mockApi } from '../../test/api-mock'
import { Settings } from './Settings'

test('settings switches theme and lists replay clips with a replay entry', async () => {
  mockApi({ '/api/replay/list': { clips: [{ id: 'synthetic_nhpt_01', mode: 'nhpt', sheet: 'nhpt_board', path: 'synthetic_nhpt_01.mp4', synthetic: true }] } })
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<Settings />} />
        <Route path="/session" element={<div>SESSION</div>} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect((await screen.findAllByText(/synthetic_nhpt_01/)).length).toBeGreaterThan(0)
  expect(screen.getByText(/Video is processed in memory/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Replay synthetic_nhpt_01/ }))
  expect(screen.getByText('SESSION')).toBeInTheDocument()
})
