import { Outlet } from 'react-router-dom'
import { Nav } from './Nav'

export function Shell() {
  return (
    <div className="grid h-screen grid-rows-[4rem_minmax(0,1fr)] overflow-hidden bg-bg text-ink">
      <Nav program="Hospital GRASP, Level 2 · Left side" initial="A" />
      <main className="flex min-h-0 flex-col overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
