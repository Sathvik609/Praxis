import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { api, useApi } from '../lib/api'

/** The guided path needs three answers before it can plan a day (side, goal, pain). A patient
 *  without them goes to `/welcome`; a patient with them goes through. When the service cannot
 *  be reached the screen renders anyway and says so itself — an unreachable service must never
 *  look like "you never signed up". */
export function RequireProfile({ children }: { children: ReactNode }) {
  const { data, error } = useApi(() => api.profile())
  if (!data && !error) {
    return (
      <div role="status" className="grid h-screen place-items-center bg-bg text-lg text-muted">
        Getting your plan ready…
      </div>
    )
  }
  if (data && data.profile === null) return <Navigate to="/welcome" replace />
  return <>{children}</>
}
