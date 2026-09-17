import type { ComponentProps } from 'react'
import type { AvatarPanel } from './AvatarPanel'
import { CLIPS } from './clips'

/** The seven shoulder exercises in the service registry (E-SVC-2). Each one's clip is named
 *  after it. */
export const REHAB_EXERCISES = ['pendulum', 'flexion', 'abduction', 'scaption', 'extension', 'external_rotation', 'internal_rotation'] as const

export type GuidedClip = { clip: keyof typeof CLIPS; figure?: 'skeleton' }

/** Adapter between the guided screens and the avatar.
 *
 *  The rehab clips (`pendulum`, `flexion`, `abduction`, …) and the `figure="skeleton"` mode are
 *  being added to `AvatarPanel` on a separate branch. Until that lands, an unknown clip name
 *  resolves to the arm clip with no figure mode, so the guided screens draw something sensible
 *  now and light up with the real clip the moment the two branches meet. Nothing else in the
 *  guided path reaches into `avatar/`. */
export function guidedClip(exerciseId?: string | null, clipName?: string | null): GuidedClip {
  const name = clipName || exerciseId || ''
  if (name in CLIPS) return { clip: name as keyof typeof CLIPS, figure: 'skeleton' }
  return { clip: 'armFront' }
}

type PanelProps = ComponentProps<typeof AvatarPanel>

/** `AvatarPanel` props for a plan item. The one cast in the guided path: `figure` is not in
 *  `AvatarPanel`'s props yet (see above) and today's panel ignores props it does not know. */
export function guidedAvatarProps(exerciseId: string | null | undefined, clipName: string | null | undefined, rest: Omit<PanelProps, 'clip'>): PanelProps {
  const { clip, figure } = guidedClip(exerciseId, clipName)
  return { ...rest, clip, ...(figure ? { figure } : {}) } as PanelProps
}
