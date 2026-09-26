/** Illustrative local data matching the wireframes (Alex M., Dr. Rao, Hospital GRASP L2 v3).
 *  Phase 8 replaces this with the session service's store; all values are labeled illustrative. */
import type { Marker } from '../avatar/markers'

/** Web ids. `arm` is Arm to the front (kept so `/session?exercise=arm` and replay links still
 *  resolve); every other id is the service registry id (`perception/exercises.py`). */
export type ExerciseId = 'pendulum' | 'arm' | 'abduction' | 'cup' | 'nhpt' | 'external_rotation' | 'internal_rotation'
/** The list's three headings (locked set, 23 Sep 2026). */
export type ExerciseGroup = 'exercise' | 'activity' | 'demo'
export type Exercise = {
  id: ExerciseId
  /** Id in the service registry (`perception/exercises.py`), sent as `exercise=` on the socket. */
  serviceId: string
  name: string
  category: string
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
export const PROGRAM = { label: 'Hospital GRASP, Level 2 · Left side', short: 'Hospital GRASP L2 · v3 · Dr. Rao', clinician: 'Dr. Anita Rao, OT', nextVisit: 'Thu 18 Sep, 2:30 PM', level: 2, version: 3 }

const STOP_IF = 'pain rises or you feel dizzy'

/** The locked set of 23 Sep 2026, in list order. Mirrors the service registry; steps are our own
 *  paraphrase (GRASP text is UBC / Heart & Stroke material, docs/LICENSES.md). */
export const EXERCISES: Exercise[] = [
  { id: 'pendulum', serviceId: 'pendulum', name: 'Pendulum', category: 'Warm-up · shoulder', group: 'exercise', mode: 'coached', session: 'arm', view: 'side',
    equipment: 'A sturdy table', dose: '2 × 10 swings', gentleDose: '2 × 8 swings', note: 'Camera counts the swings from the side.', clip: 'pendulum', region: 'shoulder', needs: ['table'],
    steps: ['Stand and lean forward, resting your good hand on a table', 'Let the practising arm hang straight down, loose and heavy', "Swing it gently forward and back — let the weight do the work, don't lift", 'Stop if anything sharpens. This one should feel easy'],
    watchFor: 'lifting the arm instead of letting it swing', stopIf: STOP_IF },
  { id: 'arm', serviceId: 'flexion', name: 'Arm to the front', category: 'Arm strengthening · shoulder', group: 'exercise', mode: 'coached', session: 'arm', view: 'side',
    equipment: 'Chair · wrist weight 0.5–1 lb if prescribed', dose: '2 × 8 · hold 3 s · no higher than shoulder', gentleDose: '2 × 6 · hold 2 s · no higher than shoulder', note: 'Camera measures arm angle from the side and watches for leaning.', clip: 'armFront', region: 'shoulder', needs: ['chair'],
    steps: ['Sit tall, practising side toward the camera, arm by your side', 'Lift the straight arm to the front for a count of three', 'Hold at shoulder height for three — never higher', 'Lower for a count of three', 'Eight lifts, rest, then eight more'],
    watchFor: 'leaning back to lift, shoulder hiking', stopIf: STOP_IF },
  { id: 'abduction', serviceId: 'abduction', name: 'Arm out to the side', category: 'Arm strengthening · shoulder', group: 'exercise', mode: 'coached', session: 'arm', view: 'front',
    equipment: 'Chair', dose: '2 × 8 · hold 3 s · no higher than shoulder', gentleDose: '2 × 6 · hold 2 s · up to 60°', note: 'Camera measures arm angle from the front.', clip: 'abduction', region: 'shoulder', needs: ['chair'],
    steps: ['Sit tall facing the camera, arm by your side', 'Lift the arm out to the side, palm down, up to shoulder height', 'Hold, then lower slowly', "Keep the shoulder down — don't shrug it up toward your ear"],
    watchFor: 'shrugging the shoulder, leaning away', stopIf: STOP_IF },
  { id: 'cup', serviceId: 'cup', name: 'Waiter – cup', category: 'Coordination · reach and place', group: 'activity', mode: 'coached', session: 'cup',
    equipment: 'Cup + printed target sheet', dose: '2 slow arcs, then 2 fast', gentleDose: '2 slow arcs only', note: 'Camera verifies the cup on each of the five dots.', clip: 'cup', region: 'hand', needs: ['cup', 'sheets'],
    steps: ['Cup in your weaker hand, sheet in front of you', 'Place the cup on dot 1, then rest your hand in your lap', 'Reach and move the cup to the next dot, one at a time', 'After dot 5, go back the way you came', 'Repeat twice, then twice as fast as you can'],
    watchFor: 'shoulder creeping up, leaning to reach', stopIf: STOP_IF },
  { id: 'nhpt', serviceId: 'nhpt', name: 'Nine-Hole Peg Test', category: 'Standardized assessment · dexterity', group: 'activity', mode: 'coached', session: 'nhpt', weekly: true,
    equipment: 'Pegboard + 9 pegs · printed marker sheet', dose: 'Timed, one attempt each hand · weekly', note: 'Timer starts at first peg lift, stops at ninth seated peg.', clip: 'nhpt', region: 'hand', needs: ['pegboard', 'sheets'],
    steps: ['Pegs in the dish on the marked side, board on the printed sheet', 'When ready, pick up the first peg — the timer starts on your first lift', 'Place pegs in any hole, one at a time, as quickly as you comfortably can', 'The timer stops when the ninth peg is seated'],
    watchFor: 'dropping pegs off the sheet', stopIf: STOP_IF },
  { id: 'external_rotation', serviceId: 'external_rotation', name: 'Rotate out', category: 'Shoulder rotation', group: 'demo', mode: 'demo', session: null,
    equipment: 'Chair', dose: '2 × 8 · hold 3 s', note: 'Demo only: the figure shows it, you tick it. One webcam cannot measure this honestly.', clip: 'external_rotation', region: 'shoulder', needs: ['chair'],
    steps: ['Sit tall, elbow tucked against your side and bent to a right angle', 'Keeping the elbow against you, swing the forearm outward, away from your tummy', 'Hold, then return slowly', 'The elbow stays glued to your side the whole time'],
    stopIf: STOP_IF },
  { id: 'internal_rotation', serviceId: 'internal_rotation', name: 'Rotate in', category: 'Shoulder rotation', group: 'demo', mode: 'demo', session: null,
    equipment: 'Chair', dose: '2 × 8 · hold 3 s', note: 'Demo only: the figure shows it, you tick it. One webcam cannot measure this honestly.', clip: 'internal_rotation', region: 'shoulder', needs: ['chair'],
    steps: ['Sit tall, elbow tucked against your side and bent to a right angle', 'Keeping the elbow against you, bring the forearm across toward your tummy', 'Hold, then return slowly', 'Small and slow beats big and fast'],
    stopIf: STOP_IF },
]

export const GROUPS: { id: ExerciseGroup; title: string; blurb: string }[] = [
  { id: 'exercise', title: 'Exercises', blurb: 'Camera coached. Reps count only when the camera verifies them.' },
  { id: 'activity', title: 'Activities', blurb: 'Camera coached on the printed sheets. The peg test is once a week.' },
  { id: 'demo', title: 'Demo only', blurb: 'The figure shows the movement and you tick each set yourself. The camera does not score these.' },
]

export const exerciseById = (id: string | null | undefined): Exercise | undefined => EXERCISES.find((e) => e.id === id || e.serviceId === id)

export const WEEK = { days: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], done: [true, true, false, true], todayIndex: 4, sessions: 3, minutes: 42, lastSession: '8 verified · pain 2→2' }

export const REGIONS: Record<string, { title: string; status: Marker['status']; setBy: string; metrics: { value: string; unit?: string; label: string; delta?: string }[]; program: { name: string; tag: string }[]; primary: { label: string; to: string } }> = {
  lWrist: { title: 'Left hand', status: 'focus', setBy: 'Set by your program · updated today',
    metrics: [{ value: '41.2', unit: 's', label: 'Nine-Hole Peg Test · 12 Sep', delta: '−2.8 s' }, { value: '38', unit: 'mm', label: 'pinch opening' }, { value: '17', label: 'verified reaches, last' }],
    program: [{ name: 'Nine-Hole Peg Test', tag: 'weekly' }, { name: 'Waiter – cup', tag: 'camera' }],
    primary: { label: 'Run the peg test', to: '/details/checkin?next=nhpt' } },
  lShoulder: { title: 'Left shoulder', status: 'watch', setBy: 'Set by your program · watch for leaning',
    metrics: [{ value: '88°', label: 'best lift, last set' }, { value: '2', unit: 'of 16', label: 'lifts with trunk lean' }, { value: '0', label: 'shoulder-hike events' }],
    program: [{ name: 'Pendulum', tag: 'camera' }, { name: 'Arm to the front', tag: 'camera' }, { name: 'Arm out to the side', tag: 'camera' }, { name: 'Rotate out', tag: 'demo only' }, { name: 'Rotate in', tag: 'demo only' }],
    primary: { label: 'Practise Arm to the front', to: '/details/demo?exercise=arm&side=left' } },
  lElbow: { title: 'Left elbow', status: 'stable', setBy: 'No exercise assigned here',
    metrics: [{ value: '170°', label: 'elbow extension during lifts' }],
    program: [],
    primary: { label: 'Ask the coach', to: '/details/coach' } },
}

export const HOME_MARKERS: Marker[] = [
  { joint: 'lWrist', status: 'focus', label: 'Left hand' },
  { joint: 'lShoulder', status: 'watch', label: 'Left shoulder' },
  { joint: 'lElbow', status: 'stable', label: 'Left elbow' },
]
