import { cupActiveS, cupArc, cupBand, cupDots, cupProgressFacts } from './cupView'

// Real service fields (0-based dots): reach_complete {to_dot, verified, reason, reach_ms, t_lift},
// wrong_dot {dot, expected} at the same t as the reach that landed on the wrong dot.
let id = 0
const reach = (t: number, to: number, verified: boolean, reason: string | null = null, reach_ms = 1500, t_lift = t - 2) => ({ type: 'reach_complete', t, id: ++id, to_dot: to, from_dot: to - 1, verified, reason, reach_ms, t_lift })
const wrongDot = (t: number, dot: number, expected: number) => ({ type: 'wrong_dot', t, id: ++id, dot, expected })
const arcDone = (t: number, arc: number) => ({ type: 'arc_complete', t, id: ++id, arc, phase: 'slow', mean_reach_ms: 1400, unverified: 0, reaches: 8, awaiting_phase: arc === 2 })
const cupFrame = (c: Record<string, unknown>, t = 20) => ({
  type: 'frame', t, id: ++id, calibrated: true,
  cup: { mode: 'cup', state: 'at_dot', dot: 0, phase: 'slow', arcs_done: 0, arc_index: 1, arcs_planned: { slow: 2, fast: 2 }, expected_next: 1, dots_in_arc: [0], reaches_total: 0, unverified_total: 0, awaiting_phase: false, finished: false, arc_means_ms: [], hand_clear: true, ...c },
  overlay: { cup_px: [1, 1] },
}) as never

test('dot states from real reach events: verified done, unverified amber, wrong dot amber, next from the frame', () => {
  const evs = [reach(1, 1, true), reach(2, 2, false, 'cup_occluded'), wrongDot(3, 4, 3), reach(3, 4, true)]
  expect(cupDots(evs as never, cupFrame({ dot: 4, expected_next: 3, dots_in_arc: [0, 1, 2, 4] })).map((d) => d.state)).toEqual(['done', 'done', 'amber', 'next', 'amber'])
})

test('dot states start over after arc_complete; the dot the cup starts on is done', () => {
  const evs = [reach(1, 1, true), reach(2, 2, true), arcDone(9, 1), reach(10, 1, false, 'marker_lost')]
  expect(cupDots(evs as never, cupFrame({ dot: 1, expected_next: 2, dots_in_arc: [0, 1] })).map((d) => d.state)).toEqual(['done', 'amber', 'next', 'todo', 'todo'])
})

test('band text for an occluded placement says unverified, not failed', () => {
  expect(cupBand([reach(1, 2, false, 'cup_occluded')] as never, cupFrame({}))!.text).toBe('Placement not visible · hand over the cup')
})

test('band for a wrong dot', () => {
  expect(cupBand([wrongDot(5, 3, 2), reach(5, 3, true)] as never, cupFrame({}))).toEqual({ text: 'Cup on dot 4 · expected dot 3', tone: 'amber' })
})

test('band for a verified placement, a moving cup and lost tracking', () => {
  expect(cupBand([reach(5, 2, true)] as never, cupFrame({}, 5))).toEqual({ text: 'Dot 3 seated · hand clear · verified', tone: 'mint' })
  expect(cupBand([reach(5, 2, true)] as never, cupFrame({ state: 'in_transit' }, 6))).toEqual({ text: 'Cup moving', tone: 'mint' })
  expect(cupBand([reach(5, 2, true), { type: 'perception_lost', t: 6, id: 99 }] as never, cupFrame({}, 6))).toEqual({ text: 'Tracking paused · counters held', tone: 'neutral' })
  expect(cupBand([], cupFrame({ dot: null }))).toBeNull()
})

test('arc direction from reaches since the last arc_complete', () => {
  const across = [arcDone(1, 1), reach(2, 1, true), reach(3, 2, true)]
  expect(cupArc(across as never, cupFrame({ arc_index: 2, phase: 'slow' }))).toEqual({ arc: 2, of: 2, phase: 'slow', dir: 'across' })
  const back = [reach(2, 1, true), reach(3, 2, true), reach(4, 3, true), reach(5, 4, true), reach(6, 3, true)]
  expect(cupArc(back as never, cupFrame({ arc_index: 1, phase: 'slow' })).dir).toBe('back')
  expect(cupArc([], cupFrame({ arc_index: 3, phase: 'fast', arcs_done: 2 }))).toEqual({ arc: 1, of: 2, phase: 'fast', dir: 'across' })
})

test('active time runs from the first lift', () => {
  expect(cupActiveS([reach(5, 1, true, null, 1500, 3)] as never, cupFrame({}, 65))).toBe(62)
  expect(cupActiveS([], cupFrame({}, 65))).toBeNull()
})

test('progression facts come from the camera: verified slow reaches and the arc means', () => {
  const evs = [reach(1, 1, true), reach(2, 2, false, 'cup_occluded'), reach(3, 3, true)]
  const f = cupProgressFacts(evs as never, cupFrame({ arc_means_ms: [1600, 1200] }))
  expect(f).toEqual({ verified: 2, total: 3, fasterPct: 25 })
  expect(cupProgressFacts([], cupFrame({ arc_means_ms: [null, 1200] })).fasterPct).toBeNull()
})
