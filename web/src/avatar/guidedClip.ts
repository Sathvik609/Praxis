import type { ComponentProps } from 'react'
import type { AvatarPanel } from './AvatarPanel'
import { CLIPS } from './clips'

/** The seven shoulder exercises in the service registry (E-SVC-2). Each one's recorded clip is
 *  named after it. */
export const REHAB_EXERCISES: string[] = ['pendulum', 'flexion', 'abduction', 'scaption', 'extension', 'external_rotation', 'internal_rotation']

/** Capability probe, not an import: the rehab clips (`avatar/clips/rehab/*.json`) and the
 *  `figure="skeleton"` mode land on their own branch. `import.meta.glob` is `{}` here and the
 *  real file list once the two branches meet, so this file needs no edit on merge. */
const REHAB_FILES = import.meta.glob('./clips/rehab/*.json')
const hasRehabClip = (id: string) => `./clips/rehab/${id}.json` in REHAB_FILES

export type GuidedClip = { clip: keyof typeof CLIPS; figure?: 'skeleton' }

/** Adapter between the guided screens and the avatar. An exercise the avatar cannot draw yet
 *  resolves to the arm clip with no figure mode, so the guided screens show something sensible
 *  now and the recorded clip the moment it exists. Nothing else in the guided path reaches
 *  into `avatar/`.
 *
 *  The clips run at their recorded range (peaks well above the 90° flexion ceiling): the figure
 *  demonstrates the movement, and every target the patient is measured against comes from the
 *  service plan (`target_deg` / `ceiling_deg`), never from the figure. */
export function guidedClip(exerciseId?: string | null, clipName?: string | null): GuidedClip {
  const name = clipName || exerciseId || ''
  if (name in CLIPS) return { clip: name as keyof typeof CLIPS, figure: 'skeleton' }
  if (REHAB_EXERCISES.includes(name) && hasRehabClip(name)) return { clip: name as keyof typeof CLIPS, figure: 'skeleton' }
  return { clip: 'armFront' }
}

type PanelProps = ComponentProps<typeof AvatarPanel>

/** `AvatarPanel` props for a plan item. The one cast in the guided path: `figure` is not in
 *  `AvatarPanel`'s props until the rehab branch merges, and today's panel ignores props it does
 *  not know. */
export function guidedAvatarProps(exerciseId: string | null | undefined, clipName: string | null | undefined, rest: Omit<PanelProps, 'clip'>): PanelProps {
  const { clip, figure } = guidedClip(exerciseId, clipName)
  return { ...rest, clip, ...(figure ? { figure } : {}) } as PanelProps
}
