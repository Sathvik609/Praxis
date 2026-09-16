import { useSearchParams } from 'react-router-dom'
import { LiveArm } from './LiveArm'
import { LiveCup } from './LiveCup'
import { LiveNhpt } from './LiveNhpt'

/** `/session?exercise=nhpt|cup|arm` → the matching live screen. */
export function SessionRouter() {
  const [sp] = useSearchParams()
  const exercise = sp.get('exercise') ?? 'nhpt'
  if (exercise === 'cup') return <LiveCup />
  if (exercise === 'arm') return <LiveArm />
  return <LiveNhpt />
}
