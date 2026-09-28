import { useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { exerciseById, isHiddenExercise } from '../../lib/seed'
import { applyGuidance } from '../../session/guidance'
import { LiveArm } from './LiveArm'
import { LiveCup } from './LiveCup'
import { LiveNhpt } from './LiveNhpt'

/** `/session?exercise=<id>` → the matching live screen: `cup`, `nhpt` or the arm exercise
 *  (`abduction`). A hidden exercise (28 Sep, `isHiddenExercise`) goes back to Choose exercise and never opens the camera. A demo-only exercise has no live
 *  screen (the camera never scores it), so its link goes to the Demonstration. Anything
 *  unknown keeps the old default, the peg test. */
export function SessionRouter() {
  const [sp] = useSearchParams()
  useEffect(() => applyGuidance(), []) // Settings > Larger text also applies in session
  if (isHiddenExercise(sp.get('exercise'))) return <Navigate to="/details/choose" replace />
  const ex = exerciseById(sp.get('exercise') ?? 'nhpt')
  if (ex?.mode === 'demo') return <Navigate to={`/details/demo?exercise=${ex.id}&side=${sp.get('side') ?? 'left'}`} replace />
  if (ex?.session === 'cup') return <LiveCup />
  if (ex?.session === 'arm') return <LiveArm />
  return <LiveNhpt />
}
