import { Button } from '../../design/Button'
import { Activity, AlertTriangle, Info, Mic, Pause, X } from '../../design/Icon'

type Props = {
  onPause: () => void
  onRest: () => void
  onPain: () => void
  onEnd: () => void
  traceOpen: boolean
  onToggleTrace: () => void
}

/** Fixed control bar on every in-session screen (CLAUDE.md §1 screens rule): Pause · Take a
 *  rest · Pain / feel unwell · End session, plus Push to talk (off until Polly) and the trace
 *  toggle. Labels are fixed; icons are decorative; every target is ≥ 56 px. */
export function SessionControls({ onPause, onRest, onPain, onEnd, traceOpen, onToggleTrace }: Props) {
  return (
    <footer className="flex h-20 items-center gap-3 whitespace-nowrap border-t border-line bg-surface px-6">
      <Button variant="secondary" icon={<Pause />} onClick={onPause}>
        Pause
      </Button>
      <Button variant="secondary" icon={<Activity />} onClick={onRest}>
        Take a rest
      </Button>
      <Button variant="ghost" icon={<AlertTriangle />} onClick={onPain}>
        Pain / feel unwell
      </Button>
      <Button variant="secondary" icon={<Mic />} disabled title="Voice control arrives with Polly (cloud mode)">
        Push to talk
      </Button>
      <Button variant="secondary" icon={<Info />} className="ml-auto" aria-pressed={traceOpen} onClick={onToggleTrace}>
        {traceOpen ? 'Hide trace' : 'Show trace'}
      </Button>
      <Button variant="danger" icon={<X />} onClick={onEnd}>
        End session
      </Button>
    </footer>
  )
}
