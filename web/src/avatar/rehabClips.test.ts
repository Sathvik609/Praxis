import { mirror } from './clips'
import { LOOP_BRIDGE_S, REHAB_CLIP_NAMES, REHAB_CLIPS, REHAB_JSON } from './rehabClips'
import { JOINTS, forwardKinematics, type Vec3 } from './rig'
import { sample } from './sampler'

const D = Math.PI / 180
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(...a) || 1
  return [a[0] / n, a[1] / n, a[2] / n]
}
// both operands are normalised: arccos near 1 turns a 1e-5 norm error into half a degree
const angleDeg = (p: Vec3, q: Vec3) => {
  const a = unit(p)
  const b = unit(q)
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / D
}

test('all seven rehab clips load with their provenance, captions and a left-side practising arm', () => {
  expect(Object.keys(REHAB_CLIPS).sort()).toEqual([...REHAB_CLIP_NAMES].sort())
  for (const name of REHAB_CLIP_NAMES) {
    const clip = REHAB_CLIPS[name]
    const json = REHAB_JSON[name]
    expect(clip.side).toBe('left')
    expect(clip.keys[0].t).toBe(0)
    expect(clip.duration).toBeCloseTo(json.duration + LOOP_BRIDGE_S, 6)
    expect(clip.steps).toBe(3)
    expect(clip.focusJoint).toBe('lShoulder')
    expect(clip.source).toBeTruthy()
    if (name === 'pendulum') expect(json.source.dataset).toBe('procedural')
    else {
      expect(json.source.license).toMatch(/PDDL|CC BY/)
      expect(json.source.subject).toBeTruthy()
    }
    const steps = new Set<number>()
    for (let t = 0; t <= clip.duration; t += 0.05) steps.add(sample(clip, t).step)
    expect([...steps]).toEqual([1, 2, 3])
    expect(sample(clip, 0).caption).toMatch(/Step 1 of 3/)
  }
})

test('sampling any rehab clip stays finite and inside ±200° on every channel', () => {
  for (const name of REHAB_CLIP_NAMES) {
    const clip = REHAB_CLIPS[name]
    for (let t = 0; t <= clip.duration + 0.5; t += 0.033) {
      const s = sample(clip, t)
      for (const j of JOINTS) for (const v of s.angles[j]) {
        expect(Number.isFinite(v)).toBe(true)
        expect(Math.abs(v)).toBeLessThan(200 * D)
      }
      expect(s.pinch).toBe(0)
    }
  }
})

test('round trip: the rig forward kinematics reproduces the source upper-arm and forearm directions at every key', () => {
  for (const name of REHAB_CLIP_NAMES) {
    if (name === 'pendulum') continue
    const clip = REHAB_CLIPS[name]
    const json = REHAB_JSON[name]
    const fit = json.fit?.forearm_error_deg_max ?? 0
    for (const key of json.keys) {
      if (!key.check) continue
      const p = forwardKinematics(sample(clip, key.t).angles)
      const ua = unit([p.lElbow[0] - p.lShoulder[0], p.lElbow[1] - p.lShoulder[1], p.lElbow[2] - p.lShoulder[2]])
      const fa = unit([p.lWrist[0] - p.lElbow[0], p.lWrist[1] - p.lElbow[1], p.lWrist[2] - p.lElbow[2]])
      // convention check: the Python builder's FK of these key angles and rig.ts agree
      // (rounding of the stored angles to 0.01° is the only difference)
      expect(angleDeg(ua, key.check.ua)).toBeLessThan(0.1)
      expect(angleDeg(fa, key.check.fa)).toBeLessThan(0.1)
      // fidelity: the recorded skeleton's directions, within the 5-frame key smoothing and the
      // builder's reported forearm fit
      expect(angleDeg(ua, key.check.src_ua)).toBeLessThan(6)
      expect(angleDeg(fa, key.check.src_fa)).toBeLessThan(fit + 6)
      // check vectors are in the reference torso frame; elevation_deg is torso-relative, so the
      // two differ by the trunk lean (a few degrees)
      const elevation = Math.acos(-ua[1]) / D
      expect(Math.abs(elevation - key.check.elevation_deg)).toBeLessThan(15)
    }
  }
})

test('the peak of each clip reaches its target angle and returns near the start', () => {
  for (const name of REHAB_CLIP_NAMES) {
    const clip = REHAB_CLIPS[name]
    const json = REHAB_JSON[name]
    let peak = -1
    for (let t = 0; t <= json.duration; t += 0.02) {
      const p = forwardKinematics(sample(clip, t).angles)
      const ua = unit([p.lElbow[0] - p.lShoulder[0], p.lElbow[1] - p.lShoulder[1], p.lElbow[2] - p.lShoulder[2]])
      peak = Math.max(peak, Math.acos(-ua[1]) / D)
    }
    // target_deg is torso-relative; the world-frame peak differs by the trunk lean plus spline overshoot
    if (json.metric === 'elevation' && name !== 'pendulum') expect(Math.abs(peak - json.target_deg)).toBeLessThan(8)
    // the loop bridge brings the figure back to its first pose
    const a = sample(clip, clip.duration).angles
    const b = sample(clip, 0).angles
    for (const j of ['lShoulder', 'lElbow', 'spine'] as const) for (let i = 0; i < 3; i++) expect(a[j][i]).toBeCloseTo(b[j][i], 4)
  }
})

test('arc cues: elevation arcs hang from straight down, rotation arcs span the forearm excursion; mirroring flips them', () => {
  const abd = REHAB_CLIPS.abduction.arc!
  expect(abd.kind).toBe('elevation')
  expect(abd.startDir).toEqual([0, -1, 0])
  expect(abd.targetDeg).toBeCloseTo(REHAB_JSON.abduction.target_deg, 6)
  expect(abd.peakDir[1]).toBeGreaterThan(0.5) // a 158° abduction ends over the head …
  expect(abd.peakDir[0]).toBeGreaterThan(0.2) // … on the figure's left, not in front (|z| small)
  expect(Math.abs(abd.peakDir[2])).toBeLessThan(0.3)
  const ext = REHAB_CLIPS.external_rotation.arc!
  expect(ext.kind).toBe('rotation')
  expect(ext.joint).toBe('lElbow')
  expect(ext.targetDeg).toBeGreaterThan(60)
  const m = mirror(REHAB_CLIPS.abduction)
  expect(m.side).toBe('right')
  expect(m.focusJoint).toBe('rShoulder')
  expect(m.arc!.joint).toBe('rShoulder')
  expect(m.arc!.peakDir[0]).toBeCloseTo(-abd.peakDir[0], 6)
  const mid = REHAB_JSON.abduction.keys.find((k) => k.check && k.check.elevation_deg > 60 && k.check.elevation_deg < 120)!
  const p = forwardKinematics(sample(m, mid.t).angles)
  expect(p.rElbow[0]).toBeLessThan(p.rShoulder[0] - 0.1) // half-way up, the right arm is out to the right
})
