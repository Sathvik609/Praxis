import { useNavigate } from 'react-router-dom'
import { demoUrl, readSide } from '../../lib/day'
import type { ExerciseId } from '../../lib/seed'
import { CoachChat } from './CoachChat'

/** Deep-link page for `/details/coach` (Demonstration's "Ask a question" links here): the
 *  library coach (`CoachChat`), open. Close goes back; Begin setup opens the demonstration. */
export function CoachDrawer() {
  const nav = useNavigate()
  const side = readSide() ?? 'left'
  return (
    <div className="min-h-full">
      <CoachChat open onOpenChange={(v) => !v && nav(-1)} side={side} onBegin={(id) => nav(demoUrl(id as ExerciseId, side))} />
    </div>
  )
}
