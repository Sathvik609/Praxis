import { useSearchParams } from 'react-router-dom'
import { LiveCup } from './LiveCup'
import { LiveNhpt } from './LiveNhpt'
import { Pending } from '../placeholders'

/** `/session?exercise=nhpt|cup|arm` → the matching live screen. */
export function SessionRouter() {
  const [sp] = useSearchParams()
  const exercise = sp.get('exercise') ?? 'nhpt'
  if (exercise === 'cup') return <LiveCup />
  if (exercise === 'arm') return <Pending n="07c" title="Live session · Arm to the front (Phase 5)" />
  return <LiveNhpt />
}
