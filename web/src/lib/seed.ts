/** Illustrative local data matching the wireframes (Alex M., Dr. Rao, Hospital GRASP L2 v3).
 *  Phase 8 replaces this with the session service's store; all values are labeled illustrative. */

/** Web ids. `arm` is Arm to the front (hidden since 28 Sep); every other id is the service
 *  registry id (`perception/exercises.py`). */
export type ExerciseId = 'pendulum' | 'arm' | 'abduction' | 'cup' | 'nhpt' | 'external_rotation' | 'internal_rotation'
/** The list's three headings (locked set, 23 Sep 2026). */
export type ExerciseGroup = 'exercise' | 'activity' | 'demo'
export type Exercise = {
  id: ExerciseId
  /** Id in the service registry (`perception/exercises.py`), sent as `exercise=` on the socket. */
  serviceId: string
  name: string
  category: string
  /** Library card eyebrow and tag (design v2, the artifact's `LIB_TAGS`). Without them the card
   *  falls back to the category's parts, as the artifact does. */
  eyebrow?: string
  tag?: string
  group: ExerciseGroup
  /** `coached`: verified from OpenCV events only. `demo`: the avatar performs it and the patient
   *  ticks it; the camera never scores it. */
  mode: 'coached' | 'demo'
  /** Which live screen runs it (`/session?exercise=`); null for demo-only. */
  session: 'arm' | 'cup' | 'nhpt' | null
  /** Camera view the arm exercises are scored from. */
  view?: 'side' | 'front'
  weekly?: boolean
  equipment: string
  /** The printable calibration sheet (web/public/sheets, copied from docs/sheets by tools/make_sheets.py). */
  sheetPdf?: string
  dose: string
  /** Dose on a gentle day (pain 4–6), inside the prescription's allowed adaptations. */
  gentleDose?: string
  note: string
  clip: 'nhpt' | 'cup' | 'armFront' | 'pendulum' | 'abduction' | 'external_rotation' | 'internal_rotation'
  steps: string[]
  watchFor?: string
  stopIf?: string
  region: 'hand' | 'shoulder'
  /** Equipment ids (EQUIPMENT) the task needs; drives the "Equipment I have" filter. */
  needs: EquipmentId[]
  /** 28 Sep lock: dormant. Kept (clip, steps, service code) so the decision is reversible, but
   *  never shown, scheduled, demonstrated or run. Mirrors `visible=False` in the registry. */
  hidden?: true
}

export type EquipmentId = 'pegboard' | 'sheets' | 'cup' | 'weight' | 'table' | 'chair'
export const EQUIPMENT: { id: EquipmentId; label: string }[] = [
  { id: 'sheets', label: 'Printed sheets' },
  { id: 'pegboard', label: 'Pegboard and 9 pegs' },
  { id: 'cup', label: 'A cup' },
  { id: 'weight', label: 'Wrist weight (0.5–1 lb)' },
  { id: 'table', label: 'A sturdy table' },
  { id: 'chair', label: 'A chair without arms' },
]
/** What most homes have before the first visit; the patient edits this in "What I have". */
export const DEFAULT_EQUIPMENT: EquipmentId[] = ['sheets', 'cup', 'table', 'chair']

export const PATIENT = { name: 'Alex M.', initial: 'A', side: 'left' as const, goal: 'Use a cup on my own.', goalAttempts: 2 }
export const PROGRAM = { label: 'Hospital GRASP, Level 2 · Left side', short: 'Hospital GRASP L2 · v3', clinician: 'your therapist', level: 2, version: 3 }

const STOP_IF = 'pain rises or you feel dizzy'

/** Every registry entry, in list order, including the four hidden on 28 Sep (Pendulum, Arm to
 *  the front, Rotate out, Rotate in). Mirrors the service registry; steps are our own paraphrase
 *  (GRASP text is UBC / Heart & Stroke material, docs/LICENSES.md). Screens use `EXERCISES`. */
export const ALL_EXERCISES: Exercise[] = [
  { id: 'pendulum', serviceId: 'pendulum', name: 'Pendulum', category: 'Warm-up · shoulder', group: 'exercise', mode: 'coached', session: 'arm', view: 'side', hidden: true,
    equipment: 'A sturdy table', dose: '2 × 10 swings', gentleDose: '2 × 8 swings', note: 'Camera counts the swings from the side.', clip: 'pendulum', region: 'shoulder', needs: ['table'],
    steps: ['Stand and lean forward, resting your good hand on a table', 'Let the practising arm hang straight down, loose and heavy', "Swing it gently forward and back — let the weight do the work, don't lift", 'Stop if anything sharpens. This one should feel easy'],
    watchFor: 'lifting the arm instead of letting it swing', stopIf: STOP_IF },
  { id: 'arm', serviceId: 'flexion', name: 'Arm to the front', category: 'Arm strengthening · shoulder', eyebrow: 'Shoulder · range of motion', tag: 'Arm strengthening', group: 'exercise', mode: 'coached', session: 'arm', view: 'side', hidden: true,
    equipment: 'Chair · wrist weight 0.5–1 lb if prescribed', dose: '2 × 8 · hold 3 s · no higher than shoulder', gentleDose: '2 × 6 · hold 2 s · no higher than shoulder', note: 'Camera measures arm angle from the side and watches for leaning.', clip: 'armFront', region: 'shoulder', needs: ['chair'],
    steps: ['Sit tall, practising side toward the camera, arm by your side', 'Lift the straight arm to the front for a count of three', 'Hold at shoulder height for three — never higher', 'Lower for a count of three', 'Eight lifts, rest, then eight more'],
    watchFor: 'leaning back to lift, shoulder hiking', stopIf: STOP_IF },
  { id: 'abduction', serviceId: 'abduction', name: 'Arm out to the side', category: 'Arm strengthening · shoulder', eyebrow: 'Shoulder', tag: 'Arm strengthening', group: 'exercise', mode: 'coached', session: 'arm', view: 'front',
    equipment: 'A chair', dose: '2 sets of 8 · hold 3 s · up to shoulder height', gentleDose: '2 sets of 6 · hold 2 s · up to 60°', note: 'Raise your arm out to the side and hold. The camera measures how high it goes.', clip: 'abduction', region: 'shoulder', needs: ['chair'],
    steps: ['Sit tall facing the camera, arm by your side', 'Lift the arm out to the side, palm down, up to shoulder height', 'Hold, then lower slowly', "Keep the shoulder down — don't shrug it up toward your ear"],
    watchFor: 'Shrugging your shoulder or leaning away', stopIf: STOP_IF },
  { id: 'cup', serviceId: 'cup', name: 'Waiter – cup', category: 'Coordination · reach and place', eyebrow: 'Hand and arm', tag: 'Coordination', group: 'activity', mode: 'coached', session: 'cup',
    equipment: 'A cup and the printed target sheet', sheetPdf: '/sheets/cup_targets.pdf', dose: '2 slow arcs, then 2 fast', gentleDose: '2 slow arcs only', note: 'Move the cup in an arc from dot to dot across the sheet. The camera checks it lands on each one.', clip: 'cup', region: 'hand', needs: ['cup', 'sheets'],
    steps: ['Cup in your weaker hand, sheet in front of you', 'Cup off the sheet until the camera finds the four corners, then on dot 1, hand in your lap', 'Reach and move the cup to the next dot, one at a time', 'After dot 5, go back the way you came', 'Do that twice slowly, then twice more, as fast as you comfortably can'],
    watchFor: 'Your shoulder creeping up, or leaning to reach', stopIf: STOP_IF },
  { id: 'nhpt', serviceId: 'nhpt', name: 'Nine-Hole Peg Test', category: 'Standardized assessment · dexterity', eyebrow: 'Hand · dexterity', tag: 'Weekly test', group: 'activity', mode: 'coached', session: 'nhpt', weekly: true,
    equipment: 'A pegboard, 9 pegs and the printed marker sheet', sheetPdf: '/sheets/nhpt_board.pdf', dose: 'One timed try · once a week', note: 'Put all nine pegs in the holes. The timer runs from your first peg to your ninth.', clip: 'nhpt', region: 'hand', needs: ['pegboard', 'sheets'],
    steps: ['Pegs in the dish on the marked side, board on the printed sheet', 'When ready, pick up the first peg — the timer starts on your first lift', 'Place pegs in any hole, one at a time, as quickly as you comfortably can', 'The timer stops when the ninth peg is seated'],
    watchFor: 'Pegs dropping off the sheet', stopIf: STOP_IF },
  { id: 'external_rotation', serviceId: 'external_rotation', name: 'Rotate out', category: 'Shoulder rotation', group: 'demo', mode: 'demo', session: null, hidden: true,
    equipment: 'Chair', dose: '2 × 8 · hold 3 s', note: 'Demo only: the figure shows it, you tick it. One laptop camera cannot measure this honestly.', clip: 'external_rotation', region: 'shoulder', needs: ['chair'],
    steps: ['Sit tall, elbow tucked against your side and bent to a right angle', 'Keeping the elbow against you, swing the forearm outward, away from your tummy', 'Hold, then return slowly', 'The elbow stays glued to your side the whole time'],
    stopIf: STOP_IF },
  { id: 'internal_rotation', serviceId: 'internal_rotation', name: 'Rotate in', category: 'Shoulder rotation', group: 'demo', mode: 'demo', session: null, hidden: true,
    equipment: 'Chair', dose: '2 × 8 · hold 3 s', note: 'Demo only: the figure shows it, you tick it. One laptop camera cannot measure this honestly.', clip: 'internal_rotation', region: 'shoulder', needs: ['chair'],
    steps: ['Sit tall, elbow tucked against your side and bent to a right angle', 'Keeping the elbow against you, bring the forearm across toward your tummy', 'Hold, then return slowly', 'Small and slow beats big and fast'],
    stopIf: STOP_IF },
]

/** The three exercises of the 28 Sep lock: Arm out to the side, Waiter – cup, Nine-Hole Peg
 *  Test. Everything the patient sees is drawn from this list. */
export const EXERCISES: Exercise[] = ALL_EXERCISES.filter((e) => !e.hidden)

/** Library card [eyebrow, tag]; falls back to the category's parts like the artifact. */
export function libTags(e: Exercise): [string, string] {
  const parts = e.category.split(' · ')
  return [e.eyebrow ?? parts.slice(1).join(' · '), e.tag ?? parts[0]]
}

/** True when an id (web or service) names a hidden exercise: a deep link to it is redirected. */
export const isHiddenExercise = (id: string | null | undefined): boolean => ALL_EXERCISES.some((e) => e.hidden && (e.id === id || e.serviceId === id))

export const GROUPS: { id: ExerciseGroup; title: string; blurb: string }[] = [
  { id: 'exercise', title: 'Exercises', blurb: 'Camera coached. Reps count only when the camera verifies them.' },
  { id: 'activity', title: 'Activities', blurb: 'Camera coached on the printed sheets. The peg test is once a week.' },
  { id: 'demo', title: 'Demo only', blurb: 'The figure shows the movement and you tick each set yourself. The camera does not score these.' },
]

/** Visible exercises only: a hidden id resolves to nothing, so no screen can show it. */
export const exerciseById = (id: string | null | undefined): Exercise | undefined => EXERCISES.find((e) => e.id === id || e.serviceId === id)

/** What a bare `mode: 'arm'` runs since 28 Sep (the service's `DEFAULT_VISIBLE_ID`). */
const MODE_DEFAULT: Record<string, ExerciseId> = { arm: 'abduction' }

/** Enough of a stored session (or its summary) to say which exercise it was. The service puts
 *  `exercise` (registry id) on records and summaries; newer summaries also carry `exercise_id`,
 *  `exercise_name`, `target_deg` and `ceiling_deg` (null for Pendulum). */
export type SessionRef = {
  mode?: string
  exercise?: string | null
  summary?: { mode?: string; exercise?: string | null; exercise_id?: string | null; exercise_name?: string | null }
}

const sessionExerciseId = (s: SessionRef) => s.summary?.exercise_id ?? s.summary?.exercise ?? s.exercise

/** A stored session of an exercise hidden on 28 Sep (the service no longer lists those). */
export const isHiddenSession = (s: SessionRef): boolean => isHiddenExercise(sessionExerciseId(s))

/** The one place a report, the progress page or settings turns a session into an exercise.
 *  A bare `mode: 'arm'` resolves to Arm out to the side, as the service runs it since 28 Sep. A
 *  session of a hidden exercise resolves to nothing (the service does not list those). */
export function exerciseOfSession(s: SessionRef): Exercise | undefined {
  const id = sessionExerciseId(s)
  if (isHiddenExercise(id)) return undefined
  const mode = s.summary?.mode ?? s.mode
  return exerciseById(id) ?? exerciseById(mode) ?? exerciseById(MODE_DEFAULT[mode ?? ''])
}

export function sessionExerciseName(s: SessionRef): string {
  if (isHiddenExercise(sessionExerciseId(s))) return 'Session'
  return s.summary?.exercise_name || exerciseOfSession(s)?.name || s.summary?.mode || s.mode || 'Session'
}

/** Target line for a peak-angle chart: none for Pendulum (it counts swings and has no target
 *  angle) or when the service sends a null ceiling; else the session's own target, else the
 *  locked 90° ceiling. */
export function angleTarget(summary: { target_deg?: number | null; ceiling_deg?: number | null }, exerciseId: string | undefined): number | undefined {
  if (exerciseId === 'pendulum') return undefined
  if (summary.ceiling_deg === null) return undefined
  return summary.target_deg ?? 90
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** The next visit as the store gives it ("Thu 18 Sep, 2:30 PM"), or null once that day has
 *  passed, so a stale seeded date is never shown as upcoming. A month more than six months
 *  back is read as next year. Text without a day and month is passed through. */
export function upcomingVisit(text: string | null | undefined, now: Date = new Date()): string | null {
  if (!text) return null
  const m = text.match(/(\d{1,2})\s+([A-Za-z]{3})/)
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1
  if (!m || month < 0) return text
  let day = new Date(now.getFullYear(), month, Number(m[1]), 23, 59, 59)
  if (now.getTime() - day.getTime() > 182 * 86400e3) day = new Date(now.getFullYear() + 1, month, Number(m[1]), 23, 59, 59)
  return day >= now ? text : null
}

export const WEEK = { days: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], done: [true, true, false, true], todayIndex: 4, sessions: 3, minutes: 42, lastSession: '8 verified · pain 2→2' }

/** Home's affected areas (design v2, 6 Oct). Status is set by the program (no endpoint sets it
 *  yet); every number on the area card is derived from stored sessions in `lib/areaSummary.ts`.
 *  The primary action names only a visible exercise (28 Sep lock); design review 21 Oct removed
 *  the in-card program list. */
export const REGIONS: Record<'lShoulder' | 'lElbow' | 'lWrist', { title: string; status: 'focus' | 'watch' | 'stable'; setBy: string; primary: { label: string; to: string } }> = {
  lWrist: { title: 'Left hand', status: 'focus', setBy: 'Set by your program',
    primary: { label: 'Run the peg test', to: '/details/choose?next=nhpt' } },
  lShoulder: { title: 'Left shoulder', status: 'watch', setBy: 'Set by your program · watch for leaning',
    primary: { label: 'Practise Arm out to the side', to: '/details/demo?exercise=abduction&side=left' } },
  lElbow: { title: 'Left elbow', status: 'stable', setBy: 'No exercise assigned here',
    primary: { label: 'Practise Waiter – cup', to: '/details/demo?exercise=cup&side=left' } },
}
