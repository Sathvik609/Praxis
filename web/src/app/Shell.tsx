import { Outlet } from 'react-router-dom'
import { Nav } from './Nav'

export function Shell() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <Nav program="Hospital GRASP, Level 2 · Left side" initial="A" />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
