import { Button } from '../../design/Button'

type Props = {
  onPause: () => void
  onRest: () => void
  onPain: () => void
  onEnd: () => void
  traceOpen: boolean
  onToggleTrace: () => void
}

/** Fixed control bar on every in-session screen (CLAUDE.md §1 screens rule). */
export function SessionControls({ onPause, onRest, onPain, onEnd, traceOpen, onToggleTrace }: Props) {
  return (
    <footer className="flex h-20 items-center gap-4 border-t border-line bg-surface px-8">
      <Button variant="secondary" onClick={onPause}>
        Pause
      </Button>
      <Button variant="secondary" onClick={onRest}>
        Take a rest
      </Button>
      <Button variant="ghost" onClick={onPain}>
        Pain / feel unwell
      </Button>
      <span className="text-muted">Talk to coach · Repeat cue · Captions</span>
      <Button variant="secondary" disabled title="Voice control arrives with the coach (Phase 7)">
        Push to talk
      </Button>
      <Button variant="secondary" className="ml-auto" onClick={onToggleTrace}>
        {traceOpen ? 'Hide trace' : 'Show trace'}
      </Button>
      <Button variant="danger" onClick={onEnd}>
        End session
      </Button>
    </footer>
  )
}
