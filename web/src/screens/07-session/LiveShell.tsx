import { COACH_LABEL } from '../../session/agent'
import { AgentStatusChip } from './SessionChrome'

/** Re-exports kept for older imports. The live session chrome (header, feed, coach and stats
 *  cards, hold, bar) is `SessionChrome.tsx`; the pre-v2 `LiveFeed`, `CoachCard`, `VerifiedTally`
 *  and header were removed once the three live screens moved onto it (design v2). */
export { AgentStatusChip, COACH_LABEL }
