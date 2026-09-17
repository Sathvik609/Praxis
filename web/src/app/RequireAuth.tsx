import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getSession } from '../lib/auth'

/** Every screen sits behind sign-in; the wanted route is kept so sign-in can return to it. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const loc = useLocation()
  if (!getSession()) return <Navigate to="/signin" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}
