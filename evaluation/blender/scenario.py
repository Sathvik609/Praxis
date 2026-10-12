"""Scenarios and ground truth for the 3-D NHPT / Waiter – cup renders (pure Python: no bpy, no cv2).

**Synthetic 3-D renders, not real-camera evidence.** This module scripts what happens in a clip:
where the camera is, the light, the hand/forearm proxy's pose, every peg and the cup, frame by
frame, and the ground-truth labels (`praxis.labels/1`, the same schema a human labeller writes
with `services/session/tools/label_clip.py`). `render_tasks.py` (inside Blender) only draws
what this module says; `make_dataset_3d.py` drives both and writes the dataset.

Coordinates: millimetres in a right-handed world with Z up and the sheet on the table at Z = 0:
world (X, Y) = (sheet x, -sheet y), so world +Y points from the patient towards the laptop and the
camera sits on the +Y side, looking down at the sheet and towards the patient (a laptop camera
over a sheet 25–35 cm in front of it). Sheet geometry comes from
`services/session/praxis_session/perception/board_spec.py` (passed in by the driver as plain
numbers, so this module and Blender's Python never import cv2).

Physical sizes (standard NHPT): pegs 32 mm long, 6–9 mm across; a perforated board on the printed
sheet with 10 mm holes over the nine printed rings (32 mm pitch); a seated peg stands on the paper,
so it is (32 - board thickness) mm proud of the board. Cup: a plastic cup with a 19 mm ring of blue
electrical tape round the base (evaluation/PROTOCOL.md §1.5) and a handle.
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import asdict, dataclass, field
from typing import Any

Vec = tuple[float, float, float]

FPS = 12.0
PEG_LEN_MM = 32.0
HOLE_D_MM = 10.0
BOARD_SIZE_MM = 100.0
CUP_BASE_D_MM = 58.0
CUP_TOP_D_MM = 78.0
CUP_H_MM = 95.0
CUP_BAND_MM = 19.0
CUP_GRIP_Z_MM = 52.0
MARKER_HOLD_S = 1.5  # calibration.HOLD_S: fewer than 3 markers for longer than this = marker_lost
ARC = [0, 1, 2, 3, 4, 3, 2, 1, 0]  # cup.ARC, dot indices


# ---- small vector helpers -----------------------------------------------------------------
def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a: Vec, s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a: Vec) -> float:
    return math.sqrt(dot(a, a))


def unit(a: Vec) -> Vec:
    n = norm(a)
    return (0.0, 0.0, 1.0) if n < 1e-9 else mul(a, 1.0 / n)


def lerp(a, b, s: float):
    return tuple(x + (y - x) * s for x, y in zip(a, b, strict=True))


def rot(v: Vec, axis: Vec, deg: float) -> Vec:
    """Rodrigues: rotate v about unit `axis` by `deg` (right-hand rule)."""
    k = unit(axis)
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)))


def min_jerk(s: float) -> float:
    s = min(1.0, max(0.0, s))
    return s * s * s * (10 - 15 * s + 6 * s * s)


def sheet_to_world(x: float, y: float, z: float = 0.0) -> Vec:
    return (x, -y, z)


# ---- keyframed tracks -----------------------------------------------------------------------
class Track:
    """Piecewise minimum-jerk interpolation between keys (t, value-tuple); holds outside."""

    def __init__(self, t0: float, v0) -> None:
        self.keys: list[tuple[float, tuple]] = [(t0, tuple(v0))]

    def to(self, t: float, v) -> None:
        if t < self.keys[-1][0] - 1e-9:
            raise ValueError("keys must be in time order")
        self.keys.append((t, tuple(v)))

    def hold(self, t: float) -> None:
        self.to(t, self.keys[-1][1])

    @property
    def last(self) -> tuple:
        return self.keys[-1][1]

    @property
    def t_end(self) -> float:
        return self.keys[-1][0]

    def at(self, t: float) -> tuple:
        ks = self.keys
        if t <= ks[0][0]:
            return ks[0][1]
        for (ta, va), (tb, vb) in zip(ks[:-1], ks[1:], strict=True):
            if t <= tb:
                if tb - ta < 1e-9:
                    return vb
                return lerp(va, vb, min_jerk((t - ta) / (tb - ta)))
        return ks[-1][1]


# ---- the hand / forearm proxy -----------------------------------------------------------
# Hand frame: f = forward (along the fingers), m = u x f, u = back of the hand. The thumb side is
# l = side * m (side +1 right hand, -1 left hand). Lengths in mm, adult proportions.
FINGERS: dict[str, tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float], float]] = {
    # knuckle (f, l, u), phalanx lengths, radii, spread (deg, towards the thumb side)
    "index": ((86.0, 25.0, 0.0), (42.0, 25.0, 20.0), (9.0, 8.0, 7.2), 6.0),
    "middle": ((90.0, 7.0, 0.5), (46.0, 28.0, 21.0), (9.4, 8.4, 7.4), 0.0),
    "ring": ((86.0, -11.0, 0.0), (43.0, 27.0, 20.0), (8.8, 7.8, 7.0), -6.0),
    "little": ((78.0, -27.0, -2.0), (34.0, 20.0, 17.0), (7.8, 6.8, 6.2), -14.0),
}
THUMB_BASE = (22.0, 30.0, -10.0)
THUMB_DIR = (0.55, 0.75, -0.35)  # metacarpal direction in (f, l, u)
THUMB_RADII = (11.5, 10.0, 9.0)
PALM_CENTRE = (45.0, -1.0, 0.0)
PALM_SIZE = (90.0, 74.0, 26.0)
FOREARM_LEN = 255.0
FOREARM_R = (27.0, 38.0)  # wrist, elbow

# Finger flexion (MCP, PIP, DIP) per pose; the thumb tip is solved per pose below.
POSES: dict[str, dict[str, tuple[float, float, float]]] = {
    "open": {"index": (8, 10, 5), "middle": (10, 12, 6), "ring": (12, 14, 8), "little": (14, 16, 8)},
    "pinch": {"index": (38, 48, 22), "middle": (52, 62, 30), "ring": (62, 70, 34), "little": (66, 72, 36)},
    "grip": {"index": (42, 58, 34), "middle": (44, 60, 36), "ring": (46, 62, 36), "little": (50, 64, 36)},
    "rest": {"index": (22, 28, 16), "middle": (26, 32, 18), "ring": (30, 36, 20), "little": (34, 38, 22)},
}


def _local(frame: tuple[Vec, Vec, Vec], p: tuple[float, float, float]) -> Vec:
    f, lat, u = frame
    return add(add(mul(f, p[0]), mul(lat, p[1])), mul(u, p[2]))


def finger_chain(frame_flu: tuple[Vec, Vec, Vec], name: str, flex) -> list[Vec]:
    """Joint points (knuckle, PIP, DIP, tip) of one finger, in the hand frame's own coordinates
    when frame_flu is the identity frame, else in world mm relative to the wrist."""
    f, lat, u = frame_flu
    knuckle, lens, _, spread = FINGERS[name]
    side_m = unit(cross(u, f))
    side = 1.0 if dot(lat, side_m) > 0 else -1.0
    d = rot(f, u, side * spread)
    bend_axis = unit(cross(u, d))
    p = _local(frame_flu, knuckle)
    pts = [p]
    ang = 0.0
    for length, a in zip(lens, flex, strict=True):
        ang += a
        p = add(p, mul(rot(d, bend_axis, ang), length))
        pts.append(p)
    return pts


IDENTITY: tuple[Vec, Vec, Vec] = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def thumb_chain(frame_flu: tuple[Vec, Vec, Vec], tip_local: Vec) -> list[Vec]:
    """Thumb joints on a quadratic Bezier from the base along the metacarpal direction to the
    pose's tip: base, MCP, IP, tip (a smooth, plausible curl without a full IK)."""
    base = _local(frame_flu, THUMB_BASE)
    ctrl = add(base, mul(unit(_local(frame_flu, THUMB_DIR)), 38.0))
    tip = _local(frame_flu, tip_local)

    def bez(s: float) -> Vec:
        a = mul(base, (1 - s) ** 2)
        b = mul(ctrl, 2 * (1 - s) * s)
        c = mul(tip, s * s)
        return add(add(a, b), c)

    return [bez(s) for s in (0.0, 0.42, 0.74, 1.0)]


def _thumb_tip_for(pose: str) -> Vec:
    idx = finger_chain(IDENTITY, "index", POSES[pose]["index"])
    if pose == "pinch":
        # the thumb pad meets the index pad with a peg's width between them
        return add(idx[-1], (-4.0, 10.0, -2.0))
    if pose == "grip":
        return add(idx[2], (-30.0, 12.0, -18.0))
    if pose == "rest":
        return (70.0, 52.0, -30.0)
    return (62.0, 70.0, -22.0)  # open: abducted


THUMB_TIPS: dict[str, Vec] = {p: _thumb_tip_for(p) for p in POSES}


def pinch_point_local() -> Vec:
    idx = finger_chain(IDENTITY, "index", POSES["pinch"]["index"])
    return mul(add(idx[-1], THUMB_TIPS["pinch"]), 0.5)


def pose_vector(pose: str) -> tuple[float, ...]:
    p = POSES[pose]
    return tuple(a for k in ("index", "middle", "ring", "little") for a in p[k]) + THUMB_TIPS[pose]


def unpack_pose(v) -> tuple[dict[str, tuple[float, float, float]], Vec]:
    flex = {k: tuple(v[3 * i : 3 * i + 3]) for i, k in enumerate(("index", "middle", "ring", "little"))}
    return flex, tuple(v[12:15])


def hand_frame(heading: Vec, pitch_deg: float, side: int, grip: bool) -> tuple[Vec, Vec, Vec]:
    """(f, l, u) world unit vectors. Palm down for a pinch (fingers pitched down), or palm towards
    the cup with the thumb up for a grip."""
    h = unit((heading[0], heading[1], 0.0))
    if grip:
        f = unit(add(h, (0.0, 0.0, -math.tan(math.radians(pitch_deg)))))
        u = unit(mul(cross(h, (0.0, 0.0, 1.0)), side))
        u = unit(sub(u, mul(f, dot(u, f))))
    else:
        f = unit(add(mul(h, math.cos(math.radians(pitch_deg))), (0.0, 0.0, -math.sin(math.radians(pitch_deg)))))
        m = unit(cross((0.0, 0.0, 1.0), f))
        u = unit(cross(f, m))
    m = unit(cross(u, f))
    return f, mul(m, side), u


def grip_point_local(cup_r_at_grip: float) -> Vec:
    """Where the cup axis sits in the hand frame for a power grip: palm side, between palm and fingers."""
    return (58.0, 4.0, -(PALM_SIZE[2] / 2 + cup_r_at_grip + 2.0))


@dataclass
class HandFrame:
    """Everything the renderer needs for the hand/forearm at one instant (world mm)."""

    wrist: Vec
    frame: tuple[Vec, Vec, Vec]
    fingers: dict[str, list[Vec]]
    thumb: list[Vec]
    elbow: Vec
    pinch: Vec


def solve_hand(target: Vec, pose_v, pitch_deg: float, side: int, shoulder: Vec, grip: bool, grip_local: Vec | None = None) -> HandFrame:
    """Place the hand so its pinch point (or, gripping, the cup axis) lands on `target`."""
    heading = sub(target, shoulder)
    frame = hand_frame(heading, pitch_deg, side, grip)
    flex, thumb_tip = unpack_pose(pose_v)
    local = grip_local if grip and grip_local is not None else pinch_point_local()
    wrist = sub(target, _local(frame, local))
    fingers = {k: [add(wrist, p) for p in finger_chain(frame, k, flex[k])] for k in FINGERS}
    thumb = [add(wrist, p) for p in thumb_chain(frame, thumb_tip)]
    to_shoulder = unit(sub(shoulder, wrist))
    elbow = add(wrist, mul(to_shoulder, FOREARM_LEN))
    elbow = (elbow[0], elbow[1], max(elbow[2], 45.0))  # the elbow rests on or above the table
    pinch = mul(add(fingers["index"][-1], thumb[-1]), 0.5)
    return HandFrame(wrist, frame, fingers, thumb, elbow, pinch)


def hand_primitives(h: HandFrame, sleeve: bool) -> dict[str, Any]:
    """Capsule segments (p0, p1, r0, r1) + the palm box for the renderer."""
    segs: list[tuple[Vec, Vec, float, float]] = []
    for k, pts in h.fingers.items():
        radii = FINGERS[k][2]
        for j in range(3):
            r0 = radii[j]
            r1 = radii[j + 1] if j + 1 < 3 else radii[j] * 0.9
            segs.append((pts[j], pts[j + 1], r0, r1))
    for j in range(3):
        r0 = THUMB_RADII[j]
        r1 = THUMB_RADII[j + 1] if j + 1 < 3 else THUMB_RADII[j] * 0.9
        segs.append((h.thumb[j], h.thumb[j + 1], r0, r1))
    f, lat, u = h.frame
    palm_c = add(h.wrist, _local(h.frame, PALM_CENTRE))
    forearm = (h.wrist, h.elbow, FOREARM_R[0], FOREARM_R[1])
    sleeve_seg = None
    if sleeve:
        start = add(h.wrist, mul(unit(sub(h.elbow, h.wrist)), 55.0))
        sleeve_seg = (start, add(h.elbow, mul(unit(sub(h.elbow, h.wrist)), 40.0)), FOREARM_R[0] + 7.0, FOREARM_R[1] + 9.0)
    return {
        "segments": [[list(a), list(b), r0, r1] for a, b, r0, r1 in segs],
        "palm": {"centre": list(palm_c), "f": list(f), "l": list(lat), "u": list(u), "size": list(PALM_SIZE)},
        "forearm": [list(forearm[0]), list(forearm[1]), forearm[2], forearm[3]],
        "sleeve": None if sleeve_seg is None else [list(sleeve_seg[0]), list(sleeve_seg[1]), sleeve_seg[2], sleeve_seg[3]],
        "pinch": list(h.pinch),
        "wrist": list(h.wrist),
    }


# ---- conditions --------------------------------------------------------------------------
PEG_COLOURS = {  # linear-ish albedo of saturated plastic pegs the product's default window takes
    "red": (0.72, 0.025, 0.025),
    "blue": (0.015, 0.09, 0.62),
    "green": (0.03, 0.42, 0.05),
    "yellow": (0.82, 0.58, 0.015),
}
SKIN = {"light": (0.70, 0.45, 0.33), "medium": (0.45, 0.26, 0.16), "deep": (0.13, 0.075, 0.05)}
CUP_COLOURS = {"white": (0.80, 0.80, 0.78), "cream": (0.78, 0.70, 0.52), "grey": (0.45, 0.46, 0.48)}
BAND_BLUE = (0.02, 0.10, 0.55)
LIGHTS = ("daylight", "dim", "warm_bulb", "window")


@dataclass
class Condition:
    id: str
    exercise: str  # "nhpt" | "cup"
    seed: int
    tilt_deg: float  # camera axis from straight down
    yaw_deg: float  # camera heading off the sheet's axis
    dist_mm: float  # camera to aim point
    focal_per_width: float  # laptop lens: f = k * 640 px
    roll_deg: float
    light: str
    side: str  # practising hand
    skin: str
    sleeve: bool
    noise_sigma: float
    speed: float = 1.0  # > 1 is faster
    peg_colour: str = "red"
    peg_d_mm: float = 7.0
    board_mm: float = 5.0  # perforated board thickness (seated peg is 32 - board_mm proud)
    cup_colour: str = "white"
    fps: float = FPS
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def default_conditions() -> list[Condition]:
    """The v0 render set: each clip changes several things at once (tilt, yaw, distance, light,
    hand, skin, sleeve, colour, size, board), spread so every value of each factor appears."""
    n = [
        Condition("nhpt3d_01", "nhpt", 101, 40, 4, 330, 0.85, 0.0, "daylight", "right", "light", False, 3.0, 1.0, "red", 7.0, 5.0),
        Condition("nhpt3d_02", "nhpt", 102, 50, -8, 360, 0.80, 1.5, "warm_bulb", "right", "medium", True, 4.0, 1.1, "blue", 7.0, 12.0),
        Condition("nhpt3d_03", "nhpt", 103, 30, 10, 310, 0.90, -1.0, "window", "left", "deep", False, 3.0, 0.9, "green", 9.0, 5.0),
        Condition("nhpt3d_04", "nhpt", 104, 45, 0, 345, 0.85, 0.5, "dim", "right", "medium", False, 7.0, 1.0, "yellow", 6.0, 12.0),
        Condition("nhpt3d_05", "nhpt", 105, 20, -5, 380, 0.95, 0.0, "daylight", "right", "deep", True, 3.0, 1.2, "red", 8.0, 8.0),
        Condition("nhpt3d_06", "nhpt", 106, 35, 14, 320, 0.80, -2.0, "warm_bulb", "left", "light", True, 4.0, 1.0, "green", 7.0, 5.0),
        Condition("nhpt3d_07", "nhpt", 107, 50, 0, 350, 0.85, 0.0, "window", "right", "medium", False, 3.0, 1.1, "red", 7.0, 3.0),
        Condition("nhpt3d_08", "nhpt", 108, 25, -12, 360, 0.90, 1.0, "dim", "left", "light", True, 7.0, 1.0, "blue", 8.0, 12.0),
        Condition("nhpt3d_09", "nhpt", 109, 42, 18, 335, 0.80, -1.0, "daylight", "right", "deep", False, 3.0, 1.3, "yellow", 7.0, 5.0),
        Condition("nhpt3d_10", "nhpt", 110, 38, -15, 325, 0.85, 0.5, "warm_bulb", "right", "light", False, 4.0, 0.8, "green", 6.0, 8.0),
    ]
    c = [
        Condition("cup3d_01", "cup", 201, 40, 4, 380, 0.85, 0.0, "daylight", "right", "light", False, 3.0, 1.0, cup_colour="white"),
        Condition("cup3d_02", "cup", 202, 50, -8, 410, 0.80, 1.5, "warm_bulb", "right", "medium", True, 4.0, 1.1, cup_colour="cream"),
        Condition("cup3d_03", "cup", 203, 30, 10, 370, 0.90, -1.0, "window", "left", "deep", False, 3.0, 0.9, cup_colour="white"),
        Condition("cup3d_04", "cup", 204, 45, 0, 400, 0.85, 0.5, "dim", "right", "medium", False, 7.0, 1.0, cup_colour="grey"),
        Condition("cup3d_05", "cup", 205, 20, -5, 430, 0.95, 0.0, "daylight", "right", "deep", True, 3.0, 1.2, cup_colour="white"),
        Condition("cup3d_06", "cup", 206, 35, 14, 375, 0.80, -2.0, "warm_bulb", "left", "light", True, 4.0, 1.0, cup_colour="white"),
    ]
    return n + c


# ---- sheets (numbers handed in by the driver from board_spec) ------------------------------
@dataclass
class SheetGeom:
    name: str
    width_mm: float
    height_mm: float
    page: tuple[float, float, float, float]  # (pw, ph, ox, oy) of the printed page in sheet mm
    markers: dict[int, tuple[float, float]]
    marker_size_mm: float
    targets: list[tuple[float, float]]
    target_radius_mm: float

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SheetGeom:
        return cls(d["name"], d["width_mm"], d["height_mm"], tuple(d["page"]), {int(k): tuple(v) for k, v in d["markers"].items()},
                   d["marker_size_mm"], [tuple(t) for t in d["targets"]], d["target_radius_mm"])

    @property
    def targets_centre(self) -> tuple[float, float]:
        xs = [t[0] for t in self.targets]
        ys = [t[1] for t in self.targets]
        return sum(xs) / len(xs), sum(ys) / len(ys)


def camera_pose(cond: Condition, aim_sheet: tuple[float, float]) -> dict[str, Any]:
    """Camera on the laptop side (+Y world), `tilt_deg` from straight down, yawed about the aim."""
    aim = sheet_to_world(aim_sheet[0], aim_sheet[1], 0.0)
    t, y = math.radians(cond.tilt_deg), math.radians(cond.yaw_deg)
    back = (math.sin(y), math.cos(y), 0.0)  # towards the laptop
    pos = add(aim, add(mul(back, cond.dist_mm * math.sin(t)), (0.0, 0.0, cond.dist_mm * math.cos(t))))
    return {"position": list(pos), "aim": list(aim), "roll_deg": cond.roll_deg, "focal_px": cond.focal_per_width * 640.0,
            "size": [640, 480]}


def project_px(cam: dict[str, Any], pts: list[Vec]) -> list[tuple[float, float]]:
    """World mm -> image px for `camera_pose` (the camera looks at its aim with world +Z as up,
    like Blender's to_track_quat('-Z', 'Y'), then rolls about the view axis)."""
    pos, aim = tuple(cam["position"]), tuple(cam["aim"])
    d = unit(sub(aim, pos))
    r = unit(cross(d, (0.0, 0.0, 1.0)))
    u = cross(r, d)
    r, u = rot(r, d, -cam["roll_deg"]), rot(u, d, -cam["roll_deg"])
    w, h = cam["size"]
    f = cam["focal_px"]
    out = []
    for p in pts:
        q = sub(p, pos)
        z = dot(q, d)
        out.append((w / 2 + f * dot(q, r) / z, h / 2 - f * dot(q, u) / z))
    return out


def framed(cond: Condition, sheet: SheetGeom, margin_px: float = 4.0) -> Condition:
    """The condition as the patient would leave it after camera setup (screen 05 refuses to start
    until all four markers are in view): the camera is moved back in 10 mm steps until every
    marker corner is inside the frame with a small margin."""
    aim = sheet.targets_centre if cond.exercise == "nhpt" else (sheet.width_mm / 2, sheet.height_mm / 2)
    half = sheet.marker_size_mm / 2
    corners = [sheet_to_world(x + dx, y + dy) for x, y in sheet.markers.values() for dx in (-half, half) for dy in (-half, half)]
    c = cond
    for _ in range(40):
        px = project_px(camera_pose(c, aim), corners)
        if all(margin_px <= x <= 640 - margin_px and margin_px <= y <= 480 - margin_px for x, y in px):
            break
        c = Condition(**{**c.to_dict(), "dist_mm": c.dist_mm + 10.0})
    if c.dist_mm != cond.dist_mm:
        c = Condition(**{**c.to_dict(), "notes": f"camera moved back from {cond.dist_mm:.0f} to {c.dist_mm:.0f} mm so all four markers are in view (setup)"})
    return c


def shoulder_point(cond: Condition, sheet: SheetGeom) -> Vec:
    """The practising shoulder: the patient sits on the -Y side, ~300 mm beyond the sheet edge."""
    sgn = 1.0 if cond.side == "right" else -1.0
    cx = sheet.width_mm / 2 + sgn * 170.0
    return sheet_to_world(cx, sheet.height_mm + 320.0, 330.0)


# ---- the scripted runs --------------------------------------------------------------------
@dataclass
class Script:
    cond: Condition
    sheet: SheetGeom
    duration_s: float
    hand_target: Track
    hand_pose: Track
    hand_pitch: Track
    objects: dict[str, Track]  # object id -> Track of (x, y, z, ax, ay, az) world mm + axis
    reps: list[dict[str, Any]] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)


def _jit(rng: random.Random, x: float, rel: float = 0.15) -> float:
    return x * (1.0 + rng.uniform(-rel, rel))


def dish_centre(cond: Condition, sheet: SheetGeom) -> Vec:
    """A shallow dish beside the sheet on the practising side, level with the hole grid."""
    sgn = 1.0 if cond.side == "right" else -1.0
    cx = sheet.width_mm / 2 + sgn * (sheet.width_mm / 2 + 42.0)
    return sheet_to_world(cx, sheet.targets_centre[1] + 10.0, 0.0)


DISH_R_MM = 38.0
DISH_FLOOR_MM = 3.0


def nhpt_script(cond: Condition, sheet: SheetGeom) -> Script:
    """Nine pegs from the dish, any hole order, one at a time. Labels per peg: t_start = the peg
    leaves the dish (the timer's start for peg 1), t_end = the peg is down in its hole."""
    rng = random.Random(cond.seed)
    sp = cond.speed
    side = 1 if cond.side == "right" else -1
    shoulder = shoulder_point(cond, sheet)
    dish = dish_centre(cond, sheet)
    order = list(range(9))
    rng.shuffle(order)
    r_peg = cond.peg_d_mm / 2
    # pegs lie in the dish, scattered
    lying: list[tuple[Vec, Vec]] = []
    for i in range(9):
        a = 2 * math.pi * i / 9 + rng.uniform(-0.2, 0.2)
        rr = rng.uniform(4.0, DISH_R_MM - 22.0)
        c = add(dish, (rr * math.cos(a), rr * math.sin(a), DISH_FLOOR_MM + r_peg + (2 * r_peg if i % 4 == 3 else 0.0)))
        ang = rng.uniform(0, math.pi)
        lying.append((c, (math.cos(ang), math.sin(ang), 0.0)))
    holes = [sheet_to_world(x, y, 0.0) for x, y in sheet.targets]
    rest = add(sheet_to_world(sheet.width_mm / 2 + side * 70.0, sheet.height_mm + 60.0), (0.0, 0.0, 70.0))

    t = 0.0
    tgt = Track(0.0, rest)
    pose = Track(0.0, pose_vector("rest"))
    pitch = Track(0.0, (30.0,))
    objs = {f"peg{i}": Track(0.0, lying[i][0] + lying[i][1]) for i in range(9)}
    reps = []
    t = 0.8  # still frames before the first reach (calibration needs ~4 frames)
    tgt.hold(t)
    pose.hold(t)
    pitch.hold(t)
    for n, k in enumerate(order):
        pc, pax = lying[n]
        above = add(pc, (0.0, 0.0, 45.0))
        grasp_pt = add(pc, (0.0, 0.0, 1.5))
        # reach to above the peg, open the hand
        t1 = t + _jit(rng, 0.55) / sp
        tgt.to(t1, above)
        pose.to(t1, pose_vector("open"))
        pitch.to(t1, (48.0,))
        # descend and pinch
        t2 = t1 + _jit(rng, 0.25) / sp
        tgt.to(t2, grasp_pt)
        t3 = t2 + _jit(rng, 0.2) / sp
        tgt.hold(t3)
        pose.to(t3, pose_vector("pinch"))
        pitch.hold(t3)
        t_lift = t3
        # the peg turns upright as it rises; carried pinched near its top
        t4 = t3 + _jit(rng, 0.3) / sp
        lift_pt = add(pc, (0.0, 0.0, 55.0))
        tgt.to(t4, lift_pt)
        pose.hold(t4)
        pitch.to(t4, (38.0,))
        hole = holes[k]
        over = add(hole, (0.0, 0.0, 26.0 + PEG_LEN_MM + 8.0))
        t5 = t4 + _jit(rng, 0.75) / sp
        tgt.to(t5, over)
        pose.hold(t5)
        pitch.hold(t5)
        seat_pt = add(hole, (0.0, 0.0, PEG_LEN_MM - 7.0))  # pinch 7 mm below the peg top
        t6 = t5 + _jit(rng, 0.3) / sp
        tgt.to(t6, seat_pt)
        pose.hold(t6)
        pitch.hold(t6)
        t_seat = t6
        # release, then the hand withdraws up and back towards the patient
        t7 = t6 + _jit(rng, 0.18) / sp
        tgt.hold(t7)
        pose.to(t7, pose_vector("open"))
        pitch.hold(t7)
        back = add(seat_pt, (side * 25.0, -70.0, 60.0))
        t8 = t7 + _jit(rng, 0.35) / sp
        tgt.to(t8, back)
        pose.to(t8, pose_vector("rest"))
        pitch.to(t8, (30.0,))
        # peg track: in the dish until the lift, upright in the hand, then seated
        ptr = objs[f"peg{n}"]
        ptr.hold(t_lift)
        up = (0.0, 0.0, 1.0)
        carry_off = (0.0, 0.0, -(PEG_LEN_MM / 2 - 7.0))  # peg centre below the pinch point
        ptr.to(t4, add(lift_pt, carry_off) + up)
        ptr.to(t5, add(over, carry_off) + up)
        ptr.to(t6, add(hole, (0.0, 0.0, PEG_LEN_MM / 2)) + up)
        reps.append({"rep": n + 1, "hole": k, "t_start": round(t_lift, 4), "t_end": round(t_seat, 4), "peg": n})
        t = t8
    t_end = t + 1.5
    tgt.to(t_end - 0.8, rest)
    pose.to(t_end - 0.8, pose_vector("rest"))
    pitch.to(t_end - 0.8, (30.0,))
    tgt.hold(t_end)
    pose.hold(t_end)
    pitch.hold(t_end)
    s = Script(cond, sheet, t_end, tgt, pose, pitch, objs, reps)
    s.extra = {"order": order, "dish": list(dish), "shoulder": list(shoulder), "lying": [[list(c), list(a)] for c, a in lying]}
    return s


def cup_radius_at(z: float) -> float:
    return CUP_BASE_D_MM / 2 + (CUP_TOP_D_MM - CUP_BASE_D_MM) / 2 * min(1.0, max(0.0, z / CUP_H_MM))


def cup_script(cond: Condition, sheet: SheetGeom, phases: tuple[str, ...] = ("slow", "slow", "fast", "fast")) -> Script:
    """Waiter – cup: the cup starts on dot 1; arcs 1->5->1 (8 moves each), 2 slow then 2 fast.
    Per move: reach, grip, lift, carry, set down, let go, withdraw ~100 mm. Labels per move:
    t_start = the cup leaves its dot, t_end = it touches down on the next one."""
    rng = random.Random(cond.seed)
    sp = cond.speed
    side = 1 if cond.side == "right" else -1
    shoulder = shoulder_point(cond, sheet)
    dots = [sheet_to_world(x, y, 0.0) for x, y in sheet.targets]
    grip_z = CUP_GRIP_Z_MM
    gl = grip_point_local(cup_radius_at(grip_z))

    def grip_at(d: Vec) -> Vec:
        return add(d, (0.0, 0.0, grip_z))

    def withdrawn(d: Vec) -> Vec:
        return add(d, (side * 30.0, -105.0, grip_z + 45.0))

    rest = add(sheet_to_world(sheet.width_mm / 2 + side * 80.0, sheet.height_mm + 90.0), (0.0, 0.0, 90.0))
    tgt = Track(0.0, rest)
    pose = Track(0.0, pose_vector("rest"))
    pitch = Track(0.0, (10.0,))
    cup = Track(0.0, dots[ARC[0]] + (0.0, 0.0, 1.0))
    t = 0.8
    for tr in (tgt, pose, pitch, cup):
        tr.hold(t)
    reps = []
    for arc_i, phase in enumerate(phases, start=1):
        fast = phase == "fast"
        for a, b in zip(ARC[:-1], ARC[1:], strict=True):
            src, dst = dots[a], dots[b]
            # reach to the cup, hand open
            t1 = t + _jit(rng, 0.32 if fast else 0.45) / sp
            tgt.to(t1, add(withdrawn(src), (0.0, 25.0, -25.0)))
            pose.to(t1, pose_vector("open"))
            t2 = t1 + _jit(rng, 0.22 if fast else 0.3) / sp
            tgt.to(t2, grip_at(src))
            pose.to(t2, pose_vector("grip"))
            t3 = t2 + _jit(rng, 0.1 if fast else 0.15) / sp
            for tr in (tgt, pose, pitch):
                tr.hold(t3)
            cup.hold(t3)
            t_lift = t3
            # lift, carry along the arc, set down (transport time is what a reach measures)
            transport = _jit(rng, 0.65 if fast else 1.25, 0.12) / sp
            h_lift = 35.0 if fast else 45.0
            t4 = t3 + transport * 0.25
            t5 = t3 + transport * 0.75
            t6 = t3 + transport
            for tt, p in ((t4, add(src, (0.0, 0.0, h_lift * 0.8))), (t5, add(dst, (0.0, 0.0, h_lift * 0.8))), (t6, dst)):
                tgt.to(tt, grip_at(p))
                cup.to(tt, add(p, (0.0, 0.0, 0.0)) + (0.0, 0.0, 1.0))
            for tr in (pose, pitch):
                tr.hold(t6)
            t_set = t6
            # let go and withdraw
            t7 = t6 + _jit(rng, 0.12 if fast else 0.2) / sp
            tgt.hold(t7)
            pose.to(t7, pose_vector("open"))
            pitch.hold(t7)
            cup.hold(t7)
            t8 = t7 + _jit(rng, 0.3 if fast else 0.4) / sp
            tgt.to(t8, withdrawn(dst))
            pose.to(t8, pose_vector("rest"))
            pitch.hold(t8)
            t9 = t8 + _jit(rng, 0.25 if fast else 0.35) / sp
            for tr in (tgt, pose, pitch):
                tr.hold(t9)
            cup.hold(t9)
            reps.append({"rep": len(reps) + 1, "from_dot": a, "to_dot": b, "t_start": round(t_lift, 4), "t_end": round(t_set, 4),
                         "arc": arc_i, "phase": phase})
            t = t9
    t_end = t + 1.2
    for tr in (tgt, pose, pitch, cup):
        tr.hold(t_end)
    s = Script(cond, sheet, t_end, tgt, pose, pitch, {"cup": cup}, reps)
    s.extra = {"grip_local": list(gl), "shoulder": list(shoulder), "phases": list(phases)}
    return s


def build_script(cond: Condition, sheet: SheetGeom) -> Script:
    return nhpt_script(cond, sheet) if cond.exercise == "nhpt" else cup_script(cond, sheet)


def frames(script: Script) -> list[dict[str, Any]]:
    """Per-frame scene state for the renderer (world mm)."""
    c = script.cond
    side = 1 if c.side == "right" else -1
    shoulder = tuple(script.extra["shoulder"])
    grip = c.exercise == "cup"
    gl = tuple(script.extra["grip_local"]) if grip else None
    n = int(math.floor(script.duration_s * c.fps)) + 1
    out = []
    for i in range(n):
        t = i / c.fps
        target = script.hand_target.at(t)
        h = solve_hand(target, script.hand_pose.at(t), script.hand_pitch.at(t)[0], side, shoulder, grip, gl)
        objs = {k: list(tr.at(t)) for k, tr in script.objects.items()}
        out.append({"i": i, "t": round(t, 4), "hand": hand_primitives(h, c.sleeve), "objects": objs})
    return out


# ---- labels -------------------------------------------------------------------------------
def marker_loss_spans(visible_counts: list[int], fps: float, hold_s: float = MARKER_HOLD_S) -> list[tuple[float, float]]:
    """Time spans in which the product cannot hold its calibration: fewer than 3 markers fully
    visible for longer than `hold_s` (calibration.HOLD_S). Returned as (t_lost, t_back)."""
    spans = []
    start = None
    for i, n in enumerate(list(visible_counts) + [4]):
        if n < 3 and start is None:
            start = i
        elif n >= 3 and start is not None:
            if (i - start) / fps > hold_s:
                spans.append((start / fps + hold_s, i / fps))
            start = None
    return spans


def labels(script: Script, visible_counts: list[int] | None = None) -> dict[str, Any]:
    """praxis.labels/1 (evaluation/labels.schema.json) for one rendered clip. A rep is expected
    `unverified` (reason marker_lost) only when the ray-cast marker visibility says the product
    had fewer than 3 markers for longer than its 1.5 s hold during that rep; otherwise every rep
    is a correct, real rep and expected `verified`."""
    c = script.cond
    spans = marker_loss_spans(visible_counts, c.fps) if visible_counts is not None else []
    reps = []
    for r in script.reps:
        lost = any(a <= r["t_end"] + 0.5 and b >= r["t_start"] for a, b in spans)
        row: dict[str, Any] = {"rep": r["rep"], "t_start": r["t_start"], "t_end": r["t_end"],
                               "expected": "unverified" if lost else "verified", "reason": "marker_lost" if lost else None,
                               "deliberate_error": None}
        if c.exercise == "nhpt":
            row["hole"] = r["hole"]
        else:
            row["to_dot"] = r["to_dot"]
        reps.append(row)
    doc: dict[str, Any] = {
        "schema": "praxis.labels/1", "clip_id": c.id, "exercise": c.exercise, "labeller": "render",
        "labelled_at": "generated", "fps": c.fps, "complete": True,
        "notes": "Synthetic 3-D render (evaluation/blender); times from the script, not a human labeller.",
        "reps": reps,
    }
    if c.exercise == "nhpt":
        t0, t1 = script.reps[0]["t_start"], script.reps[-1]["t_end"]
        doc["nhpt"] = {"t_start": t0, "t_end": t1, "total_s": round(t1 - t0, 4)}
    return doc


def truth(script: Script, visible_counts: list[int] | None = None) -> dict[str, Any]:
    """Everything the scorer needs beyond praxis.labels/1: condition, per-peg splits, per-reach
    phase and the marker-visibility summary."""
    c = script.cond
    doc: dict[str, Any] = {"schema": "praxis.truth3d/1", "clip_id": c.id, "condition": c.to_dict(), "duration_s": round(script.duration_s, 3),
                           "frames": int(math.floor(script.duration_s * c.fps)) + 1}
    if c.exercise == "nhpt":
        prev = script.reps[0]["t_start"]
        splits = []
        for r in script.reps:
            splits.append(round(r["t_end"] - prev, 4))
            prev = r["t_end"]
        doc["splits_s"] = splits
        doc["order"] = script.extra["order"]
    else:
        doc["reaches"] = [{k: r[k] for k in ("rep", "from_dot", "to_dot", "arc", "phase")} | {"reach_ms": round((r["t_end"] - r["t_start"]) * 1000, 1)}
                          for r in script.reps]
    if visible_counts is not None:
        doc["markers_visible_min"] = min(visible_counts)
        doc["frames_below_4_markers"] = sum(1 for v in visible_counts if v < 4)
        doc["frames_below_3_markers"] = sum(1 for v in visible_counts if v < 3)
        doc["marker_loss_spans"] = [list(s) for s in marker_loss_spans(visible_counts, c.fps)]
    return doc


def job(script: Script, sheet_png: str, out_dir: str) -> dict[str, Any]:
    """The JSON handed to render_tasks.py."""
    c = script.cond
    aim = script.sheet.targets_centre if c.exercise == "nhpt" else (script.sheet.width_mm / 2, script.sheet.height_mm / 2)
    return {
        "condition": c.to_dict(),
        "sheet": asdict(script.sheet),
        "sheet_png": sheet_png,
        "out_dir": out_dir,
        "camera": camera_pose(c, aim),
        "fps": c.fps,
        "peg": {"length": PEG_LEN_MM, "diameter": c.peg_d_mm, "colour": PEG_COLOURS[c.peg_colour]},
        "board": {"thickness": c.board_mm, "size": BOARD_SIZE_MM, "hole_d": HOLE_D_MM, "centre": list(sheet_to_world(*script.sheet.targets_centre))},
        "dish": {"centre": script.extra.get("dish"), "radius": DISH_R_MM, "floor": DISH_FLOOR_MM},
        "cup": {"base_d": CUP_BASE_D_MM, "top_d": CUP_TOP_D_MM, "height": CUP_H_MM, "band": CUP_BAND_MM,
                "colour": CUP_COLOURS[c.cup_colour], "band_colour": BAND_BLUE},
        "skin": SKIN[c.skin],
        "frames": frames(script),
    }


if __name__ == "__main__":  # quick look: python scenario.py
    for cnd in default_conditions():
        print(json.dumps(cnd.to_dict()))
