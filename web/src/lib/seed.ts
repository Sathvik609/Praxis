/** Illustrative local data matching the wireframes (Alex M., Dr. Rao, Hospital GRASP L2 v3).
 *  Phase 8 replaces this with the session service's store; all values are labeled illustrative. */
import type { Marker } from '../avatar/markers'

export type ExerciseId = 'nhpt' | 'cup' | 'arm' | 'blocks' | 'grip' | 'washcloth'
export type Exercise = {
  id: ExerciseId
  name: string
  category: string
  kind: 'assessment' | 'camera' | 'instructions'
  equipment: string
  dose: string
  note: string
  clip?: 'nhpt' | 'cup' | 'armFront'
  steps: string[]
  watchFor?: string
  stopIf?: string
  region: 'hand' | 'shoulder'
}

export const PATIENT = { name: 'Alex M.', initial: 'A', side: 'left' as const, goal: 'Use a cup on my own.', goalAttempts: 2 }
export const PROGRAM = { label: 'Hospital GRASP, Level 2 · Left side', short: 'Hospital GRASP L2 · v3 · Dr. Rao', clinician: 'Dr. Anita Rao, OT', nextVisit: 'Thu 18 Sep, 2:30 PM', level: 2, version: 3 }

export const EXERCISES: Exercise[] = [
  { id: 'nhpt', name: 'Nine-Hole Peg Test', category: 'Standardized assessment · dexterity', kind: 'assessment', equipment: 'Pegboard + 9 pegs · printed marker sheet', dose: 'Timed, one attempt each hand', note: 'Timer starts at first peg lift, stops at ninth seated peg.', clip: 'nhpt', region: 'hand',
    steps: ['Pegs in the dish on the marked side, board on the printed sheet', 'When ready, pick up the first peg — the timer starts on your first lift', 'Place pegs in any hole, one at a time, as quickly as you comfortably can', 'The timer stops when the ninth peg is seated'],
    watchFor: 'dropping pegs off the sheet', stopIf: 'pain rises or you feel dizzy' },
  { id: 'cup', name: 'Waiter – cup', category: 'Coordination · reach and place', kind: 'camera', equipment: 'Cup + printed target sheet', dose: '2 arcs, then 2 as fast as you can', note: 'Camera verifies the cup on each of the five dots.', clip: 'cup', region: 'hand',
    steps: ['Cup in your weaker hand, sheet in front of you', 'Place the cup on dot 1, then rest your hand in your lap', 'Reach and move the cup to the next dot, one at a time', 'After dot 5, go back the way you came', 'Repeat twice, then twice as fast as you can'],
    watchFor: 'shoulder creeping up, leaning to reach', stopIf: 'pain rises or you feel dizzy' },
  { id: 'arm', name: 'Arm to the front', category: 'Arm strengthening · shoulder', kind: 'camera', equipment: 'Wrist weight 0.5–1 lb', dose: '2 sets of 8 · hold 3 · no higher than shoulder', note: 'Camera measures arm angle and watches for leaning.', clip: 'armFront', region: 'shoulder',
    steps: ['Sit tall, practising side toward the camera, arm by your side', 'Lift the straight arm to the front for a count of three', 'Hold at shoulder height for three — never higher', 'Lower for a count of three', 'Eight lifts, rest, then eight more'],
    watchFor: 'leaning back to lift, shoulder hiking', stopIf: 'pain rises or you feel dizzy' },
  { id: 'blocks', name: 'Block towers', category: 'Hand skills · fine motor', kind: 'instructions', equipment: 'Blocks + stable table', dose: 'From prescription', note: 'Reviewed instructions. Camera coaching not yet validated for this task.', region: 'hand',
    steps: ['Blocks within easy reach of your weaker hand', 'Stack one block at a time into a tower of five', 'Take the tower down one block at a time', 'Log how many towers you built'] },
  { id: 'grip', name: 'Grip power', category: 'Hand strengthening', kind: 'instructions', equipment: '5 lb hand gripper', dose: '2 sets of 10 · squeeze for 3', note: 'Cannot be verified by camera. Logged from your own count.', region: 'hand',
    steps: ['Hold the gripper in your weaker hand', 'Squeeze and hold for a count of three', 'Release slowly', 'Ten squeezes, rest, then ten more'] },
  { id: 'washcloth', name: 'Wash cloth', category: 'Coordination · both hands', kind: 'instructions', equipment: 'Towel', dose: '2 sets of 5', note: 'Reviewed instructions. Two-handed twist is not camera-verifiable yet.', region: 'hand',
    steps: ['Hold a damp cloth in both hands', 'Twist as if wringing it out, both directions', 'Five twists, rest, then five more'] },
]

export const ASSIGNED_TODAY: ExerciseId[] = ['cup', 'arm']

export const WEEK = { days: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], done: [true, true, false, true], todayIndex: 4, sessions: 3, minutes: 42, lastSession: '8 verified · pain 2→2' }

export const REGIONS: Record<string, { title: string; status: Marker['status']; setBy: string; metrics: { value: string; unit?: string; label: string; delta?: string }[]; program: { name: string; tag: string }[]; primary: { label: string; to: string } }> = {
  lWrist: { title: 'Left hand', status: 'focus', setBy: 'Set by your program · updated today',
    metrics: [{ value: '41.2', unit: 's', label: 'Nine-Hole Peg Test · 12 Sep', delta: '−2.8 s' }, { value: '38', unit: 'mm', label: 'pinch opening' }, { value: '17', label: 'verified reaches, last' }],
    program: [{ name: 'Nine-Hole Peg Test', tag: 'weekly' }, { name: 'Waiter – cup', tag: 'camera' }, { name: 'Block towers', tag: 'instructions' }],
    primary: { label: 'Run the peg test', to: '/session?exercise=nhpt&hand=left' } },
  lShoulder: { title: 'Left shoulder', status: 'watch', setBy: 'Set by your program · watch for leaning',
    metrics: [{ value: '88°', label: 'best lift, last set' }, { value: '2', unit: 'of 16', label: 'lifts with trunk lean' }, { value: '0', label: 'shoulder-hike events' }],
    program: [{ name: 'Arm to the front', tag: 'camera' }],
    primary: { label: 'Practise Arm to the front', to: '/demo?exercise=arm&side=left' } },
  lElbow: { title: 'Left elbow', status: 'stable', setBy: 'No exercise assigned here',
    metrics: [{ value: '170°', label: 'elbow extension during lifts' }],
    program: [],
    primary: { label: 'Ask the coach', to: '/' } },
}

export const HOME_MARKERS: Marker[] = [
  { joint: 'lWrist', status: 'focus', label: 'Left hand' },
  { joint: 'lShoulder', status: 'watch', label: 'Left shoulder' },
  { joint: 'lElbow', status: 'stable', label: 'Left elbow' },
]
