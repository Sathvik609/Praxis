import { api, useApi } from '../../lib/api'
import { coachLabel, coachSource, proposalContext, type CoachSource } from '../../session/agent'
import type { CoachEvent, Overlay } from '../../session/useCoach'
import type { useCoachPrompt } from '../../session/useCoachPrompt'
import { CoachPrompt } from './CoachPrompt'

type PromptState = ReturnType<typeof useCoachPrompt>

/** The open coach prompt on a live screen (07 / 07b / 07c). The prescription is read when a
 *  prompt opens so a proposal can say where it starts and what the program allows; `running`
 *  holds the values the screen already knows from the frame (the arm's current target, the cup
 *  pace). `onChoose` overrides the answer (the cup's local progression fallback). */
export function LivePrompt({ state, running = {}, onChoose }: { state: PromptState; running?: Record<string, number | string | null | undefined>; onChoose?: (choice: string, index: number) => void }) {
  const { data: rx } = useApi(() => api.prescription())
  if (!state.prompt) return null
  const ctx = state.prompt.proposal ? proposalContext(state.prompt.proposal, rx, running) : undefined
  return <CoachPrompt prompt={state.prompt} proposalContext={ctx} onChoose={onChoose ?? state.choose} whyOpen={state.whyOpen} whyText={state.whyText} />
}

/** The latest coach cue said after a pause opened (not a prompt's own text): the setup-recovery
 *  instruction, captioned inside the paused overlay because the modal hides the coach card. */
export function pausedNote(decisions: CoachEvent[], overlay: Overlay | null): { text: string; label: string; source: CoachSource } | null {
  if (!overlay || overlay.kind === 'stopped' || overlay.id == null) return null
  const since = overlay.id
  const cue = [...decisions].reverse().find((e) => e.id > since && !e.ui?.prompt)
  return cue ? { text: cue.text, label: coachLabel(cue), source: coachSource(cue) } : null
}
