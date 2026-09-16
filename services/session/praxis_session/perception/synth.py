"""Synthetic camera views of a sheet for tests and datasets (no live camera in tests).

OpenCV cv2.__version__ == 5.0.0 (cv2.warpPerspective).
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from praxis_session.perception.board_spec import SheetSpec
from praxis_session.perception.render import sheet_canonical

CANON_PX_PER_MM = 3.0


def view_homography(
    spec: SheetSpec, size: tuple[int, int], tilt_deg: float, yaw_deg: float, scale: float
) -> np.ndarray:
    """mm -> px for a pinhole camera looking at the sheet plane.

    The sheet is centred on the optical axis at a distance that makes it fill ~80 % of the
    frame at scale 1; tilt rotates it about the sheet's x axis, yaw about its y axis.
    """
    w, h = size
    f = 1.4 * w
    fill = 0.8
    dist = f * max(spec.width_mm / (fill * w), spec.height_mm / (fill * h)) / scale
    t, y = math.radians(tilt_deg), math.radians(yaw_deg)
    Rx = np.array([[1, 0, 0], [0, math.cos(t), -math.sin(t)], [0, math.sin(t), math.cos(t)]])
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    R = Ry @ Rx
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
    P = K @ np.column_stack([R[:, 0], R[:, 1], np.array([0.0, 0.0, dist])])
    cx, cy = spec.centre_mm
    T = np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1]])
    H = P @ T
    return H / H[2, 2]


def camera_frame(
    spec: SheetSpec,
    size: tuple[int, int] = (640, 480),
    tilt_deg: float = 15.0,
    yaw_deg: float = 5.0,
    scale: float = 1.0,
    noise_sigma: float = 0.0,
    hide_marker: int | None = None,
    seed: int = 0,
    pegs_mm: list[tuple[float, float]] | None = None,
    peg_bgr: tuple[int, int, int] = (40, 40, 220),
    peg_diameter_mm: float = 8.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (BGR frame, H_true mm->px). Optional coloured peg discs at mm positions."""
    canon = sheet_canonical(spec, CANON_PX_PER_MM)
    if hide_marker is not None:
        cx, cy = spec.marker_centres_mm[hide_marker]
        s = int(spec.marker_size_mm * CANON_PX_PER_MM / 2) + 2
        c = (int(cx * CANON_PX_PER_MM), int(cy * CANON_PX_PER_MM))
        cv2.rectangle(canon, (c[0] - s, c[1] - s), (c[0] + s, c[1] + s), 255, -1)
    canon_bgr = cv2.cvtColor(canon, cv2.COLOR_GRAY2BGR)
    if pegs_mm:
        r = int(round(peg_diameter_mm / 2 * CANON_PX_PER_MM))
        for x, y in pegs_mm:
            c = (int(round(x * CANON_PX_PER_MM)), int(round(y * CANON_PX_PER_MM)))
            cv2.circle(canon_bgr, c, r, peg_bgr, -1, cv2.LINE_AA)
    H_mm_px = view_homography(spec, size, tilt_deg, yaw_deg, scale)
    S = np.diag([1 / CANON_PX_PER_MM, 1 / CANON_PX_PER_MM, 1.0])  # canonical px -> mm
    frame = cv2.warpPerspective(canon_bgr, H_mm_px @ S, size, borderValue=(90, 90, 90))
    if noise_sigma > 0:
        rng = np.random.default_rng(seed)
        noise = rng.normal(0, noise_sigma, frame.shape)
        frame = np.clip(frame.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return frame, H_mm_px
