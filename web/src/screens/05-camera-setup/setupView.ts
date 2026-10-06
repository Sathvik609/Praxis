/** Screen 05's checklist per camera view (locked set, 23 Sep 2026; design v2 6 Oct).
 *
 *  - `side`  (hidden since 28 Sep, dormant): practising side square to the camera.
 *  - `front` (Arm out to the side): facing the camera.
 *  - `table` (Waiter – cup, NHPT): the printed sheet under an overhead camera. The rows are the
 *    service's (`quality.build_checks`: camera, person, task_area, markers, angle, lighting),
 *    with the client-only `side_confirm` self-check ("Is this your left arm?") after `person`;
 *    nothing on the service checks which arm is in the picture.
 *
 *  Honesty rule: a row's status comes from the service's `setup_checks` event when the service
 *  decides it. In `calibrate` mode with `for=arm` the service (pipeline.py `_process_calibrate`,
 *  quality.py `build_checks(needs_sheet=False)`) runs no pose model: it sends `camera`,
 *  `person` (frame-difference presence), `lighting`, and a `side_view` row that is always
 *  `pending`. The pose rows below are therefore **patient self-checks** until the service
 *  sends a decided (`pass` | `check` | `fail`) row with the same id; then the camera wins.
 *  Ids the service can send to take a row over: `side_view`, `hip_in_view`, `arm_in_view`,
 *  `front_view`, `upper_in_view`. */
import type { Side } from '../../lib/day'
import type { Exercise } from '../../lib/seed'

export type Check = {
  id: string
  label: string
  status: 'pass' | 'check' | 'fail' | 'pending'
  hint: string | null
  /** `camera`: status comes from the service. `self`: the camera does not measure this yet;
   *  the patient looks at the picture and taps. Absent means camera. */
  source?: 'camera' | 'self'
  /** A self-check's confirm button text (default "Yes, I can see it"). */
  yes?: string
}

/** The sheet tasks' rows before the first `setup_checks` event (Waiter – cup, NHPT). */
export const DEFAULT_CHECKS: Check[] = [
  { id: 'camera', label: 'Camera permission', status: 'pending', hint: null },
  { id: 'person', label: 'One person in view', status: 'pending', hint: null },
  { id: 'task_area', label: 'Hand and task area in view', status: 'pending', hint: null },
  { id: 'markers', label: 'Sheet found · all four corner markers visible', status: 'pending', hint: null },
  { id: 'angle', label: 'Camera looks down at the sheet', status: 'pending', hint: null },
  { id: 'lighting', label: 'Lighting and steady tracking', status: 'pending', hint: null },
]

export type SetupView = 'side' | 'front' | 'table'

export function setupViewFor(ex: Exercise | undefined): SetupView {
  if (ex?.session !== 'arm') return 'table'
  return ex.view === 'front' ? 'front' : 'side'
}

type Spec = { id: string; label: string; hint: string; self?: true; yes?: string }

/** The table view's one self-check: the service cannot tell which arm is in the picture. */
function sideConfirm(side: Side): Spec {
  return { id: 'side_confirm', label: `Is this your ${side} arm?`, hint: `Is this your ${side} arm?`, self: true, yes: `Yes, my ${side} arm` }
}

function specs(view: Exclude<SetupView, 'table'>, side: Side, pendulum: boolean): Spec[] {
  const camera: Spec = { id: 'camera', label: 'Camera permission', hint: 'Allow the camera in your browser.' }
  const lighting: Spec = { id: 'lighting', label: 'Lighting', hint: 'Light from the front, no window behind you.' }
  if (view === 'front') {
    return [
      camera,
      { id: 'person', label: 'One person in view', hint: 'Sit facing the camera with your upper body in the picture.' },
      { id: 'front_view', label: 'You face the camera', hint: 'Turn your chair so you face the camera straight on.', self: true },
      { id: 'upper_in_view', label: 'Both shoulders and both hands in view', hint: 'Move back until both hands fit with your arms out to the side.', self: true },
      lighting,
    ]
  }
  return [
    camera,
    { id: 'person', label: 'One person in view', hint: pendulum ? 'Stand so your whole upper body is in the picture.' : 'Sit so your whole upper body is in the picture.' },
    { id: 'side_view', label: `Your ${side} side faces the camera`, hint: `Turn so your ${side} shoulder is closest to the camera.`, self: true },
    { id: 'hip_in_view', label: 'Hip in view', hint: pendulum ? 'Step back from the table edge so your hip shows.' : 'A chair without arms lets the camera see your hip.', self: true },
    { id: 'arm_in_view', label: 'Shoulder, elbow and wrist in view', hint: 'Move back until your whole arm fits, hand included.', self: true },
    lighting,
  ]
}

export type Resolved = { rows: Check[]; ready: boolean }

/** Rows to show and whether Continue may unlock. `ticks` are the self-check taps. */
export function resolveChecks(
  view: SetupView,
  side: Side,
  pendulum: boolean,
  service: { checks: Check[]; all_required_pass: boolean } | undefined,
  ticks: Record<string, boolean>,
): Resolved {
  if (view === 'table') {
    const camera = service?.checks.length ? service.checks : DEFAULT_CHECKS
    const s = sideConfirm(side)
    const ticked = !!ticks[s.id]
    const self: Check = { id: s.id, label: s.label, status: ticked ? 'pass' : 'pending', hint: s.hint, source: 'self', yes: s.yes }
    const at = camera.findIndex((c) => c.id === 'person')
    const rows = [...camera.slice(0, at + 1), self, ...camera.slice(at + 1)].map((c) => (c.source ? c : { ...c, source: 'camera' as const }))
    return { rows, ready: service?.all_required_pass === true && ticked }
  }
  const byId = new Map((service?.checks ?? []).map((c) => [c.id, c]))
  let selfOk = true
  let blocked = false
  const rows = specs(view, side, pendulum).map((s): Check => {
    const svc = byId.get(s.id)
    const decided = svc && svc.status !== 'pending'
    if (s.self && !decided) {
      const ticked = !!ticks[s.id]
      if (!ticked) selfOk = false
      return { id: s.id, label: s.label, status: ticked ? 'pass' : 'pending', hint: s.hint, source: 'self' }
    }
    const status = svc?.status ?? 'pending'
    if (s.self && status !== 'pass') blocked = true
    const hint = status === 'pass' || status === 'pending' ? null : s.id === 'lighting' ? (svc?.hint ?? s.hint) : s.hint
    return { id: s.id, label: s.label, status, hint, source: 'camera' }
  })
  return { rows, ready: service?.all_required_pass === true && selfOk && !blocked }
}
