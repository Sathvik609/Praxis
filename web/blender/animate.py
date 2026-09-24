"""Praxis avatar animations: eight actions keyed onto the rig built by `build_avatar.py`.

Blender 5.2.2 LTS (bpy 5.2). Imported and run by `build_avatar.py` before the glTF export; not a
standalone script.

Two sources of motion, both deterministic:

* Real-motion clips (`web/src/avatar/clips/rehab/*.json`: flexion, abduction, external and
  internal rotation from UI-PRMD / IntelliRehabDS, pendulum authored procedurally). Each JSON
  key holds the web rig's joint angles (Euler XYZ, degrees, rig frame: y up, +z forward, +x the
  figure's left). They are replayed here as armature-space rotations, so the posed Blender
  skeleton has the same world bone directions as `web/src/avatar/rig.ts` forward kinematics.
  `retarget_error_deg` in the sidecar compares every key's upper-arm and forearm direction
  with the direction the JSON's `check` block says the rig produces.
* Scripted table tasks (Waiter – cup, Nine-Hole Peg Test) and the idle loop. The figure sits at
  the table; reaches are *targets* (the `anchor_dot_k` / `anchor_hole_k` empties) solved with an
  analytic two-bone IK, so the grip lands on the dot or hole the caption names. The cup and the
  pegs are keyed to follow the hand while carried.

Every action is pushed to an NLA track named after it on each object it moves, and the exporter
runs in NLA_TRACKS mode, so one glTF animation per action carries the body and its props.
The sidecar `praxis_avatar.meta.json` lists, per action: duration, loop, camera, visible props,
one repetition's time span (what the app's rep pacing maps 0..1 onto), captions, and the
dot / hole targets with their times. The avatar demonstrates; it never scores anyone.
"""

from __future__ import annotations

import json
import math
import os

import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 30
HERE = os.path.dirname(os.path.abspath(__file__))
REHAB_DIR = os.path.join(os.path.dirname(HERE), "src", "avatar", "clips", "rehab")
META_OUT = os.path.join(os.path.dirname(HERE), "public", "avatar", "praxis_avatar.meta.json")

D = math.pi / 180
# rig.ts frame (x left, y up, z forward) -> Blender (x left, y back, z up)
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
CT = C.transposed()

RIG_JOINTS = ["hips", "spine", "neck", "head", "lShoulder", "lElbow", "lWrist", "rShoulder", "rElbow", "rWrist"]
RIG_PARENT = {"hips": None, "spine": "hips", "neck": "spine", "head": "neck",
              "lShoulder": "neck", "lElbow": "lShoulder", "lWrist": "lElbow",
              "rShoulder": "neck", "rElbow": "rShoulder", "rWrist": "rElbow"}
# rig joint whose world rotation drives each Blender bone (rotation at a rig joint moves its subtree)
BONE_FROM_RIG = {"chest": "spine", "neck": "neck", "head": "head",
                 "upper_arm_L": "lShoulder", "forearm_L": "lElbow", "hand_L": "lWrist",
                 "upper_arm_R": "rShoulder", "forearm_R": "rElbow", "hand_R": "rWrist"}
# rig.ts rest: arms hang with a slight natural bend and abduction (clips.ts REST_POSE), degrees
REST_DEG = {"lShoulder": (-3, 0, 4), "rShoulder": (-3, 0, -4), "lElbow": (-8, 0, 0), "rElbow": (-8, 0, 0)}


def euler_xyz(deg) -> Matrix:
    x, y, z = (a * D for a in deg)
    return Matrix.Rotation(x, 3, "X") @ Matrix.Rotation(y, 3, "Y") @ Matrix.Rotation(z, 3, "Z")


def rig_world(angles: dict) -> dict:
    """World rotation of every rig joint (rig frame), parent chain x own Euler, as rig.ts does."""
    out = {}
    for j in RIG_JOINTS:
        own = euler_xyz(angles.get(j, (0, 0, 0)))
        out[j] = own if RIG_PARENT[j] is None else out[RIG_PARENT[j]] @ own
    return out


# The avatar never lifts the upper arm above the prescription ceiling (CLAUDE.md §1). Same rule,
# same maths as `capElevation` in web/src/avatar/rehabClips.ts; glbAnim.test.ts checks they agree.
ELEVATION_CEILING_DEG = 90.0
UA_REST = Vector((0.025, -0.27, 0.0)).normalized()  # rig.ts REST.lElbow.offset, rig frame


def torso_elevation(lsh_deg) -> float:
    u = euler_xyz(lsh_deg) @ UA_REST
    return math.degrees(math.acos(max(-1.0, min(1.0, -u.y))))


def cap_elevation(keys: list, ceiling=ELEVATION_CEILING_DEG):
    """Scale a recorded rep so its torso-relative upper-arm elevation peaks at `ceiling`: each
    key's upper arm turns back toward hanging down, in its own plane, by the same proportion.
    Returns (keys, scale info or None) and each key's world-frame correction for its checks."""
    peak = max(torso_elevation(k["lShoulder"]) for k in keys)
    if peak <= ceiling:
        return keys, None, [Matrix.Identity(3)] * len(keys)
    scale = ceiling / peak
    out, turns = [], []
    for k in keys:
        E = euler_xyz(k["lShoulder"])
        u = E @ UA_REST
        e = math.acos(max(-1.0, min(1.0, -u.y)))
        axis = Vector((-u.z, 0.0, u.x))  # down x u: turning about it by +a lifts the arm
        if axis.length < 1e-9:
            out.append(k)
            turns.append(Matrix.Identity(3))
            continue
        R = Matrix.Rotation(e * scale - e, 3, axis.normalized())
        E2 = R @ E
        lsh = [math.degrees(a) for a in E2.to_euler("ZYX")]  # Blender 'ZYX' == Rx @ Ry @ Rz, rig.ts order
        back = euler_xyz(lsh)
        assert max(abs(back[i][j] - E2[i][j]) for i in range(3) for j in range(3)) < 1e-6, "Euler order mismatch"
        S = euler_xyz(k["spine"])
        out.append({**k, "lShoulder": lsh})
        turns.append(S @ R @ S.transposed())
    return out, {"ceiling_deg": ceiling, "recorded_peak_deg": round(peak, 2), "scale": scale}, turns


def slerp_half(m: Matrix) -> Matrix:
    return Quaternion().slerp(m.to_quaternion(), 0.5).to_matrix()


# ---------------------------------------------------------------------------------------------
# Pose = armature-space rotation delta per bone (rest -> posed) + root translation. Bones not
# listed inherit their parent's delta (no local rotation).
# ---------------------------------------------------------------------------------------------
class Pose:
    def __init__(self, deltas: dict | None = None, root: Vector | None = None):
        self.d = dict(deltas or {})
        self.root = Vector(root or (0, 0, 0))

    def copy(self) -> "Pose":
        return Pose(self.d, self.root)


def pose_from_rig(angles: dict, legs: dict | None = None, root=None) -> Pose:
    """Blender deltas reproducing rig.ts joint angles. The rig's single `spine` pivot (1.26 m) is
    shared between Blender's spine (half) and chest (full) so a deep lean bends the back smoothly;
    bone directions above the chest are unchanged by the split."""
    w = rig_world(angles)
    d = {}
    hips = C @ w["hips"] @ CT
    d["spine"] = hips @ (C @ slerp_half(euler_xyz(angles.get("spine", (0, 0, 0)))) @ CT)
    for bone, joint in BONE_FROM_RIG.items():
        d[bone] = C @ w[joint] @ CT
    d.update(legs or {})
    return Pose(d, root)


class Skeleton:
    """Rest data + forward kinematics for Blender-space deltas (for IK and the carry bake)."""

    def __init__(self, rig):
        self.rig = rig
        self.bones = {b.name: b for b in rig.data.bones}
        self.order = [b.name for b in rig.data.bones if b.parent is None]
        stack = list(self.order)
        self.order = []
        while stack:
            n = stack.pop(0)
            self.order.append(n)
            stack.extend(c.name for c in self.bones[n].children)

    def rest_head(self, n):
        return self.bones[n].head_local.copy()

    def rest_tail(self, n):
        return self.bones[n].tail_local.copy()

    def delta(self, pose: Pose, n):
        while n is not None:
            if n in pose.d:
                return pose.d[n]
            p = self.bones[n].parent
            n = p.name if p else None
        return Matrix.Identity(3)

    def head(self, pose: Pose, n):
        b = self.bones[n]
        if b.parent is None:
            return b.head_local + pose.root
        p = b.parent.name
        return self.head(pose, p) + self.delta(pose, p) @ (b.head_local - b.parent.head_local)

    def point(self, pose: Pose, n, rest_point: Vector):
        """Where a point rigidly attached to bone n (given at rest) ends up."""
        return self.head(pose, n) + self.delta(pose, n) @ (rest_point - self.bones[n].head_local)

    def key(self, pose: Pose, frame: int, prev: dict):
        for n in self.order:
            b = self.bones[n]
            pb = self.rig.pose.bones[n]
            r = b.matrix_local.to_3x3()
            dp = self.delta(pose, b.parent.name) if b.parent else Matrix.Identity(3)
            basis = r.inverted() @ dp.inverted() @ self.delta(pose, n) @ r
            q = basis.to_quaternion()
            if n in prev:
                q.make_compatible(prev[n])
            prev[n] = q
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=n)
            if b.parent is None:
                pb.location = r.inverted() @ pose.root
                pb.keyframe_insert("location", frame=frame, group=n)


def rot_between(a: Vector, b: Vector) -> Matrix:
    return a.normalized().rotation_difference(b.normalized()).to_matrix()


def solve_arm(sk: Skeleton, pose: Pose, side: str, grip_rest: Vector, target: Vector, pole: Vector,
              pronation=0.0, wrist_flex=0.0, iters=8, align=None) -> Pose:
    """Analytic two-bone IK: put the hand-attached point `grip_rest` (rest coords) on `target`.
    The upper arm and forearm take the minimal rotations onto the solved directions, then the
    forearm pronates about its own axis and the wrist flexes; the loop re-solves because the grip
    point hangs off the hand."""
    s = side
    ua, fa, hand = f"upper_arm_{s}", f"forearm_{s}", f"hand_{s}"
    S0, E0, W0 = sk.rest_head(ua), sk.rest_head(fa), sk.rest_head(hand)
    L1, L2 = (E0 - S0).length, (W0 - E0).length
    out = pose.copy()
    wrist_target = target.copy()
    for _ in range(iters):
        S = sk.head(out, ua)
        v = wrist_target - S
        d = min(v.length, (L1 + L2) * 0.999)
        u = v.normalized()
        a = (L1 * L1 - L2 * L2 + d * d) / (2 * d)
        h = math.sqrt(max(0.0, L1 * L1 - a * a))
        n = (pole - u * u.dot(pole)).normalized()
        E = S + u * a + n * h
        W = S + u * d
        parent = sk.delta(out, f"clavicle_{s}")
        d_ua = rot_between(parent @ (E0 - S0), E - S) @ parent
        d_fa = rot_between(d_ua @ (W0 - E0), W - E) @ d_ua
        axis = (W - E).normalized()
        sgn = 1 if s == "L" else -1
        if align is not None:  # roll the forearm so a hand-local axis points as close to `world` as it can
            local, world = align
            v = d_fa @ local
            vp = (v - axis * v.dot(axis)).normalized()
            wp = (world - axis * world.dot(axis)).normalized()
            roll = math.atan2(vp.cross(wp).dot(axis), vp.dot(wp))
            d_fa = Matrix.Rotation(roll, 3, axis) @ d_fa
        d_fa = Matrix.Rotation(pronation * D * sgn, 3, axis) @ d_fa
        lateral = (d_fa @ Vector((0, -1, 0))).cross(axis).normalized()  # wrist flexion axis
        d_hand = Matrix.Rotation(wrist_flex * D * sgn, 3, lateral) @ d_fa
        out.d[ua], out.d[fa], out.d[hand] = d_ua, d_fa, d_hand
        grip = sk.point(out, hand, grip_rest)
        wrist_target = wrist_target + (target - grip)
    return out


# ---------------------------------------------------------------------------------------------
# Hands. Thumb and four separate fingers, three phalanges each. Fingers flex toward the palm in
# their own planes, a few millimetres apart; the thumb swings from its base (two angles) and flexes
# its two outer joints. Shapes are solved once per skeleton in the hand's own rest frame:
#   relaxed  resting cascade              open  pre-shaped aperture while reaching for a peg
#   near     pads just apart (last approach, release)
#   pinch    thumb pad meets index pad either side of a peg; middle/ring/little tucked
#   cup_open / cup  fingers and thumb wrapped round the cup (cylindrical power grip)
# ---------------------------------------------------------------------------------------------
FINGER_NAMES = ("index", "middle", "ring", "little")
DIGITS = {d: (d, f"{d}_2", f"{d}_3") for d in ("thumb", *FINGER_NAMES)}
# capsule radius per phalanx (the larger end, from build_avatar.DIGIT_RADII) for collision checks
PHALANX_R = {
    "thumb": 0.0135, "thumb_2": 0.0118, "thumb_3": 0.0104,
    "index": 0.0086, "index_2": 0.0080, "index_3": 0.0074,
    "middle": 0.0088, "middle_2": 0.0082, "middle_3": 0.0076,
    "ring": 0.0082, "ring_2": 0.0077, "ring_3": 0.0071,
    "little": 0.0072, "little_2": 0.0067, "little_3": 0.0062,
}
PEG_DIAMETER = 0.008
INDEX_TIP_R, THUMB_TIP_R = 0.0066, 0.0090  # fingertip radii (build_avatar.DIGIT_RADII)
CUP_R_GRIP = 0.034  # cup radius at the grip ring


class HandShape:
    """Flexion (deg) of the three joints of each finger, and the thumb's (base x, base z, flex)."""

    def __init__(self, fingers: dict, thumb):
        self.fingers = {k: tuple(v) for k, v in fingers.items()}
        self.thumb = tuple(thumb)

    def with_(self, **kw) -> "HandShape":
        f = dict(self.fingers)
        th = kw.pop("thumb", self.thumb)
        f.update(kw)
        return HandShape(f, th)


def digit_deltas(sk: "Skeleton", side: str, shape: HandShape, dh: Matrix) -> dict:
    s, sgn = side, (1 if side == "L" else -1)
    out = {}
    for dg, angles in shape.fingers.items():
        m = dh
        for bone, ang in zip(DIGITS[dg], angles):
            m = m @ Matrix.Rotation(ang * D * sgn, 3, "Y")  # flex toward the palm, in the finger's own plane
            out[f"{bone}_{s}"] = m
    a, b, f = shape.thumb
    tdir = (sk.rest_head(f"thumb_2_{s}") - sk.rest_head(f"thumb_{s}")).normalized()
    n = tdir.cross(Vector((-sgn, 0.0, 0.0))).normalized()  # thumb flexion axis
    m = dh @ Matrix.Rotation(a * D, 3, "X") @ Matrix.Rotation(b * D * sgn, 3, "Z")
    out[f"thumb_{s}"] = m
    for bone in ("thumb_2", "thumb_3"):
        m = m @ Matrix.Rotation(f * D, 3, n)
        out[f"{bone}_{s}"] = m
    return out


def hand_pose(sk: "Skeleton", pose: "Pose", side: str, shape: HandShape) -> "Pose":
    out = pose.copy()
    out.d.update(digit_deltas(sk, side, shape, sk.delta(pose, f"hand_{side}")))
    return out


def tip(sk, pose, bone):
    return sk.point(pose, bone, sk.bones[bone].tail_local)


def local_points(sk, side, shape):
    """Digit joint and tip positions with the hand at rest (hand-local, rest coordinates)."""
    p = Pose(digit_deltas(sk, side, shape, Matrix.Identity(3)))
    return p, {bone: tip(sk, p, f"{bone}_{side}") for dg in DIGITS.values() for bone in dg}


def local_segments(sk, side, shape):
    """Each phalanx as a segment (head, tip) in hand-local coordinates."""
    p, tips = local_points(sk, side, shape)
    return {bone: (sk.head(p, f"{bone}_{side}"), tips[bone]) for dg in DIGITS.values() for bone in dg}


def seg_dist(p1, q1, p2, q2) -> float:
    """Shortest distance between segments p1q1 and p2q2."""
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1.dot(d1), d2.dot(d2), d2.dot(r)
    c, b = d1.dot(r), d1.dot(d2)
    den = a * e - b * b
    s = min(1.0, max(0.0, (b * f - c * e) / den)) if den > 1e-12 else 0.0
    t = (b * s + f) / e if e > 1e-12 else 0.0
    if t < 0.0:
        t, s = 0.0, min(1.0, max(0.0, -c / a))
    elif t > 1.0:
        t, s = 1.0, min(1.0, max(0.0, (b - c) / a))
    return ((p1 + d1 * s) - (p2 + d2 * t)).length


def thumb_overlap(segs, margin=0.001) -> float:
    """How far (metres, summed) the thumb's phalanges push into any finger. 0 when every capsule clears."""
    worst = 0.0
    for tb in DIGITS["thumb"]:
        for fg in FINGER_NAMES:
            for fb in DIGITS[fg]:
                need = PHALANX_R[tb] + PHALANX_R[fb] + margin
                worst += max(0.0, need - seg_dist(*segs[tb], *segs[fb]))
    return worst


def descend(f, x, step, lo, hi, iters=400):
    """Derivative-free coordinate descent (small, deterministic, good enough for a few joint angles)."""
    x, best = list(x), f(x)
    step = list(step)
    for _ in range(iters):
        moved = False
        for i in range(len(x)):
            for d in (step[i], -step[i]):
                y = list(x)
                y[i] = min(hi[i], max(lo[i], y[i] + d))
                v = f(y)
                if v < best - 1e-12:
                    x, best, moved = y, v, True
        if not moved:
            step = [st * 0.5 for st in step]
            if max(step) < 0.02:
                break
    return x, best


class Hands:
    """Solved hand shapes for one skeleton (left hand; the right mirrors by construction). Fingers
    flex in their own planes, a few millimetres apart, so they never touch each other; the thumb is
    solved with a penalty that keeps it off every finger."""

    def __init__(self, sk: "Skeleton"):
        self.sk = sk
        # resting cascade: each finger toward the little one curls a touch more
        self.relaxed = HandShape({"index": (10, 16, 8), "middle": (13, 18, 9), "ring": (16, 21, 10), "little": (19, 24, 12)},
                                 (0, 0, 8))
        # precision grip: index curls into a C to meet the thumb; the others tuck, the little most
        tuck = {"middle": (64, 82, 46), "ring": (74, 90, 55), "little": (84, 96, 62)}
        loose = {"middle": (40, 50, 25), "ring": (50, 60, 32), "little": (58, 68, 38)}
        self.pinch = self.solve_pinch((45, 45, 15), tuck, PEG_DIAMETER)
        self.near = self.solve_pinch((45, 45, 15), tuck, PEG_DIAMETER + 0.008)  # last approach / release
        self.open = self.solve_pinch((30, 30, 8), loose, 0.030)  # pre-shape while reaching
        _, pts = local_points(sk, "L", self.pinch)
        self.pinch_point = (pts["index_3"] + pts["thumb_3"]) / 2  # hand-local, between the pads
        # power grip round a vertical cup: cylinder axis along the hand's y (index on top)
        palm_x = sk.rest_head("hand_L").x - 0.021
        # grip ring placed so the little finger sits near the cup's base and the thumb near its rim
        self.cup_centre = Vector((palm_x - CUP_R_GRIP, -0.025, 0.818))
        self.cup = self.solve_cup(CUP_R_GRIP)
        self.cup_open = self.solve_cup(CUP_R_GRIP + 0.022)
        for name in ("relaxed", "pinch", "near", "open", "cup", "cup_open"):
            ov = thumb_overlap(local_segments(sk, "L", getattr(self, name)), margin=0.0)
            assert ov < 0.0005, f"hand shape {name}: thumb overlaps a finger by {ov * 1000:.1f} mm"

    def pads_gap(self, gap):
        # centre-line distance between the thumb and index tips when their pads touch an object
        return gap + INDEX_TIP_R + THUMB_TIP_R

    def solve_pinch(self, idx, others, gap):
        """Index curl and thumb angles together, so the thumb tip sits straight across from the
        index tip, `gap` apart pad to pad along the hand's front-back axis (level when the palm
        faces down), with the thumb clear of every finger. The index stays near `idx`."""
        sk = self.sk

        def split(x):
            return HandShape({"index": x[:3], **others}, x[3:])

        def cost(x):
            sh = split(x)
            segs = local_segments(sk, "L", sh)
            target = segs["index_3"][1] + Vector((0.0, -self.pads_gap(gap), 0.0))
            c = (segs["thumb_3"][1] - target).length_squared * 1e4
            c += 1e2 * thumb_overlap(segs) ** 2 * 1e4
            c += 1e-6 * sum((a - b) ** 2 for a, b in zip(x[:3], idx))
            return c + 1e-7 * (x[3] ** 2 + x[4] ** 2)
        best = None
        for th in ([0, 0, 20], [30, -30, 30], [-30, 30, 30], [40, 20, 50], [-20, -40, 10], [20, -60, 40]):
            x, c = descend(cost, list(idx) + th, [8, 8, 8, 10, 10, 10], [0, 0, 0, -90, -90, -20], [90, 100, 70, 90, 90, 90])
            if best is None or c < best[1]:
                best = (x, c)
        shape = split(best[0])
        _, p = local_points(sk, "L", shape)
        miss = (p["thumb_3"] - p["index_3"] - Vector((0.0, -self.pads_gap(gap), 0.0))).length
        assert miss < 0.002, f"pinch not reachable: {miss * 1000:.1f} mm"
        return shape

    def solve_cup(self, radius, wall=CUP_R_GRIP):
        """Fingers and thumb on a cylinder of `radius` round the cup axis; never inside the real `wall`."""
        sk, cc = self.sk, self.cup_centre

        def off_axis(p):  # distance from the cup axis (parallel to local y through cc)
            return math.hypot(p.x - cc.x, p.z - cc.z)

        fingers = {}
        for dg in FINGER_NAMES:
            r_f = PHALANX_R[f"{dg}_2"]

            def cost(a, dg=dg, r_f=r_f):
                _, p = local_points(sk, "L", HandShape({dg: a}, (0, 0, 0)))
                return sum((off_axis(p[b]) - (radius + r_f)) ** 2 for b in DIGITS[dg]) * 1e4
            a, _ = descend(cost, [30, 40, 30], [10, 10, 10], [0, 0, 0], [95, 110, 80])
            fingers[dg] = tuple(a)

        def tcost(th):
            sh = HandShape(fingers, th)
            _, p = local_points(sk, "L", sh)
            segs = local_segments(sk, "L", sh)
            c = sum((off_axis(p[b]) - (radius + PHALANX_R[b])) ** 2 for b in ("thumb_2", "thumb_3")) * 1e4
            for b in DIGITS["thumb"]:  # never inside the cup wall (head and tip of each phalanx)
                for q in segs[b]:
                    c += 1e2 * max(0.0, wall + PHALANX_R[b] - off_axis(q)) ** 2 * 1e4
            c += 1e-3 * max(0.0, p["thumb_3"].x - cc.x) ** 2 * 1e4  # thumb on the far side of the cup
            c += 1e2 * thumb_overlap(segs) ** 2 * 1e4
            return c
        best = None
        for start in ([20, -20, 20], [40, 0, 30], [0, -40, 40], [50, -30, 10], [30, 30, 30]):
            th, cst = descend(tcost, start, [10, 10, 10], [-80, -80, -10], [80, 80, 85])
            if best is None or cst < best[1]:
                best = (th, cst)
        th = best[0]
        segs = local_segments(sk, "L", HandShape(fingers, th))
        inside = max(wall + PHALANX_R[b] - off_axis(q) for b in DIGITS["thumb"] for q in segs[b])
        assert inside < 0.002, f"cup grip: thumb {inside * 1000:.1f} mm inside the cup wall"
        return HandShape(fingers, th)


# ---------------------------------------------------------------------------------------------
# Standing and seated bases
# ---------------------------------------------------------------------------------------------
SEAT_DROP = 0.41  # hip joint 0.935 -> 0.525 m: thighs level on a 0.46 m seat


def seated_legs():
    thigh = Matrix.Rotation(-90 * D, 3, "X")  # thighs forward
    shin = Matrix.Rotation(-4 * D, 3, "X")    # shins down, knees a touch past 90
    return {"thigh_L": thigh, "thigh_R": thigh, "shin_L": shin, "shin_R": shin, "foot_L": shin, "foot_R": shin}


def seated_base(lean_deg=6.0, yaw_deg=0.0) -> Pose:
    angles = dict(REST_DEG)
    angles["spine"] = (lean_deg, yaw_deg, 0)
    p = pose_from_rig(angles, seated_legs(), Vector((0, 0, -SEAT_DROP)))
    # the resting (right) forearm lies on the table edge
    return p


# ---------------------------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------------------------
def new_action(obj, name):
    obj.animation_data_create()
    act = bpy.data.actions.new(f"{name}__{obj.name}")
    obj.animation_data.action = act
    return act


def push_nla(obj, name, act, start):
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(start), act)
    strip.name = name
    obj.animation_data.action = None


def frame_of(t):
    return round(t * FPS)


def rehab_action(sk: Skeleton, name: str, meta: dict):
    j = json.load(open(os.path.join(REHAB_DIR, f"{name}.json")))
    rig = sk.rig
    act = new_action(rig, name)
    prev = {}
    right = {k: tuple(v) for k, v in j["rest"].items()}
    errors = []
    keys, scaled, turns = cap_elevation(list(j["keys"]))
    keys = list(keys)
    turns = list(turns)
    bridge = dict(keys[0])
    bridge["t"] = j["duration"] + 0.7  # ease back to the first pose so the loop never jumps
    turns.append(turns[0])
    for k, turn in zip(keys + [bridge], turns):
        angles = {"lShoulder": k["lShoulder"], "lElbow": k["lElbow"], "spine": k["spine"], **right}
        pose = hand_pose(sk, pose_from_rig(angles), "L", sk.hands.relaxed)
        pose = hand_pose(sk, pose, "R", sk.hands.relaxed)
        sk.key(pose, frame_of(k["t"]), prev)
        chk = k.get("check")
        if chk:
            for bone_from, bone_to, want in (("upper_arm_L", "forearm_L", chk["ua"]), ("forearm_L", "hand_L", chk["fa"])):
                got = (sk.head(pose, bone_to) - sk.head(pose, bone_from)).normalized()
                want_b = C @ (turn @ Vector(want)).normalized()
                errors.append(math.degrees(got.angle(want_b)))
    pace = pace_curve(sk, act, j["duration"]) if name in PACED_ACTIONS else None
    push_nla(rig, name, act, 0)
    duration = j["duration"] + 0.7
    steps = [{"t": s["t"], "step": s["step"], "caption": s["caption"]} for s in j["steps"]]
    meta[name] = {
        "duration": round(duration, 4), "loop": True, "camera": j["camera"], "props": [],
        "rep": [0.0, round(j["duration"], 4)], "steps": steps, "targets": [],
        "focus_bone": "upper_arm_L" if j["metric"] == "elevation" else "forearm_L",
        "source": j["source"]["dataset"], "seated": False,
        "retarget_error_deg": round(max(errors), 3) if errors else None,
        **({"ceiling_deg": scaled["ceiling_deg"], "scaled_from_deg": scaled["recorded_peak_deg"]} if scaled else {}),
        **({"pace": pace} if pace else {}),
    }


PACED_ACTIONS = ("flexion", "abduction")  # lift / hold / lower arm exercises paced by the service's rep_progress


def pace_curve(sk: Skeleton, act, rep_end: float) -> dict:
    """How the figure's rep lines up with the service's rep_progress (arm_fsm.rep_progress: lift
    0..0.4 by angle, hold 0.4..0.8 by time, lower 0.8..1 by angle). Samples the keyed action every
    frame for the torso-relative upper-arm elevation, then publishes, for the way up and the way
    down, (fraction of the peak elevation, time) pairs, monotone in the fraction, and the hold
    window around the peak. The app inverts these so the figure is as far up as the patient."""
    rig = sk.rig
    tracks = list(rig.animation_data.nla_tracks)
    for tr in tracks:
        tr.mute = True
    rig.animation_data.action = act
    samples = []
    for f in range(0, frame_of(rep_end) + 1):
        bpy.context.scene.frame_set(f)
        pb = rig.pose.bones
        ua = pb["forearm_L"].head - pb["upper_arm_L"].head
        up = pb["neck"].head - pb["chest"].head
        samples.append((f / FPS, math.degrees(ua.angle(-up))))
    rig.animation_data.action = None
    for tr in tracks:
        tr.mute = False
    lo = min(e for _, e in samples[:3])
    peak = max(e for _, e in samples)
    frac = [(t, max(0.0, (e - lo) / (peak - lo))) for t, e in samples]
    near = [t for t, fr in frac if fr >= 0.97]
    hold_in, hold_out = near[0], near[-1]

    def monotone(points, rising):
        out, best = [], -1.0
        for t, fr in points:
            if fr > best + 1e-4:
                out.append([round(fr, 4), round(t, 4)])
                best = fr
        return out
    up_pts = monotone([(t, fr) for t, fr in frac if t <= hold_in], True)
    down_pts = monotone([(t, fr) for t, fr in reversed(frac) if t >= hold_out], False)  # fraction rising backwards in time
    return {"lift": up_pts, "hold": [round(hold_in, 4), round(hold_out, 4)], "lower": down_pts,
            "peak_deg": round(peak, 1), "rest_deg": round(lo, 1)}


def idle_action(sk: Skeleton, meta: dict):
    rig = sk.rig
    act = new_action(rig, "idle")
    prev = {}
    period = 8.0
    for i in range(9):
        t = period * i / 8
        ph = 2 * math.pi * i / 8
        angles = dict(REST_DEG)
        angles["spine"] = (0.8 * math.sin(2 * ph), 2.0 * math.sin(ph), 0.6 * math.sin(ph))
        angles["head"] = (1.5 * math.sin(2 * ph + 1), -3.0 * math.sin(ph + 0.6), 0)
        angles["lShoulder"] = (-3 + 1.2 * math.sin(ph), 0, 4)
        angles["rShoulder"] = (-3 - 1.2 * math.sin(ph), 0, -4)
        pose = hand_pose(sk, pose_from_rig(angles), "L", sk.hands.relaxed)
        sk.key(hand_pose(sk, pose, "R", sk.hands.relaxed), frame_of(t), prev)
    push_nla(rig, "idle", act, 0)
    meta["idle"] = {"duration": period, "loop": True, "camera": "front", "props": [], "rep": [0.0, period],
                    "steps": [{"t": 0.0, "step": 1, "caption": "Ready when you are."}], "targets": [],
                    "focus_bone": None, "source": "procedural", "seated": False, "retarget_error_deg": None}


# Grip points, in rest coordinates of the left hand (mirror x for the right).
CUP_GRIP_HEIGHT = 0.055                       # grip ring above the cup's base
CUP_RADIUS = 0.035
CUP_POLE = Vector((1.0, 0.7, -0.15))  # elbow out to the side and back, about level with the wrist
CUP_ALIGN = (Vector((0, -1, 0)), Vector((0, 0, 1)))  # index edge of the hand up: fingers wrap the cup
PINCH_ALIGN = (Vector((-1, 0, 0)), Vector((0, 0.6, -0.8)).normalized())  # palm down and back toward the body: fingertips lead, knuckles high
# Hand posture for the peg pinch, found by searching roll x wrist angle for the pose in which no
# part of the hand except the fingertip pads comes within 1 mm of the board or the dish (pickup
# and seating): rolled 45 deg so the thumb-index side is lowest and the curled fingers ride above.
PINCH_PRON, PINCH_FLEX = 45.0, 0.0


def anchor(name) -> Vector:
    return bpy.data.objects[name].matrix_world.translation.copy()


class Timeline:
    """Keys a sequence of (t, pose, pinch, grip) and remembers carried-object spans for the bake."""

    def __init__(self, sk, name):
        self.sk, self.name = sk, name
        self.act = new_action(sk.rig, name)
        self.prev = {}
        self.poses = []  # (t, Pose)

    def key(self, t, pose: Pose, hand: "HandShape"):
        pose = hand_pose(self.sk, pose, "L", hand)
        pose = hand_pose(self.sk, pose, "R", self.sk.hands.relaxed)
        self.sk.key(pose, frame_of(t), self.prev)
        self.poses.append((t, pose))
        return pose

    def done(self):
        push_nla(self.sk.rig, self.name, self.act, 0)

    def pose_at(self, t):
        return next(p for tt, p in self.poses if abs(tt - t) < 1e-6)


def bake_follow(sk: Skeleton, obj, act_rig, spans, rest_loc: Vector, name: str, end_t: float,
                after=None, rot_keys=(), loc_keys=()):
    """Key `obj` so that while carried (spans of (t0, t1, grip_rest, lift)) its origin sits at the
    hand's grip point minus a fixed world offset `lift`: an upright cup or peg hangs under the
    fingers however the hand turns. Orientation is keyed separately (`rot_keys` = (t, euler)).
    Otherwise it stays where it was put down (`after` overrides the resting place once carried)."""
    act = new_action(obj, name)
    rig = sk.rig
    scene = bpy.context.scene
    tracks = list(rig.animation_data.nla_tracks)
    for tr in tracks:
        tr.mute = True
    rig.animation_data.action = act_rig
    loc = rest_loc.copy()
    for f in range(0, frame_of(end_t) + 1):
        t = f / FPS
        carried = next((sp for sp in spans if sp[0] <= t <= sp[1]), None)
        if carried:
            scene.frame_set(f)
            local = sk.bones["hand_L"].matrix_local.inverted() @ carried[2]
            loc = (rig.matrix_world @ rig.pose.bones["hand_L"].matrix) @ local - carried[3]
        elif after is not None and any(t > sp[1] for sp in spans):
            loc = after
        obj.location = loc
        obj.keyframe_insert("location", frame=f)
    for t, e in rot_keys:
        obj.rotation_euler = e
        obj.keyframe_insert("rotation_euler", frame=frame_of(t))
    for t, l in loc_keys:  # overrides the baked value at that frame (e.g. the loop reset)
        obj.location = l
        obj.keyframe_insert("location", frame=frame_of(t))
    rig.animation_data.action = None
    for tr in tracks:
        tr.mute = False
    push_nla(obj, name, act, 0)


def hand_error_mm(sk: Skeleton, act_rig, pose: "Pose", t: float) -> float:
    """Our FK vs Blender's evaluated pose at a key: proves the keyed basis reproduces the deltas."""
    rig = sk.rig
    tracks = list(rig.animation_data.nla_tracks)
    for tr in tracks:
        tr.mute = True
    rig.animation_data.action = act_rig
    bpy.context.scene.frame_set(frame_of(t))
    got = (rig.matrix_world @ rig.pose.bones["hand_L"].matrix).translation
    want = rig.matrix_world @ sk.head(pose, "hand_L")
    rig.animation_data.action = None
    for tr in tracks:
        tr.mute = False
    return (got - want).length * 1000


def reach_pose(sk, base: Pose, target: Vector, grip_rest: Vector, pole=None, pron=0.0, flex=0.0, align=None):
    pole = pole or Vector((0.6, 0.25, -1.0))
    return solve_arm(sk, base, "L", grip_rest, target, pole, pron, flex, align=align)


def cup_action(sk: Skeleton, meta: dict):
    """Waiter – cup, GRASP Coordination Level 2: carry the cup dot to dot along the arc, 1 -> 5 and
    back, lifting it clear and setting it down on each dot. One slow pass; the app plays the fast
    passes by running the same action quicker."""
    name = "waiter_cup"
    dots = [anchor(f"anchor_dot_{k}") for k in range(1, 6)]
    cup = bpy.data.objects["prop_cup"]
    tl = Timeline(sk, name)
    H = sk.hands
    grip_at = lambda p, lift=0.0: p + Vector((0, 0, CUP_GRIP_HEIGHT + lift))  # noqa: E731 cup axis at the grip ring
    lean = lambda k: 9 - 2 * abs(k - 2)  # noqa: E731 the arc's apex (dot 3) is farthest

    def at(k, lift=0.0, base=None):
        b = base or seated_base(lean(k), -4 * (k - 2))
        return reach_pose(sk, b, grip_at(dots[k], lift), H.cup_centre, pole=CUP_POLE, align=CUP_ALIGN)

    beside = dots[0] + Vector((0.09, 0.08, 0.0))
    rest_hand = reach_pose(sk, seated_base(5), beside + Vector((0, 0, 0.040)), H.cup_centre, pole=CUP_POLE,
                           align=CUP_ALIGN)
    steps, targets, spans = [], [], []
    t = 0.0
    tl.key(t, rest_hand, H.relaxed)
    steps.append({"t": t, "step": 1, "caption": "Step 1 of 4 · cup on dot 1, hand resting beside it"})
    t += 1.0
    tl.key(t, rest_hand, H.relaxed)
    steps.append({"t": t, "step": 2, "caption": "Step 2 of 4 · take hold of the cup"})
    t += 0.9
    tl.key(t, at(0), H.cup_open)
    t += 0.3
    tl.key(t, at(0), H.cup)
    rep0 = t
    order = [1, 2, 3, 4, 3, 2, 1, 0]
    carry_t0 = t
    for i, k in enumerate(order):
        if i == 0:
            steps.append({"t": t, "step": 3, "caption": "Step 3 of 4 · lift, move to the next dot, set it down; dot by dot to 5"})
        if i == 4:
            steps.append({"t": t, "step": 4, "caption": "Step 4 of 4 · then back the way you came to dot 1"})
        frm = order[i - 1] if i else 0
        t += 0.25
        tl.key(t, at(frm, 0.05), H.cup)
        targets.append({"t": round(t, 4), "kind": "dot", "index": k + 1})
        t += 0.75
        tl.key(t, at(k, 0.05), H.cup)
        t += 0.25
        tl.key(t, at(k), H.cup)
        t += 0.2
        tl.key(t, at(k), H.cup)
        targets.append({"t": round(t, 4), "kind": "dot", "index": k + 1, "landed": True})
    rep1 = t
    carry_t1 = t
    t += 0.3
    tl.key(t, at(0), H.cup_open)
    t += 0.9
    tl.key(t, rest_hand, H.relaxed)
    t += 1.0
    tl.key(t, rest_hand, H.relaxed)
    end = t
    tl.done()
    grasp_pose = tl.pose_at(carry_t0)
    err = hand_error_mm(sk, tl.act, grasp_pose, carry_t0)
    assert err < 1.0, f"cup grasp: keyed pose is {err:.2f} mm off our FK"
    base_rest = cup.location.copy()
    lift = grip_at(dots[0]) - base_rest  # cup axis point at the grip ring -> cup origin (base)
    bake_follow(sk, cup, tl.act, [(carry_t0, carry_t1, H.cup_centre, lift)], base_rest, name, end)
    meta[name] = {"duration": round(end, 4), "loop": True, "camera": "front", "props": ["table", "sheet", "cup"],
                  "rep": [round(rep0, 4), round(rep1, 4)], "steps": steps, "targets": targets,
                  "focus_bone": "hand_L", "source": "procedural", "seated": True, "retarget_error_deg": None}


def nhpt_action(sk: Skeleton, meta: dict):
    """Nine-Hole Peg Test: pinch each peg from the dish across its middle, carry it over the board
    (it turns upright on the way), seat it in hole k, let go, back to the dish. All nine, in board
    order starting on the practising side."""
    name = "nhpt"
    holes = [anchor(f"anchor_hole_{k}") for k in range(1, 10)]
    pegs = [bpy.data.objects[f"prop_peg_{k}"] for k in range(1, 10)]
    tl = Timeline(sk, name)
    PEG_LEN, SINK, ABOVE = 0.032, 0.012, 0.004  # peg length, depth seated; pads meet the peg on its upper half

    H = sk.hands

    def over(p, lift, lean=10):
        return reach_pose(sk, seated_base(lean), p + Vector((0, 0, ABOVE + lift)), H.pinch_point,
                          pole=Vector((0.8, 0.3, -0.6)), pron=PINCH_PRON, flex=PINCH_FLEX, align=PINCH_ALIGN)

    seat_c = [h + Vector((0, 0, PEG_LEN / 2 - SINK)) for h in holes]  # upright peg centre when seated
    src_c = [pg.location.copy() for pg in pegs]
    steps, targets, spans = [], [], []
    t = 0.0
    tl.key(t, over(src_c[0], 0.06), H.open)
    rep0 = t
    per = 2.2
    for k in range(9):
        T = t
        if k == 0:
            steps.append({"t": T, "step": 1, "caption": "Step 1 of 3 · pick a peg from the dish with a pinch"})
        tl.key(T + 0.30, over(src_c[k], 0.020), H.open)  # pre-shaped hand arrives above the peg
        tl.key(T + 0.45, over(src_c[k], 0.005), H.near)  # narrows as it settles
        tl.key(T + 0.55, over(src_c[k], 0.0), H.pinch)
        targets.append({"t": round(T + 0.55, 4), "kind": "hole", "index": k + 1})
        tl.key(T + 0.75, over(src_c[k], 0.07), H.pinch)
        if k == 0:
            steps.append({"t": T + 0.75, "step": 2, "caption": "Step 2 of 3 · carry it over the board, any hole"})
        tl.key(T + 1.3, over(seat_c[k], 0.05), H.pinch)
        tl.key(T + 1.55, over(seat_c[k], 0.0), H.pinch)
        if k == 0:
            steps.append({"t": T + 1.55, "step": 3, "caption": "Step 3 of 3 · seat it and let go; the timer stops at the ninth peg"})
        tl.key(T + 1.7, over(seat_c[k], 0.0), H.pinch)  # peg seated, still held
        tl.key(T + 1.8, over(seat_c[k], 0.006), H.near)  # let go: pads part as the hand rises
        tl.key(T + 1.95, over(seat_c[k], 0.025), H.open)  # then lift clear and open
        targets.append({"t": round(T + 1.7, 4), "kind": "hole", "index": k + 1, "landed": True})
        nxt = src_c[k + 1] if k < 8 else src_c[0]
        tl.key(T + per, over(nxt, 0.06), H.open)
        spans.append((T + 0.55, T + 1.7))
        t = T + per
    rep1 = t
    end = t + 0.8
    tl.key(end, over(src_c[0], 0.06), H.open)
    tl.done()
    for k, pg in enumerate(pegs):
        t0, t1 = spans[k]
        grasp = tl.pose_at(t0)
        if k == 0:
            err = hand_error_mm(sk, tl.act, grasp, t0)
            assert err < 1.0, f"peg grasp: keyed pose is {err:.2f} mm off our FK"
        lying = pg.rotation_euler.copy()
        upright = lying.copy()
        upright.x = 0.0
        rot_keys = [(0.0, lying), (t0 + 0.1, lying), (t0 + 0.6, upright), (end - 1 / FPS, upright), (end, lying)]
        # the loop restarts with every peg back in the dish (keyed inside the action, not after it)
        bake_follow(sk, pg, tl.act, [(t0, t1, H.pinch_point, Vector((0, 0, ABOVE)))], src_c[k], name, end,
                    after=seat_c[k], rot_keys=rot_keys, loc_keys=[(end, src_c[k])])
        assert pg.animation_data.action is None, "a stray active action would override the NLA track"
    meta[name] = {"duration": round(end, 4), "loop": True, "camera": "front", "props": ["table", "pegboard"],
                  "rep": [round(rep0, 4), round(rep1, 4)], "steps": steps, "targets": targets,
                  "focus_bone": "hand_L", "source": "procedural", "seated": True, "retarget_error_deg": None}


REHAB_ACTIONS = ["pendulum", "flexion", "abduction", "external_rotation", "internal_rotation"]
ACTIONS = ["idle", *REHAB_ACTIONS, "waiter_cup", "nhpt"]


def build_actions(rig) -> dict:
    scene = bpy.context.scene
    scene.render.fps = FPS
    sk = Skeleton(rig)
    sk.hands = Hands(sk)
    meta: dict = {}
    idle_action(sk, meta)
    for n in REHAB_ACTIONS:
        rehab_action(sk, n, meta)
    cup_action(sk, meta)
    nhpt_action(sk, meta)
    for pb in rig.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)
    scene.frame_set(0)
    return {"fps": FPS, "rig": "rig.ts-compatible; Blender bones", "actions": {n: meta[n] for n in ACTIONS}}


def write_meta(meta: dict):
    with open(META_OUT, "w") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")
