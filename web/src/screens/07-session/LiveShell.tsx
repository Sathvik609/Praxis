import { type ReactNode, type RefObject } from 'react'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Bot, ListChecks, Play } from '../../design/Icon'
import { Panel } from '../../design/Panel'
import { Stat } from '../../design/Stat'
import { plural } from '../../lib/plural'
import { CameraBlocked } from '../../session/CameraBlocked'
import { LiveIndicator } from '../../session/LiveIndicator'
import { COACH_LABEL, type AgentStatus, type CoachSource } from '../../session/agent'
import { AgentStatusChip, STATUS_ICON } from './SessionChrome'
import { type LiveStatus, type StatusLabel } from '../../session/liveStatus'
import { OverlayCanvas, type FrameEvent } from '../../session/OverlayCanvas'

/** Pre-v2 pieces of screens 07 / 07b / 07c. The design v2 chrome lives in `SessionChrome.tsx`;
 *  `SessionHeader`, `LiveFeed`, `CoachCard` and `VerifiedTally` here stay only until the three
 *  live screens move onto it (design v2 port, Tasks 13–15), then they are deleted. */

export function SessionHeader({ title, subtitle, status, label, agent = null }: { title: string; subtitle: ReactNode; status: LiveStatus; label: StatusLabel; agent?: AgentStatus | null }) {
  return (
    <header className="flex h-16 items-center gap-6 border-b border-line bg-surface px-6">
      <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
      <span className="whitespace-nowrap text-xl font-bold">{title}</span>
      <span className="min-w-0 truncate text-muted">{subtitle}</span>
      <span className="ml-auto flex items-center gap-3">
        <AgentStatusChip status={agent} />
        <Chip tone={label.tone} icon={STATUS_ICON[status]}>{label.chip}</Chip>
      </span>
    </header>
  )
}

/** The camera stage: Panel with the live indicator + feed label (top-left), the exercise's
 *  tracking words (top-right), an optional dark measurement band (bottom-left), the replay
 *  badge (bottom-right) and the camera-blocked card. The OpenCV and latency lines are developer
 *  text and live in the trace panel ("Show trace"), not over the patient's video.
 *  Frames never reach the browser in replay; the overlay is drawn from events either way.
 *  `isolate` keeps the slots' z-index inside the panel so session dialogs always paint above
 *  it. */
export function LiveFeed({
  replay,
  camActive,
  status,
  videoRef,
  frame,
  feedLabel,
  tracking,
  band,
  onRetry,
  className = '', errorDetail}: {
  replay: boolean
  camActive: boolean
  status: LiveStatus
  videoRef: RefObject<HTMLVideoElement | null>
  frame: FrameEvent | null
  feedLabel: ReactNode
  tracking?: ReactNode
  band?: ReactNode
  onRetry: () => void
  errorDetail?: string | null
  className?: string
}) {
  return (
    <Panel
      className={`isolate ${className}`}
      topLeft={
        <>
          <LiveIndicator active={camActive} replay={replay} />
          <span className="text-lg text-white/85">· {feedLabel}</span>
        </>
      }
      topRight={tracking ? <span className="rounded-lg bg-black/55 px-3 py-1 text-lg">{tracking}</span> : undefined}
    >
      {replay ? (
        <div aria-hidden className="aspect-4/3 w-full bg-[linear-gradient(180deg,var(--stage-a),var(--stage-b))]" />
      ) : (
        <video ref={videoRef} muted playsInline className="aspect-4/3 w-full -scale-x-100 object-cover" />
      )}
      <OverlayCanvas width={640} height={480} calibration={null} frame={frame} mirrored={!replay} />
      {/* Bottom bar: measurement band on the left, replay badge on the right. */}
      <div className="pointer-events-none absolute inset-x-4 bottom-3 z-10 flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col items-start gap-2">
          {band && <div className="rounded-lg bg-black/65 px-3 py-1.5 text-xl font-bold tabular-nums text-white">{band}</div>}
        </div>
        {replay && (
          <div className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-[#E9A23B]/70 bg-black/65 px-3 py-1.5 text-lg font-bold text-[#E9A23B]">
            <Play aria-hidden className="h-4 w-4" />
            Replay · processed on the service
          </div>
        )}
      </div>
      {(status === 'camera_blocked' || status === 'service_unreachable') && (
        <div className="absolute inset-0 z-20"><CameraBlocked reason={status} detail={errorDetail} onRetry={onRetry} /></div>
      )}
    </Panel>
  )
}

/** Coach caption card: cue text ≥ 24 px, labeled with the coach implementation that said it
 *  (the event's `label`); the watch tone is for posture / correction cues. Agent and rule cues
 *  differ by label text and icon, never by colour alone. */
export function CoachCard({ text, label, source = 'rule', watch = false }: { text: string; label: string; source?: CoachSource; watch?: boolean }) {
  return (
    <Card tone={watch ? 'watch' : 'coach'}>
      <div className="text-lg text-muted">Coach{watch ? ' · posture' : ''}</div>
      <p className="text-2xl">{text}</p>
      <div data-source={source} className="mt-2 flex items-center gap-2 text-lg text-muted">
        {source === 'agent' ? <Bot aria-hidden className="h-5 w-5 shrink-0" /> : <ListChecks aria-hidden className="h-5 w-5 shrink-0" />}
        <span>{label}</span>
      </div>
    </Card>
  )
}

export { COACH_LABEL }

export { AgentStatusChip }

/** Verified vs unverified, the same component on every live screen (CLAUDE.md §1: "verified vs
 *  unverified counts everywhere"). Counts come from the camera totals the service sends, never
 *  from the avatar. The word carries the meaning; amber only echoes a non-zero unverified.
 *  `compact` is one line for the tighter arm and peg-test columns; the full card is the
 *  wireframe's "This session" block (07b). `noun` is singular ("peg", "reach"); the tally
 *  pluralises it by the count (`lib/plural`). */
export function VerifiedTally({ total, unverified, noun, note, compact = false }: { total: number; unverified: number; noun: string; note?: ReactNode; compact?: boolean }) {
  const verified = Math.max(0, total - unverified)
  if (compact) {
    return (
      <Card as="div" padding="sm" aria-label="Verified and unverified counts">
        <p className="text-lg tabular-nums">
          <b>{verified}</b> verified · <b className={unverified ? 'text-amber-ink' : ''}>{unverified}</b> unverified · {total} {plural(total, noun)}
        </p>
        {note && <p className="text-lg text-muted">{note}</p>}
      </Card>
    )
  }
  return (
    <Card title="This session" aria-label="Verified and unverified counts">
      <div className="grid grid-cols-3 gap-3">
        <Stat value={total} label={plural(total, noun)} />
        <Stat value={verified} label="verified" />
        <Stat value={unverified} label="unverified" tone={unverified ? 'amber' : 'default'} />
      </div>
      {note && <div className="mt-2 text-lg text-muted">{note}</div>}
    </Card>
  )
}
