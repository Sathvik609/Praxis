import type { ArmSnapshot } from '../../session/OverlayCanvas'

/** The generalised arm FSM sends `phase` with every frame (E-SVC-3). Older builds only send
 *  the FSM `state`, so the phase is derived from it when it is missing — the guided screen is
 *  never blank because one field has not shipped yet. */
export type Phase = 'start' | 'lift' | 'hold' | 'lower'

export type GuidedArm = ArmSnapshot & {
  exercise?: string
  view_required?: 'side' | 'front'
  phase?: Phase
  rep_progress?: number
}

const FROM_STATE: Record<string, Phase> = { moving: 'lift', target_reached: 'hold', hold: 'hold', return: 'lower', start_pose: 'start' }

export function phaseOf(arm: GuidedArm | null | undefined): Phase {
  if (!arm) return 'start'
  if (arm.phase) return arm.phase
  return FROM_STATE[arm.state] ?? 'start'
}

/** What the coach says while nothing else is talking. Every line is about the next movement,
 *  never about a score. */
export function phaseLine(arm: GuidedArm | null | undefined): string {
  if (arm?.finished) return 'That is everything. Rest your arm.'
  switch (phaseOf(arm)) {
    case 'hold': {
      const left = Math.max(0, Math.ceil((arm?.hold_s ?? 3) * (1 - (arm?.hold_progress ?? 0))))
      return `Hold it there… ${left}`
    }
    case 'lift':
      return 'Lift slowly, as far as is comfortable.'
    case 'lower':
      return 'And lower slowly.'
    default:
      return 'Ready when you are.'
  }
}

/** 0..1 through the current rep, for the ring beside the count. */
export function repProgress(arm: GuidedArm | null | undefined): number {
  if (!arm) return 0
  if (typeof arm.rep_progress === 'number') return Math.min(1, Math.max(0, arm.rep_progress))
  return phaseOf(arm) === 'hold' ? arm.hold_progress ?? 0 : 0
}
