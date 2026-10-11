"""Synthetic camera views of a sheet for tests and datasets (no live camera in tests).

OpenCV cv2.__version__ == 5.0.0 (cv2.warpPerspective).
"""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np

from praxis_session.perception.board_spec import SheetSpec
from praxis_session.perception.render import sheet_canonical

CANON_PX_PER_MM = 3.0
# Colours for the robustness tests (BGR): a mid-tone skin patch and a light wooden peg / board.
SKIN_BGR = (120, 160, 220)
WOOD_BGR = (60, 110, 160)


def view_camera(
    spec: SheetSpec,
    size: tuple[int, int],
    tilt_deg: float,
    yaw_deg: float,
    scale: float,
    roll_deg: float = 0.0,
    focal_per_width: float = 1.4,
) -> np.ndarray:
    """3x4 projection: sheet mm (x, y, z) -> homogeneous frame px, z = height above the paper.

    The sheet is centred on the optical axis at a distance that makes it fill ~80 % of the
    frame at scale 1; roll turns it in its own plane (a sheet laid sideways or upside down),
    tilt rotates it about the sheet's x axis, yaw about its y axis. `focal_per_width` is the
    focal length in frame widths (1.4: a narrow webcam; ~0.8: a wide laptop camera).
    """
    w, h = size
    f = focal_per_width * w
    fill = 0.8
    dist = f * max(spec.width_mm / (fill * w), spec.height_mm / (fill * h)) / scale
    t, y, r = math.radians(tilt_deg), math.radians(yaw_deg), math.radians(roll_deg)
    Rx = np.array([[1, 0, 0], [0, math.cos(t), -math.sin(t)], [0, math.sin(t), math.cos(t)]])
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    Rz = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
    R = Ry @ Rx @ Rz
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
    # Sheet axes: x right, y down (towards the patient), so "up off the paper" is -z here
    # (x cross y points into the table).
    Rt = np.column_stack([R[:, 0], R[:, 1], -R[:, 2], np.array([0.0, 0.0, dist])])
    cx, cy = spec.centre_mm
    T = np.array([[1, 0, 0, -cx], [0, 1, 0, -cy], [0, 0, 1, 0], [0, 0, 0, 1]], np.float64)
    return K @ Rt @ T


def view_homography(
    spec: SheetSpec,
    size: tuple[int, int],
    tilt_deg: float,
    yaw_deg: float,
    scale: float,
    roll_deg: float = 0.0,
    focal_per_width: float = 1.4,
) -> np.ndarray:
    """mm -> px for a pinhole camera looking at the sheet plane (z = 0 of `view_camera`)."""
    P = view_camera(spec, size, tilt_deg, yaw_deg, scale, roll_deg, focal_per_width)
    H = P[:, [0, 1, 3]]
    return H / H[2, 2]


def camera_frame(
    spec: SheetSpec,
    size: tuple[int, int] = (640, 480),
    tilt_deg: float = 15.0,
    yaw_deg: float = 5.0,
    scale: float = 1.0,
    noise_sigma: float = 0.0,
    hide_marker: int | list[int] | None = None,
    seed: int = 0,
    pegs_mm: list[tuple[float, float]] | None = None,
    peg_bgr: tuple[int, int, int] = (40, 40, 220),
    peg_diameter_mm: float = 8.0,
    cup_mm: tuple[float, float] | None = None,
    cup_bgr: tuple[int, int, int] = (200, 90, 30),
    cup_diameter_mm: float = 60.0,
    board_bgr: tuple[int, int, int] | None = None,
    skin_blobs_mm: list[tuple[float, float, float]] | None = None,
    skin_bgr: tuple[int, int, int] = SKIN_BGR,
    roll_deg: float = 0.0,
    focal_per_width: float = 1.4,
    border_bgr: tuple[int, int, int] = (90, 90, 90),
) -> tuple[np.ndarray, np.ndarray]:
    """Return (BGR frame, H_true mm->px). Optional coloured peg discs and a blue cup base disc.

    `board_bgr` tints the sheet's white background (a wooden or coloured board under the
    print); `skin_blobs_mm` draws skin-coloured discs (x, y, radius) after the pegs, so they
    occlude the way a hand does. `roll_deg` / `focal_per_width` set the view (`view_camera`);
    `border_bgr` is the table around the sheet.
    """
    canon_bgr = scene_canonical(
        spec, hide_marker, pegs_mm, peg_bgr, peg_diameter_mm, cup_mm, cup_bgr,
        cup_diameter_mm, board_bgr, skin_blobs_mm, skin_bgr,
    )
    H_mm_px = view_homography(spec, size, tilt_deg, yaw_deg, scale, roll_deg, focal_per_width)
    S = np.diag([1 / CANON_PX_PER_MM, 1 / CANON_PX_PER_MM, 1.0])  # canonical px -> mm
    frame = cv2.warpPerspective(canon_bgr, H_mm_px @ S, size, borderValue=border_bgr)
    if noise_sigma > 0:
        rng = np.random.default_rng(seed)
        noise = rng.normal(0, noise_sigma, frame.shape)
        frame = np.clip(frame.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return frame, H_mm_px


def scene_canonical(
    spec: SheetSpec,
    hide_marker: int | None = None,
    pegs_mm: list[tuple[float, float]] | None = None,
    peg_bgr: tuple[int, int, int] = (40, 40, 220),
    peg_diameter_mm: float = 8.0,
    cup_mm: tuple[float, float] | None = None,
    cup_bgr: tuple[int, int, int] = (200, 90, 30),
    cup_diameter_mm: float = 60.0,
    board_bgr: tuple[int, int, int] | None = None,
    skin_blobs_mm: list[tuple[float, float, float]] | None = None,
    skin_bgr: tuple[int, int, int] = SKIN_BGR,
) -> np.ndarray:
    """The sheet with pegs, cup base and skin discs drawn flat, top-down at CANON_PX_PER_MM."""
    canon = sheet_canonical(spec, CANON_PX_PER_MM)
    hidden = [] if hide_marker is None else [hide_marker] if isinstance(hide_marker, int) else list(hide_marker)
    for mid in hidden:  # one id, or several (a forearm across two corners)
        cx, cy = spec.marker_centres_mm[mid]
        s = int(spec.marker_size_mm * CANON_PX_PER_MM / 2) + 2
        c = (int(cx * CANON_PX_PER_MM), int(cy * CANON_PX_PER_MM))
        cv2.rectangle(canon, (c[0] - s, c[1] - s), (c[0] + s, c[1] + s), 255, -1)
    canon_bgr = cv2.cvtColor(canon, cv2.COLOR_GRAY2BGR)
    if board_bgr is not None:
        canon_bgr[canon == 255] = board_bgr
    if pegs_mm:
        r = int(round(peg_diameter_mm / 2 * CANON_PX_PER_MM))
        for x, y in pegs_mm:
            c = (int(round(x * CANON_PX_PER_MM)), int(round(y * CANON_PX_PER_MM)))
            cv2.circle(canon_bgr, c, r, peg_bgr, -1, cv2.LINE_AA)
    if cup_mm is not None:
        r = int(round(cup_diameter_mm / 2 * CANON_PX_PER_MM))
        c = (int(round(cup_mm[0] * CANON_PX_PER_MM)), int(round(cup_mm[1] * CANON_PX_PER_MM)))
        cv2.circle(canon_bgr, c, r, cup_bgr, -1, cv2.LINE_AA)
    for x, y, rad in skin_blobs_mm or []:
        c = (int(round(x * CANON_PX_PER_MM)), int(round(y * CANON_PX_PER_MM)))
        cv2.circle(canon_bgr, c, int(round(rad * CANON_PX_PER_MM)), skin_bgr, -1, cv2.LINE_AA)
    return canon_bgr


def write_nhpt_clip(
    path: Path | str,
    order: list[int],
    fps: float = 10.0,
    hold: int = 5,
    seed: int = 1,
    noise_sigma: float = 4.0,
    size: tuple[int, int] = (640, 480),
) -> dict:
    """Render a scripted NHPT run with cv2.VideoWriter and return ground-truth labels.

    Phases per transfer (each `hold` frames): source peg visible -> lifted -> over hole ->
    seated -> next peg at source. Labels: reps[{rep, hole, t_lift, t_seated, t_clear}],
    nhpt{t_start, t_end, total_s}. Synthetic: exercises the pipeline, not real accuracy.
    """
    from praxis_session.perception.board_spec import NHPT_BOARD

    spec = NHPT_BOARD
    src = (160.0, 148.5)
    holes = spec.targets_mm
    rng = np.random.default_rng(seed)
    tilt, yaw = 15.0 + rng.uniform(-4, 4), 5.0 + rng.uniform(-4, 4)
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    assert w.isOpened(), path
    i = 0
    seated: list[int] = []
    reps = []

    def emit(pegs: list[tuple[float, float]], n: int) -> None:
        nonlocal i
        for _ in range(n):
            frame, _ = camera_frame(
                spec,
                size=size,
                tilt_deg=tilt,
                yaw_deg=yaw,
                noise_sigma=noise_sigma,
                seed=int(rng.integers(0, 2**31)),
                pegs_mm=pegs,
            )
            w.write(frame)
            i += 1

    def pegs_of(extra: tuple[tuple[float, float], ...] = ()) -> list[tuple[float, float]]:
        return [holes[k] for k in seated] + list(extra)

    emit(pegs_of((src,)), hold)
    for r, k in enumerate(order):
        t_lift = i / fps
        emit(pegs_of(), hold)
        emit(pegs_of(((holes[k][0] + 5.0, holes[k][1]),)), hold)
        t_seat = i / fps
        seated.append(k)
        emit(pegs_of(), hold)
        emit(pegs_of((src,)), hold)
        reps.append(
            {"rep": r + 1, "hole": k, "t_lift": t_lift, "t_seated": t_seat, "t_clear": i / fps}
        )
    w.release()
    return {
        "fps": fps,
        "frames": i,
        "reps": reps,
        "nhpt": {
            "t_start": reps[0]["t_lift"],
            "t_end": reps[-1]["t_seated"],
            "total_s": round(reps[-1]["t_seated"] - reps[0]["t_lift"], 3),
        },
    }


def write_cup_clip(
    path: Path | str,
    fps: float = 10.0,
    hold: int = 4,
    seed: int = 3,
    noise_sigma: float = 4.0,
    size: tuple[int, int] = (640, 480),
    phases: tuple[str, ...] = ("slow", "slow", "fast", "fast"),
) -> dict:
    """Render a scripted Waiter - cup run (arcs 1..5..1) and return ground-truth labels.

    Per reach (each `hold` frames): resting at the source dot -> base hidden (lifted) ->
    seen mid-way -> resting at the destination (hold + 2 frames). Fast arcs use hold // 2.
    Labels: reaches[{rep, from_dot, to_dot, t_lift, t_placed, reach_ms, arc, phase}], phases.
    """
    from praxis_session.perception.board_spec import CUP_TARGETS
    from praxis_session.perception.cup import ARC

    spec = CUP_TARGETS
    dots = spec.targets_mm
    rng = np.random.default_rng(seed)
    tilt, yaw = 15.0 + rng.uniform(-4, 4), 5.0 + rng.uniform(-4, 4)
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    assert w.isOpened(), path
    i = 0
    reaches = []

    def emit(cup, n: int) -> None:
        nonlocal i
        for _ in range(n):
            frame, _ = camera_frame(
                spec,
                size=size,
                tilt_deg=tilt,
                yaw_deg=yaw,
                noise_sigma=noise_sigma,
                seed=int(rng.integers(0, 2**31)),
                cup_mm=cup,
            )
            w.write(frame)
            i += 1

    emit(dots[0], hold)
    for arc_i, phase in enumerate(phases, start=1):
        h = max(1, hold // 2) if phase == "fast" else hold
        for a, b in zip(ARC[:-1], ARC[1:], strict=True):
            emit(dots[a], h)
            t_lift = i / fps
            emit(None, h)
            mid = ((dots[a][0] + dots[b][0]) / 2, (dots[a][1] + dots[b][1]) / 2)
            emit(mid, h)
            t_placed = i / fps
            emit(dots[b], h + 2)
            reaches.append(
                {
                    "rep": len(reaches) + 1,
                    "from_dot": a,
                    "to_dot": b,
                    "t_lift": t_lift,
                    "t_placed": t_placed,
                    "reach_ms": round((t_placed - t_lift) * 1000.0, 1),
                    "arc": arc_i,
                    "phase": phase,
                }
            )
    w.release()
    return {"fps": fps, "frames": i, "reaches": reaches, "phases": list(phases)}


def write_arm_landmarks(
    path: Path | str,
    sets: int = 2,
    reps: int = 8,
    hold_s: float = 3.2,
    fps: float = 15.0,
    seed: int = 1,
    peak_deg: float = 90.0,
    side: str = "left",
    frontal: bool = False,
) -> dict:
    """Write a JSONL stream of synthetic 33-point landmarks (px) for arm lifts: a side-view
    figure (Arm to the front) or, with `frontal=True`, a front-view one (Arm out to the side).

    The pose DNN cannot detect a drawn figure, so arm evaluation feeds landmarks through the
    same ArmFSM the live pipeline uses. Labels: reps[{set, rep, t_start, t_peak, peak_deg, t_end}].
    """
    import json

    from tests.test_pose import figure  # synthetic side-view figure (tests helper)

    rng = np.random.default_rng(seed)
    lines: list[str] = []
    labels: list[dict] = []
    t = 0.0
    dt = 1.0 / fps

    def emit(angle: float) -> None:
        nonlocal t
        lm = figure(angle, side=side, frontal=frontal) + rng.normal(0, 0.8, (33, 2)).astype(np.float32)
        lines.append(json.dumps({"t": round(t, 4), "landmarks_px": np.round(lm, 2).tolist()}))
        t += dt

    for _ in range(int(fps * 0.7)):
        emit(5.0)
    for s_i in range(1, sets + 1):
        for r_i in range(1, reps + 1):
            pk = peak_deg + rng.uniform(-1.5, 1.5)
            t_start = t
            n_up = int(fps)
            for k in range(n_up + 1):
                emit(5 + (pk - 5) * k / n_up)
            t_peak = t
            for _ in range(int(hold_s * fps)):
                emit(pk)
            for k in range(n_up, -1, -1):
                emit(5 + (pk - 5) * k / n_up)
            for _ in range(int(fps * 0.5)):
                emit(5.0)
            labels.append(
                {
                    "set": s_i,
                    "rep": r_i,
                    "t_start": round(t_start, 4),
                    "t_peak": round(t_peak, 4),
                    "peak_deg": round(pk, 1),
                    "t_end": round(t, 4),
                }
            )
    Path(path).write_text("\n".join(lines) + "\n")
    return {"fps": fps, "frames": len(lines), "side": side, "reps": labels, "hold_s": hold_s}
