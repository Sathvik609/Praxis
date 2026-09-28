import { useState } from 'react'
import { Button } from '../../design/Button'
import { Activity, AlertTriangle, Info, Pause, X } from '../../design/Icon'
import { Overlay, OverlayActions } from '../../design/Overlay'

type Props = {
  onPause: () => void
  onRest: () => void
  onPain: () => void
  onEnd: () => void
  traceOpen: boolean
  onToggleTrace: () => void
}

/** Fixed control bar on every in-session screen (CLAUDE.md §1 screens rule): Pause · Take a
 *  rest · Pain / feel unwell · End session, plus the trace toggle. Labels are fixed; icons are
 *  decorative; every target is ≥ 56 px. Pain / feel unwell carries the safety style (thick red
 *  outline on a red tint + icon + words). End session asks before it ends. Push to talk is not
 *  shown until voice control exists (Polly, W6): a control that does nothing is not offered. */
export function SessionControls({ onPause, onRest, onPain, onEnd, traceOpen, onToggleTrace }: Props) {
  const [confirming, setConfirming] = useState(false)
  return (
    <footer className="flex h-20 items-center gap-3 whitespace-nowrap border-t border-line bg-surface px-6">
      <Button variant="secondary" icon={<Pause />} onClick={onPause}>
        Pause
      </Button>
      <Button variant="secondary" icon={<Activity />} onClick={onRest}>
        Take a rest
      </Button>
      <Button variant="safety" icon={<AlertTriangle />} onClick={onPain}>
        Pain / feel unwell
      </Button>
      <Button variant="secondary" icon={<Info />} className="ml-auto" aria-pressed={traceOpen} onClick={onToggleTrace}>
        {traceOpen ? 'Hide trace' : 'Show trace'}
      </Button>
      <Button variant="danger" icon={<X />} onClick={() => setConfirming(true)}>
        End session
      </Button>
      <Overlay open={confirming} title="End this session?" description="Ending saves what the camera has verified so far." onClose={() => setConfirming(false)} className="w-[min(640px,92vw)]">
        <p className="mt-3 text-xl">What the camera has verified so far is saved, and you can say how it went.</p>
        <OverlayActions>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Keep going
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirming(false)
              onEnd()
            }}
          >
            Yes, end session
          </Button>
        </OverlayActions>
      </Overlay>
    </footer>
  )
}
