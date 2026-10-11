"""Robustness sweep of the sheet perception on synthetic renders (OpenCV cv2.__version__ == 5.0.0).

    cd services/session
    uv run python ../../evaluation/scripts/robustness.py            # full sweep -> results/robustness_v0.{md,json}
    uv run python ../../evaluation/scripts/robustness.py --only tilt,jpeg --out /tmp/rb

**Synthetic renders, not real-camera evidence.** Every frame is drawn by
`praxis_session.perception.synth` (a pinhole projection of the canonical sheet from
`perception.render`, flat discs for pegs / cup base / hand) and then perturbed in image space
(light, colour cast, shadows, noise, blur, JPEG, occlusion, clutter, paper curl, print clipping,
mirroring, aspect squash). What is measured is the REAL product code on those frames:

  - `calibration.Calibrator` (cv2.aruco.ArucoDetector -> cv2.findHomography -> cv2.solvePnP):
    first fix (fresh calibrator: all four markers needed) and running session (calibrator primed
    with a clean frame 0.1 s earlier: three markers -> partial, fewer -> held);
  - `quality` rows exactly as `quality.build_checks` builds them for screen 05 (lighting,
    task area, markers, camera angle; steadiness is a single frame here so it always passes);
  - NHPT: `board.BoardState` on an empty board first (Hough holes + per-hole templates, as in a
    session), then occupancy and free pegs with pegs seated in holes 0, 4, 8 and one free peg;
  - Waiter - cup: `cup.CupSheetState.cup_mm` with the cup base on dot 2 (and no-cup negatives).

Writes results/robustness_v0.{json,md}. Deterministic (fixed seeds).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import numpy as np

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "services" / "session"))
import cv2  # noqa: E402

from praxis_session.perception.board import BoardState  # noqa: E402
from praxis_session.perception.board_spec import CUP_TARGETS, NHPT_BOARD, SheetSpec  # noqa: E402
from praxis_session.perception.calibration import Calibrator  # noqa: E402
from praxis_session.perception.cup import CupSheetState  # noqa: E402
from praxis_session.perception.quality import (  # noqa: E402
    MAX_TILT_DEG,
    MIN_PX_PER_MM,
    build_checks,
    lighting,
    task_area_in_view,
)
from praxis_session.perception.synth import (  # noqa: E402
    CANON_PX_PER_MM,
    SKIN_BGR,
    camera_frame,
    scene_canonical,
    view_camera,
    view_homography,
)

SIZE = (640, 480)
LETTER_MM = (215.9, 279.4)
PRINTER_MARGIN_MM = 6.35  # a common non-printable margin (0.25 in)
TABLE_BGR = (90, 90, 90)

# Laptop baseline (10 Oct product decision: built-in camera, screen tilted forward ~40-50°).
# The browser encodes frames with canvas.toBlob('image/jpeg', 0.7) (web/src/session/
# useWebcamStream.ts), so every condition goes through JPEG q70 unless it sweeps JPEG itself.
BASE: dict[str, Any] = {
    "tilt": 40.0, "yaw": 5.0, "roll": 0.0, "scale": 1.0, "focal": 1.4, "noise": 3.0, "jpeg": 70,
}

# Scene ground truth.
SEATED = (0, 4, 8)
FREE_PEG_MM = (160.0, 192.0)
CUP_DOT = 2
SKIN_TONES: dict[str, tuple[int, int, int]] = {  # BGR
    "light": SKIN_BGR,
    "medium": (80, 120, 175),
    "dark": (55, 75, 120),
    "deep": (35, 45, 75),
}
PEG_COLOURS: dict[str, tuple[int, int, int]] = {
    "red": (40, 40, 220),
    "blue": (200, 80, 30),
    "green": (60, 170, 40),
    "yellow": (30, 210, 230),
    "wood/beige": (60, 110, 160),
    "black": (30, 30, 30),
}
CUP_COLOURS: dict[str, tuple[int, int, int]] = {
    "blue": (200, 90, 30),
    "red": (40, 40, 210),
    "green": (60, 160, 40),
    "yellow": (30, 200, 230),
    "orange": (20, 120, 240),
    "black": (30, 30, 30),
}


# ---- scene ----------------------------------------------------------------------------------
def hand_blobs(cx: float, cy: float, angle_deg: float = -120.0, palm_r: float = 28.0) -> list[tuple[float, float, float]]:
    """A flat hand silhouette in sheet mm: a palm disc and four fingers + thumb as disc chains."""
    out = [(cx, cy, palm_r)]
    a0 = math.radians(angle_deg)
    for k, (spread, length) in enumerate(((-0.45, 55), (-0.15, 65), (0.15, 62), (0.42, 50))):
        a = a0 + spread
        for s in np.linspace(palm_r * 0.8, palm_r + length, 7):
            out.append((cx + s * math.cos(a), cy + s * math.sin(a), 7.5 - 0.3 * k))
    a = a0 + 1.4
    for s in np.linspace(palm_r * 0.7, palm_r + 35, 5):
        out.append((cx + s * math.cos(a), cy + s * math.sin(a), 8.0))
    return out


def finger_bars(n: int, width_mm: float, spacing_mm: float, x0_mm: float, angle_deg: float = 80.0) -> list[tuple[float, float, float]]:
    """n straight fingers (disc chains) crossing the cup on dot 2."""
    a = math.radians(angle_deg)
    cy = CUP_TARGETS.targets_mm[CUP_DOT][1]
    return [
        (x0_mm + k * spacing_mm + s * math.cos(a), cy + s * math.sin(a), width_mm / 2)
        for k in range(n)
        for s in np.linspace(-45, 45, 19)
    ]


@dataclass
class Condition:
    name: str
    group: str
    render: dict[str, Any] = field(default_factory=dict)  # overrides of BASE / scene options
    photometric: list[Callable[[np.ndarray, np.random.Generator], np.ndarray]] = field(default_factory=list)
    expect_rows: dict[str, str] = field(default_factory=dict)  # row id -> keyword its hint must contain
    note: str = ""
    sheets: tuple[str, ...] = ("nhpt", "cup")


# ---- photometric perturbations ----------------------------------------------------------------
def to_mean_luma(target: float):
    def f(img, _rng):
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).mean()
        return np.clip(img.astype(np.float32) * (target / max(g, 1.0)), 0, 255).astype(np.uint8)
    return f


def gain(k: float):
    return lambda img, _rng: np.clip(img.astype(np.float32) * k, 0, 255).astype(np.uint8)


def white_balance(b: float, g: float, r: float):
    return lambda img, _rng: np.clip(img.astype(np.float32) * np.array([b, g, r], np.float32), 0, 255).astype(np.uint8)


def soft_shadow(lo: float):
    def f(img, _rng):
        h, w = img.shape[:2]
        ramp = np.linspace(1.0, lo, w, dtype=np.float32)[None, :, None]
        return np.clip(img.astype(np.float32) * ramp, 0, 255).astype(np.uint8)
    return f


def hard_shadow(k: float):
    def f(img, _rng):
        h, w = img.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        m = (xx + 0.6 * yy) > 0.55 * w + 0.3 * h  # a diagonal edge across the sheet
        out = img.astype(np.float32)
        out[m] *= k
        return np.clip(out, 0, 255).astype(np.uint8)
    return f


def motion_blur(n: int):
    k = np.zeros((n, n), np.float32)
    k[n // 2, :] = 1.0 / n
    return lambda img, _rng: cv2.filter2D(img, -1, k)


def defocus(r: int):
    k = np.zeros((2 * r + 1, 2 * r + 1), np.float32)
    cv2.circle(k, (r, r), r, 1.0, -1)
    k /= k.sum()
    return lambda img, _rng: cv2.filter2D(img, -1, k)


def mirror():
    return lambda img, _rng: cv2.flip(img, 1)


# ---- rendering --------------------------------------------------------------------------------
def wood_texture(size: tuple[int, int], rng: np.random.Generator) -> np.ndarray:
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    grain = np.sin(xx * 0.09 + 6 * np.sin(yy * 0.013) + rng.uniform(0, 6)) * 0.5 + 0.5
    fine = rng.normal(0, 0.06, (h, w)).astype(np.float32)
    t = np.clip(0.55 + 0.3 * grain + fine, 0, 1)[..., None]
    dark, light = np.array([35, 70, 110], np.float32), np.array([75, 130, 185], np.float32)
    return (dark + (light - dark) * t).astype(np.uint8)


def sheet_mask(H_mm_px: np.ndarray, spec: SheetSpec, size: tuple[int, int], rect_mm=None) -> np.ndarray:
    x0, y0, x1, y1 = rect_mm or (0.0, 0.0, spec.width_mm, spec.height_mm)
    poly = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float32).reshape(-1, 1, 2)
    px = cv2.perspectiveTransform(poly, H_mm_px).reshape(-1, 2)
    m = np.zeros((size[1], size[0]), np.uint8)
    cv2.fillPoly(m, [np.round(px).astype(np.int32)], 255, cv2.LINE_AA)
    return m


def clutter(img: np.ndarray, H_mm_px: np.ndarray, spec: SheetSpec, rng: np.random.Generator, on_sheet: bool) -> np.ndarray:
    """Random saturated objects (pens, a phone, a mug, a tissue box) around the sheet; with
    `on_sheet` a blue and a red pen also lie on the sheet margin, away from the targets."""
    out = img.copy()
    inside = sheet_mask(H_mm_px, spec, (img.shape[1], img.shape[0])) > 0
    colours = [(200, 80, 30), (40, 40, 210), (40, 170, 60), (30, 200, 230), (180, 60, 160), (20, 120, 240), (30, 30, 30)]
    h, w = img.shape[:2]
    placed = 0
    while placed < 9:
        c = colours[placed % len(colours)]
        x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
        rw, rh = int(rng.integers(12, 60)), int(rng.integers(8, 40))
        m = np.zeros((h, w), np.uint8)
        if placed % 2:
            cv2.ellipse(m, (x, y), (rw, rh), float(rng.uniform(0, 180)), 0, 360, 255, -1)
        else:
            cv2.rectangle(m, (x - rw, y - rh), (x + rw, y + rh), 255, -1)
        if np.any((m > 0) & inside):
            continue  # around the sheet, not on it
        out[m > 0] = c
        placed += 1
    if on_sheet:
        # pens on the sheet margin (sheet mm), away from markers and targets
        if spec is NHPT_BOARD:
            pens = [((60.0, 90.0), (150.0, 92.0), (200, 80, 30)), ((185.0, 110.0), (187.0, 200.0), (40, 40, 210))]
        else:
            pens = [((90.0, 175.0), (210.0, 180.0), (200, 80, 30)), ((110.0, 30.0), (190.0, 28.0), (40, 40, 210))]
        for a, b, col in pens:
            pa = cv2.perspectiveTransform(np.array([[a]], np.float32), H_mm_px)[0, 0]
            pb = cv2.perspectiveTransform(np.array([[b]], np.float32), H_mm_px)[0, 0]
            thick = max(2, int(round(9.0 * float(np.linalg.norm(pb - pa)) / float(np.linalg.norm(np.subtract(b, a))))))
            cv2.line(out, tuple(np.round(pa).astype(int)), tuple(np.round(pb).astype(int)), col, thick, cv2.LINE_AA)
    return out


def curled_frame(spec: SheetSpec, canon_bgr: np.ndarray, r: dict[str, Any], size, z_of_u: Callable[[np.ndarray], np.ndarray]) -> np.ndarray:
    """Render a non-flat sheet: strips along the long axis, each at its own height z(u)."""
    P = view_camera(spec, size, r["tilt"], r["yaw"], r["scale"], r["roll"], r["focal"])
    long_y = spec.height_mm >= spec.width_mm
    L = spec.height_mm if long_y else spec.width_mm
    n = 90
    frame = np.full((size[1], size[0], 3), TABLE_BGR, np.uint8)
    us = np.linspace(0.0, L, n + 1)
    zs = z_of_u(us / L)
    for k in range(n):
        u0, u1, z0, z1 = us[k], us[k + 1] + (0.6 if k < n - 1 else 0.0), zs[k], zs[k + 1]
        if long_y:
            obj = [(0, u0, z0), (spec.width_mm, u0, z0), (spec.width_mm, u1, z1), (0, u1, z1)]
        else:
            obj = [(u0, 0, z0), (u1, 0, z1), (u1, spec.height_mm, z1), (u0, spec.height_mm, z0)]
        X = np.array([[x, y, z, 1.0] for x, y, z in obj]).T
        p = P @ X
        dst = (p[:2] / p[2]).T.astype(np.float32)
        src = np.array([(x * CANON_PX_PER_MM, y * CANON_PX_PER_MM) for x, y, _ in obj], np.float32)
        Hs = cv2.getPerspectiveTransform(src, dst)
        strip = cv2.warpPerspective(canon_bgr, Hs, size)
        m = np.zeros((size[1], size[0]), np.uint8)
        cv2.fillConvexPoly(m, np.round(dst).astype(np.int32), 255)
        frame[m > 0] = strip[m > 0]
    return frame


def render(spec: SheetSpec, cond: Condition, scene: dict[str, Any], seed: int) -> tuple[np.ndarray, np.ndarray]:
    """(frame, H_true mm->px) for one condition and one scene (pegs / cup / hand)."""
    r = {**BASE, **cond.render}
    rng = np.random.default_rng(seed)
    size = tuple(r.get("size", SIZE))
    kw = dict(
        tilt_deg=r["tilt"], yaw_deg=r["yaw"], scale=r["scale"], roll_deg=r["roll"],
        focal_per_width=r["focal"], border_bgr=TABLE_BGR, size=size, hide_marker=None,
        **scene,
    )
    if "curl" in r:
        canon = scene_canonical(spec, **{k: v for k, v in scene.items()})
        frame = curled_frame(spec, canon, r, size, r["curl"])
        H = view_homography(spec, size, r["tilt"], r["yaw"], r["scale"], r["roll"], r["focal"])
    else:
        frame, H = camera_frame(spec, **kw)
    if r.get("background") == "wood":
        bg = wood_texture(size, rng)
        m = sheet_mask(H, spec, size) > 0
        bg[m] = frame[m]
        frame = bg
    if r.get("clutter"):
        frame = clutter(frame, H, spec, rng, on_sheet=r["clutter"] == "on_sheet")
    if "print" in r:
        frame = print_clip(frame, H, spec, r["print"], size)
    for f in cond.photometric:
        frame = f(frame, rng)
    if r["noise"] > 0:
        frame = np.clip(frame.astype(np.float32) + rng.normal(0, r["noise"], frame.shape), 0, 255).astype(np.uint8)
    if r.get("squash_to"):
        frame = cv2.resize(frame, tuple(r["squash_to"]), interpolation=cv2.INTER_AREA)
        sx, sy = r["squash_to"][0] / size[0], r["squash_to"][1] / size[1]
        H = np.diag([sx, sy, 1.0]) @ H
    if r.get("mirror"):
        frame = cv2.flip(frame, 1)
        H = np.array([[-1, 0, frame.shape[1] - 1], [0, 1, 0], [0, 0, 1]], np.float64) @ H
    if r["jpeg"]:
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, int(r["jpeg"])])
        frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return frame, H


def print_clip(frame: np.ndarray, H: np.ndarray, spec: SheetSpec, how: str, size) -> np.ndarray:
    """The A4 artwork printed at 100 % on US Letter: what falls off the paper becomes table, and
    the printer leaves its non-printable margin white. `how`: top | bottom | centre (alignment of
    the A4 page on the Letter sheet, which depends on the PDF viewer and driver)."""
    portrait = spec.height_mm >= spec.width_mm
    long_a4 = spec.height_mm if portrait else spec.width_mm
    long_letter = LETTER_MM[1]
    cut = long_a4 - long_letter
    lo = {"top": 0.0, "bottom": cut, "centre": cut / 2}[how]  # A4 coordinate of the paper's start
    hi = lo + long_letter
    out = frame.copy()

    def band(a: float, b: float, colour) -> None:
        if b <= a:
            return
        rect = (0.0, a, spec.width_mm, b) if portrait else (a, 0.0, b, spec.height_mm)
        m = sheet_mask(H, spec, size, rect) > 0
        out[m] = colour

    band(0.0, lo, TABLE_BGR)
    band(hi, long_a4, TABLE_BGR)
    band(max(0.0, lo), lo + PRINTER_MARGIN_MM, (255, 255, 255))
    band(hi - PRINTER_MARGIN_MM, min(hi, long_a4), (255, 255, 255))
    return out


# ---- measurement ------------------------------------------------------------------------------
def true_px_per_mm(H: np.ndarray, spec: SheetSpec) -> float:
    cx, cy = spec.centre_mm
    p = cv2.perspectiveTransform(np.array([[[cx, cy]], [[cx + 10, cy]], [[cx, cy + 10]]], np.float32), H).reshape(-1, 2)
    return float((np.linalg.norm(p[1] - p[0]) + np.linalg.norm(p[2] - p[0])) / 20.0)


def true_tilt(r: dict[str, Any]) -> float:
    t, y = math.radians(r["tilt"]), math.radians(r["yaw"])
    return math.degrees(math.acos(abs(math.cos(t) * math.cos(y))))


def calib_block(spec: SheetSpec, frame: np.ndarray, H_true: np.ndarray, clean: np.ndarray) -> tuple[dict[str, Any], Any]:
    cal = Calibrator(spec).run(frame, 0.0)
    out: dict[str, Any] = {
        "calibrated": bool(cal.calibrated),
        "markers_found": sorted(int(k) for k in cal.marker_corners_px),
        "rms_mm": None if cal.rms_mm is None else round(float(cal.rms_mm), 3),
        "tilt_deg": None if cal.tilt_deg is None else round(float(cal.tilt_deg), 1),
        "target_err_mm": None,
    }
    if cal.calibrated:
        t_px = cv2.perspectiveTransform(np.array(spec.targets_mm, np.float32).reshape(-1, 1, 2), H_true).reshape(-1, 2)
        err = np.linalg.norm(cal.to_mm(t_px) - np.array(spec.targets_mm, np.float32), axis=1)
        out["target_err_mm"] = round(float(err.max()), 2)
    # Running session: primed with the clean view 0.1 s earlier.
    sess = Calibrator(spec)
    sess.run(clean, 0.0)
    s = sess.run(frame, 0.1)
    out["session_source"] = s.source if s.calibrated else None
    return out, cal


def expected_rows(spec: SheetSpec, H_true: np.ndarray, cond: Condition) -> dict[str, str]:
    """The rows that SHOULD fire: the condition's own (light, markers) plus the geometric ones
    derived from the true view - the angle row above MAX_TILT_DEG, the task-area row when the
    true scale is under MIN_PX_PER_MM ("closer") or a target is outside the frame ("back")."""
    exp = dict(cond.expect_rows)
    r = {**BASE, **cond.render}
    if true_tilt(r) > MAX_TILT_DEG and not r.get("squash_to"):
        exp.setdefault("angle", "tilt")
    w, h = r.get("squash_to") or r.get("size", SIZE)
    t = cv2.perspectiveTransform(np.array(spec.targets_mm, np.float32).reshape(-1, 1, 2), H_true).reshape(-1, 2)
    if np.any((t < 16) | (t > np.array([w - 16, h - 16]))):
        exp.setdefault("task_area", "back")
    elif true_px_per_mm(H_true, spec) < MIN_PX_PER_MM:
        exp.setdefault("task_area", "closer")
    return exp


def rows_block(spec: SheetSpec, frame: np.ndarray, cal, cond: Condition, H_true: np.ndarray) -> dict[str, Any]:
    light = lighting(frame)
    area = task_area_in_view(cal, spec, frame.shape)
    rows = build_checks(cal, light, {"jitter_px": 0.0, "ok": True}, area, {"present": None}, spec=spec)
    fired = {r["id"]: r["hint"] for r in rows if r["status"] == "check"}
    if "markers" in fired and not cal.calibrated:
        fired.pop("task_area", None)  # "Show all four corner markers first." follows from the markers row
    exp = expected_rows(spec, H_true, cond)
    if "markers" in exp and "markers" in fired:
        exp.pop("task_area", None)  # judged only once the sheet is found
        exp.pop("angle", None)
    ok = set(fired) == set(exp) and all(kw.lower() in (fired.get(rid) or "").lower() for rid, kw in exp.items())
    return {
        "rows_fired": fired,
        "rows_expected": sorted(exp),
        "hint_ok": ok,
        "mean_luma": light["mean_luma"],
        "sharpness": light["sharpness"],
        "px_per_mm": area.get("px_per_mm"),
    }


def nhpt_block(cond: Condition, seed: int, clean: np.ndarray) -> dict[str, Any]:
    spec = NHPT_BOARD
    r = {**BASE, **cond.render}
    peg_bgr = r.get("peg_bgr", PEG_COLOURS["red"])
    hand = r.get("hand_nhpt")
    skin = r.get("skin_bgr", SKIN_BGR)
    empty, _ = render(spec, cond, {}, seed)
    pegs = [spec.targets_mm[k] for k in SEATED] + [FREE_PEG_MM]
    scene = {"pegs_mm": pegs, "peg_bgr": peg_bgr}
    if hand:
        scene |= {"skin_blobs_mm": hand, "skin_bgr": skin}
    frame, H = render(spec, cond, scene, seed + 1)
    cal_d, cal = calib_block(spec, frame, H, clean)
    out: dict[str, Any] = {"sheet": "nhpt", **cal_d, **rows_block(spec, frame, cal, cond, H)}
    cal_e = Calibrator(spec).run(empty, 0.0)
    if not (cal.calibrated and cal_e.calibrated):
        out |= {"holes": None, "occupancy_ok": None, "free_pegs": None}
        return out
    board = BoardState(spec)
    board.detect_holes(board.warp(empty, cal_e))
    hidden = covered_holes(hand) if hand else set()
    canon = board.warp(frame, cal)
    if r.get("sample_pegs"):
        board.sample_peg_colour(canon, spec.targets_mm[4])
    occ = board.occupancy(canon)
    truth = {k: (k in SEATED) for k in range(9)}
    wrong = [k for k in range(9) if (occ[f"hole_{k}"] == "occupied") != truth[k] and k not in hidden]
    phantom = [k for k in range(9) if occ[f"hole_{k}"] == "occupied" and not truth[k]]
    free = board.free_pegs_mm(canon)
    free_hit = sum(1 for p in free if math.dist(p, FREE_PEG_MM) <= 6.0)
    out |= {
        "holes": board.hole_source,
        "occupancy_ok": not wrong,
        "occupancy_wrong": wrong,
        "phantom_holes": phantom,
        "free_pegs": len(free),
        "free_peg_found": free_hit == 1,
        "phantom_free": len(free) - free_hit,
        "colour": "sampled" if board.colour_range else "default",
    }
    return out


def covered_holes(hand) -> set[int]:
    out = set()
    for k, (x, y) in enumerate(NHPT_BOARD.targets_mm):
        if any(math.dist((x, y), (bx, by)) <= br + 4.0 for bx, by, br in hand):
            out.add(k)
    return out


def cup_block(cond: Condition, seed: int, clean: np.ndarray) -> dict[str, Any]:
    spec = CUP_TARGETS
    r = {**BASE, **cond.render}
    dot = spec.targets_mm[CUP_DOT]
    scene: dict[str, Any] = {} if r.get("no_cup") else {"cup_mm": dot, "cup_bgr": r.get("cup_bgr", CUP_COLOURS["blue"])}
    if r.get("hand_cup"):
        scene |= {"skin_blobs_mm": r["hand_cup"], "skin_bgr": r.get("skin_bgr", SKIN_BGR)}
    frame, H = render(spec, cond, scene, seed + 2)
    cal_d, cal = calib_block(spec, frame, H, clean)
    out: dict[str, Any] = {"sheet": "cup", **cal_d, **rows_block(spec, frame, cal, cond, H)}
    if not cal.calibrated:
        out |= {"cup_found": None, "cup_err_mm": None}
        return out
    sheet = CupSheetState(spec)
    canon = sheet.warp(frame, cal)
    if r.get("sample_cup"):
        sheet.sample_cup_colour(canon, dot)
    got = sheet.cup_mm(canon)
    expect = not r.get("no_cup")
    out |= {
        "cup_expected": expect,
        "cup_found": got is not None,
        "cup_err_mm": None if got is None else round(math.dist(got[:2], dot), 1),
        "cup_ok": (got is not None and math.dist(got[:2], dot) <= 10.0) if expect else got is None,
        "colour": "sampled" if sheet.colour_range else "default",
    }
    return out


# ---- conditions -------------------------------------------------------------------------------
def conditions() -> list[Condition]:
    C: list[Condition] = [Condition("baseline (tilt 40°, JPEG q70, σ3)", "baseline")]
    for t in (0, 20, 45, 50, 55, 60, 65):
        C.append(Condition(f"tilt {t}°", "tilt", {"tilt": float(t)}))
    for f in (0.7, 0.9, 1.1, 2.0):
        C.append(Condition(f"lens f={f}·w, tilt 45°", "lens", {"tilt": 45.0, "focal": f},
                           note="laptop cameras are wide (f ≈ 0.7–0.9 w); calibration assumes 1.2 w"))
    for ro in (30, 90, 180, 270):
        C.append(Condition(f"sheet rotated {ro}° in plane", "rotation", {"roll": float(ro)}))
    for fill in (0.3, 0.4, 0.5, 0.6, 1.0):
        sc = fill / 0.8
        C.append(Condition(f"sheet fills {int(fill * 100)}% of frame", "distance", {"scale": sc}))
    for luma in (30, 45, 65):
        C.append(Condition(f"dim, mean luma {luma}", "light", photometric=[to_mean_luma(luma)],
                           expect_rows={"lighting": "dark"} if luma < 60 else {}))
    for k in (1.5, 2.2):
        C.append(Condition(f"bright, gain ×{k}", "light", photometric=[gain(k)], expect_rows={"lighting": "bright"} if k > 2 else {}))
    C.append(Condition("warm tungsten white balance", "colour", photometric=[white_balance(0.55, 0.85, 1.15)]))
    C.append(Condition("cool / daylight-LED white balance", "colour", photometric=[white_balance(1.2, 1.0, 0.75)]))
    C.append(Condition("soft shadow gradient (100%→35%)", "shadow", photometric=[soft_shadow(0.35)]))
    C.append(Condition("hard shadow edge (45%)", "shadow", photometric=[hard_shadow(0.45)]))
    for s in (6, 12, 20):
        C.append(Condition(f"Gaussian noise σ{s}", "noise", {"noise": float(s)}))
    for n in (5, 9, 15):
        C.append(Condition(f"motion blur {n} px", "blur", photometric=[motion_blur(n)]))
    for rr in (2, 3, 5):
        C.append(Condition(f"defocus r{rr}", "blur", photometric=[defocus(rr)]))
    for q in (40, 60, 80, 90):
        C.append(Condition(f"JPEG q{q}", "jpeg", {"jpeg": q}))
    # occlusion (hand over markers): first fix needs all four, a running session tolerates one
    C.append(Condition("hand over marker 2 (one marker)", "occlusion",
                       {"hand_marker": [2]}, expect_rows={"markers": "bottom-right"}))
    C.append(Condition("hand over markers 1+2 (two markers)", "occlusion",
                       {"hand_marker": [1, 2]}, expect_rows={"markers": "bottom-right"}))
    for tone, bgr in SKIN_TONES.items():
        C.append(Condition(f"{tone} skin hand over hole grid", "hand", {"hand_nhpt": hand_blobs(150.0, 135.0, -150.0), "skin_bgr": bgr}, sheets=("nhpt",)))
        C.append(Condition(f"{tone} skin fingers across cup (~55% visible)", "hand", {"hand_cup": finger_bars(2, 12.0, 22.0, 138.0), "skin_bgr": bgr}, sheets=("cup",)))
        C.append(Condition(f"{tone} skin hand gripping cup (~22% visible)", "hand", {"hand_cup": hand_blobs(148.5 + 40.0, 92.5 + 25.0, -150.0, 22.0), "skin_bgr": bgr}, sheets=("cup",),
                           note="physics: most of the base is hidden; the FSM infers the placement from the hand (unverified unless the base is seen resting within 0.6 s)"))
        C.append(Condition(f"{tone} skin hand on sheet, no cup", "hand", {"hand_cup": hand_blobs(148.5, 100.0, -90.0, 24.0), "skin_bgr": bgr, "no_cup": True}, sheets=("cup",)))
    for name, bgr in PEG_COLOURS.items():
        C.append(Condition(f"peg colour {name} (default mask)", "peg colour", {"peg_bgr": bgr}, sheets=("nhpt",)))
        C.append(Condition(f"peg colour {name} (tap-to-sample)", "peg colour", {"peg_bgr": bgr, "sample_pegs": True}, sheets=("nhpt",)))
    for name, bgr in CUP_COLOURS.items():
        C.append(Condition(f"cup band {name} (default blue window)", "cup colour", {"cup_bgr": bgr}, sheets=("cup",)))
        C.append(Condition(f"cup band {name} (tap-to-sample)", "cup colour", {"cup_bgr": bgr, "sample_cup": True}, sheets=("cup",)))
    C.append(Condition("no cup on the sheet", "cup colour", {"no_cup": True}, sheets=("cup",)))
    C.append(Condition("wood-grain table", "background", {"background": "wood"}))
    C.append(Condition("wood table + objects around the sheet", "background", {"background": "wood", "clutter": "around"}))
    C.append(Condition("objects around + blue/red pens on the sheet", "background", {"background": "wood", "clutter": "on_sheet"}))
    C.append(Condition("no cup, pens on the sheet", "background", {"background": "wood", "clutter": "on_sheet", "no_cup": True}, sheets=("cup",)))
    for how in ("centre", "top", "bottom"):
        exp = {} if how == "centre" else {"markers": "corner"}
        C.append(Condition(f"A4 PDF on US Letter, {how}-aligned", "print", {"print": how}, expect_rows=exp))
    for amp in (5, 10, 20):
        C.append(Condition(f"paper curl, ends up {amp} mm", "paper", {"curl": (lambda a: (lambda u: a * (2 * u - 1) ** 2))(float(amp))}))
    for amp in (4, 8):
        C.append(Condition(f"folded crease, ridge {amp} mm", "paper", {"curl": (lambda a: (lambda u: a * (1 - np.abs(2 * u - 1))))(float(amp))}))
    C.append(Condition("mirrored frame", "mirror", {"mirror": True}))
    C.append(Condition("16:9 camera squashed to 640×480", "aspect", {"size": (854, 480), "squash_to": (640, 480), "tilt": 45.0}))
    # combined
    C.append(Condition("laptop: tilt 45, f 0.9 w, fill 60%, warm, σ5, wood + clutter", "combined",
                       {"tilt": 45.0, "focal": 0.9, "scale": 0.75, "noise": 5.0, "background": "wood", "clutter": "around"},
                       photometric=[white_balance(0.6, 0.88, 1.1)]))
    C.append(Condition("dim evening: luma 45, warm, σ8", "combined", {"noise": 8.0},
                       photometric=[white_balance(0.6, 0.88, 1.1), to_mean_luma(45)], expect_rows={"lighting": "dark"}))
    C.append(Condition("desk lamp: hard shadow + gain ×1.5", "combined", photometric=[hard_shadow(0.45), gain(1.5)]))
    C.append(Condition("far + soft focus: fill 45%, defocus r2, σ5", "combined", {"scale": 0.45 / 0.8, "noise": 5.0}, photometric=[defocus(2)]))
    C.append(Condition("sideways sheet, tilt 50, f 0.8 w", "combined", {"roll": 90.0, "tilt": 50.0, "focal": 0.8}))
    return C


def apply_marker_hands(cond: Condition, spec: SheetSpec) -> Condition:
    ids = cond.render.get("hand_marker")
    if not ids:
        return cond
    blobs: list[tuple[float, float, float]] = []
    for i in ids:
        cx, cy = spec.marker_centres_mm[i]
        blobs += hand_blobs(cx, cy, -135.0 if cx > spec.width_mm / 2 else -45.0, 30.0)
    key = "hand_nhpt" if spec is NHPT_BOARD else "hand_cup"
    return Condition(cond.name, cond.group, {**cond.render, key: blobs}, cond.photometric, cond.expect_rows, cond.note, cond.sheets)


def run(only: set[str] | None = None) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    clean = {
        "nhpt": render(NHPT_BOARD, Condition("clean", "x"), {}, 999)[0],
        "cup": render(CUP_TARGETS, Condition("clean", "x"), {}, 998)[0],
    }
    for i, cond in enumerate(conditions()):
        if only and cond.group not in only and cond.group != "baseline":
            continue
        row: dict[str, Any] = {"condition": cond.name, "group": cond.group, "note": cond.note,
                               "true_tilt_deg": round(true_tilt({**BASE, **cond.render}), 1)}
        if "nhpt" in cond.sheets:
            row["nhpt"] = nhpt_block(apply_marker_hands(cond, NHPT_BOARD), 100 + 10 * i, clean["nhpt"])
        if "cup" in cond.sheets:
            row["cup"] = cup_block(apply_marker_hands(cond, CUP_TARGETS), 100 + 10 * i, clean["cup"])
        results.append(row)
    return {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d"),
        "opencv": cv2.__version__,
        "synthetic": True,
        "base": BASE,
        "conditions": results,
    }


# ---- report -----------------------------------------------------------------------------------
def _yn(v: Any) -> str:
    return "–" if v is None else ("yes" if v else "**no**")


def _rows(d: dict[str, Any]) -> str:
    fired = d.get("rows_fired") or {}
    txt = ", ".join(f"{k}: “{v}”" for k, v in fired.items()) if fired else "none"
    return f"{txt} ({'right' if d['hint_ok'] else '**wrong**'})"


def to_markdown(res: dict[str, Any]) -> str:
    out = [
        "# Perception robustness v0 — synthetic renders",
        "",
        "**Synthetic renders, not real-camera evidence.** Every frame is an OpenCV render of the printed sheet "
        "(`perception/synth.py`, flat discs for pegs, cup base and hand) perturbed in image space; the REAL product "
        "code is measured on it (`Calibrator`, `quality.build_checks`, `BoardState`, `CupSheetState`). Real lenses, "
        "3-D pegs and cups, specular paper, auto-exposure and motion are not in it. Regenerate with "
        "`cd services/session && uv run python ../../evaluation/scripts/robustness.py`.",
        "",
        f"OpenCV {res['opencv']} · generated {res['generated']} · baseline: tilt {res['base']['tilt']}°, yaw "
        f"{res['base']['yaw']}°, sheet fills ~80 % of 640×480, lens f = {res['base']['focal']}·w, noise σ{res['base']['noise']}, "
        f"JPEG q{res['base']['jpeg']} (what the browser sends). Each row changes one thing from the baseline unless it is "
        "in the *combined* group.",
        "",
        "Columns: **cal** = first fix (all four markers, fresh calibrator); **session** = running session primed "
        "with a clean frame (fresh / partial = three markers / held = fewer, 1.5 s); **RMS** = the homography's "
        "reprojection RMS on the marker corners; **err** = worst true target position error after the round trip "
        "frame → mm; **tilt** = measured (true); **setup rows** = rows of screen 05 that fire, and whether that is "
        "the right advice for the condition.",
        "",
    ]
    conds = res["conditions"]
    out += ["## NHPT board sheet", "",
            "| condition | cal | session | RMS mm | err mm | tilt ° | holes | occupancy (pegs 0,4,8) | free peg | phantoms | setup rows |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    for c in conds:
        d = c.get("nhpt")
        if not d:
            continue
        ph = (len(d.get("phantom_holes") or []) + (d.get("phantom_free") or 0)) if d.get("occupancy_ok") is not None else None
        occ = "–" if d.get("occupancy_ok") is None else ("ok" if d["occupancy_ok"] else f"**wrong {d['occupancy_wrong']}**")
        out.append(
            f"| {c['condition']} | {_yn(d['calibrated'])} | {d['session_source'] or '**lost**'} | {d['rms_mm'] if d['rms_mm'] is not None else '–'} | "
            f"{d['target_err_mm'] if d['target_err_mm'] is not None else '–'} | {d['tilt_deg'] if d['tilt_deg'] is not None else '–'} ({c['true_tilt_deg']}) | "
            f"{d.get('holes') or '–'} | {occ} | {_yn(d.get('free_peg_found'))} | {'–' if ph is None else (ph if ph == 0 else f'**{ph}**')} | {_rows(d)} |"
        )
    out += ["", "## Waiter – cup target sheet", "",
            "| condition | cal | session | RMS mm | err mm | tilt ° | cup found | cup error mm | result | setup rows |",
            "|---|---|---|---|---|---|---|---|---|---|"]
    for c in conds:
        d = c.get("cup")
        if not d:
            continue
        exp = d.get("cup_expected", True)
        res_s = "–" if d.get("cup_ok") is None else ("ok" if d["cup_ok"] else ("**phantom cup**" if not exp else "**miss**"))
        out.append(
            f"| {c['condition']} | {_yn(d['calibrated'])} | {d['session_source'] or '**lost**'} | {d['rms_mm'] if d['rms_mm'] is not None else '–'} | "
            f"{d['target_err_mm'] if d['target_err_mm'] is not None else '–'} | {d['tilt_deg'] if d['tilt_deg'] is not None else '–'} ({c['true_tilt_deg']}) | "
            f"{_yn(d.get('cup_found')) if exp else ('no (none there)' if d.get('cup_found') is False else _yn(d.get('cup_found')))} | "
            f"{d.get('cup_err_mm') if d.get('cup_err_mm') is not None else '–'} | {res_s} | {_rows(d)} |"
        )
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=str(ROOT / "evaluation" / "results"))
    ap.add_argument("--only", default="", help="comma-separated condition groups (baseline always runs)")
    a = ap.parse_args(argv)
    only = {s.strip() for s in a.only.split(",") if s.strip()} or None
    res = run(only)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "robustness_v0.json").write_text(json.dumps(res, indent=1, default=str) + "\n")
    (out / "robustness_v0.md").write_text(to_markdown(res))
    print(f"wrote {out / 'robustness_v0.md'} ({len(res['conditions'])} conditions)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
