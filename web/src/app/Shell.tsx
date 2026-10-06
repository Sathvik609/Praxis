import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { api, useApi } from '../lib/api'
import { PATIENT, PROGRAM } from '../lib/seed'
import { applyGuidance } from '../session/guidance'
import { Nav } from './Nav'

/** Patient hub shell. `ui-shell` / `ui-main` are the designer.css hooks: ≥ 900 px a 96 px icon rail
 *  beside a framed glass main, < 900 px a 56 px top bar and a 64 px bottom tab bar. Program label and
 *  initial come from the local store when the service is up, otherwise the seed. */
export function Shell() {
  const { data: me } = useApi(() => api.me())
  useEffect(() => applyGuidance(), []) // Settings > Larger text, kept in this browser
  return (
    <div className="ui-shell grid h-screen grid-rows-[4rem_minmax(0,1fr)] overflow-hidden bg-bg text-ink">
      <Nav program={me?.program?.label ?? PROGRAM.label} initial={me?.initial ?? PATIENT.initial} />
      <main className="ui-main flex min-h-0 flex-col overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
