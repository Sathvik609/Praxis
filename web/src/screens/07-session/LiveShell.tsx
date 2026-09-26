import type { ReactNode, RefObject } from 'react'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { AlertTriangle, Camera, Check, Pause, Play, X } from '../../design/Icon'
import { Panel } from '../../design/Panel'
import { Stat } from '../../design/Stat'
import { CameraBlocked } from '../../session/CameraBlocked'
import { LiveIndicator } from '../../session/LiveIndicator'
import { type LiveStatus, type StatusLabel } from '../../session/liveStatus'
import { OverlayCanvas, type FrameEvent } from '../../session/OverlayCanvas'

/** Shared pieces of screens 07 / 07b / 07c so the three live screens stay one design. */

const STATUS_ICON: Record<LiveStatus, ReactNode> = {
  connecting: <Camera />,
  waiting_for_frames: <Camera />,
  camera_blocked: <X />,
  service_unreachable: <X />,
  calibrating: <AlertTriangle />,
  lost: <AlertTriangle />,
  tracking: <Check />,
  replay: <Play />,
  paused: <Pause />,
  ended: <Check />,
}

export function SessionHeader({ title, subtitle, status, label }: { title: string; subtitle: ReactNode; status: LiveStatus; label: StatusLabel }) {
  return (
    <header className="flex h-16 items-center gap-6 border-b border-line bg-surface px-6">
      <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
      <span className="whitespace-nowrap text-xl font-bold">{title}</span>
      <span className="min-w-0 truncate text-muted">{subtitle}</span>
      <span className="ml-auto flex items-center gap-3">
        <Chip tone={label.tone} icon={STATUS_ICON[status]}>{label.chip}</Chip>
      </span>
    </header>
  )
}

/** The camera stage: Panel with the live indicator + feed label (top-left), the exercise's
 *  tracking words (top-right), an optional dark measurement band, the OpenCV line and the
 *  latency line (bottom-left), the replay badge (bottom-right) and the camera-blocked card.
 *  Frames never reach the browser in replay; the overlay is drawn from events either way.
 *  `isolate` keeps the slots' z-index inside the panel so session dialogs always paint above
 *  it. `latencyLine` is `latencyLine(useLatency(events))`: rolling p50/p95 over the last 60
 *  frames and cues (Sprint D, D-LAT). */
export function LiveFeed({
  replay,
  camActive,
  status,
  videoRef,
  frame,
  feedLabel,
  tracking,
  band,
  cvLine,
  latencyLine,
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
  cvLine: ReactNode
  latencyLine?: ReactNode
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
      {/* Bottom bar: measurement band + OpenCV line on the left, replay badge on the right; a
          flex row so the badge never overlaps a long OpenCV line. */}
      <div className="pointer-events-none absolute inset-x-4 bottom-3 z-10 flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col items-start gap-2">
          {band && <div className="rounded-lg bg-black/65 px-3 py-1.5 text-xl font-bold tabular-nums text-white">{band}</div>}
          <div className="text-base text-white/80">{cvLine}</div>
          {latencyLine && <div className="text-base tabular-nums text-white/80">{latencyLine}</div>}
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

/** Coach caption card: cue text ≥ 24 px, labeled with the coach implementation; the watch tone
 *  is for posture / correction cues. */
export function CoachCard({ text, label, watch = false }: { text: string; label: string; watch?: boolean }) {
  return (
    <Card tone={watch ? 'watch' : 'coach'}>
      <div className="text-lg text-muted">Coach{watch ? ' · posture' : ''}</div>
      <p className="text-2xl">{text}</p>
      <div className="mt-2 text-lg text-muted">{label}</div>
    </Card>
  )
}

export const COACH_LABEL = 'Rule-based coach · LLM agent pending'

/** Verified vs unverified, the same component on every live screen (CLAUDE.md §1: "verified vs
 *  unverified counts everywhere"). Counts come from the camera totals the service sends, never
 *  from the avatar. The word carries the meaning; amber only echoes a non-zero unverified.
 *  `compact` is one line for the tighter arm and peg-test columns; the full card is the
 *  wireframe's "This session" block (07b). */
export function VerifiedTally({ total, unverified, noun, note, compact = false }: { total: number; unverified: number; noun: string; note?: ReactNode; compact?: boolean }) {
  const verified = Math.max(0, total - unverified)
  if (compact) {
    return (
      <Card as="div" padding="sm" aria-label="Verified and unverified counts">
        <p className="text-lg tabular-nums">
          <b>{verified}</b> verified · <b className={unverified ? 'text-amber-ink' : ''}>{unverified}</b> unverified · {total} {noun}
        </p>
        {note && <p className="text-lg text-muted">{note}</p>}
      </Card>
    )
  }
  return (
    <Card title="This session" aria-label="Verified and unverified counts">
      <div className="grid grid-cols-3 gap-3">
        <Stat value={total} label={noun} />
        <Stat value={verified} label="verified" />
        <Stat value={unverified} label="unverified" tone={unverified ? 'amber' : 'default'} />
      </div>
      {note && <div className="mt-2 text-lg text-muted">{note}</div>}
    </Card>
  )
}
