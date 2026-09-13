"""Synthetic frame generators for perception tests. No live camera, ever."""
from __future__ import annotations

import cv2
import numpy as np

from praxis_session.perception.board_spec import BOARD, BoardSpec, render_board_image

FRAME_W, FRAME_H = 640, 480


def perspective_from_mm(spec: BoardSpec = BOARD, jitter: float = 0.0, seed: int = 0) -> np.ndarray:
    """Homography mm -> frame px placing the sheet inside a 640x480 frame with a mild tilt."""
    rng = np.random.default_rng(seed)
    src = np.array(
        [[0, 0], [spec.width_mm, 0], [spec.width_mm, spec.height_mm], [0, spec.height_mm]],
        dtype=np.float32,
    )
    # Sheet occupies most of the frame; rotated 90 deg (landscape) with slight keystone.
    dst = np.array([[590, 30], [600, 455], [40, 445], [55, 40]], dtype=np.float32)
    dst += rng.uniform(-jitter, jitter, dst.shape).astype(np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def render_frame(
    H_mm_to_px: np.ndarray,
    spec: BoardSpec = BOARD,
    px_per_mm: float = 3.0,
    pegs_mm: list[tuple[float, float]] | None = None,
    peg_bgr: tuple[int, int, int] = (40, 40, 220),
    peg_diameter_mm: float = 8.0,
    background: int = 110,
) -> np.ndarray:
    """Render the sheet (plus optional pegs at mm positions) and warp it into a 640x480 frame."""
    sheet = render_board_image(px_per_mm, spec)
    if pegs_mm:
        r = int(round(peg_diameter_mm / 2 * px_per_mm))
        for x, y in pegs_mm:
            cv2.circle(sheet, (int(round(x * px_per_mm)), int(round(y * px_per_mm))), r, peg_bgr, -1, cv2.LINE_AA)
    S = np.diag([1 / px_per_mm, 1 / px_per_mm, 1.0])  # sheet px -> mm
    H = H_mm_to_px @ S
    frame = cv2.warpPerspective(
        sheet, H, (FRAME_W, FRAME_H), flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT, borderValue=(background, background, background),
    )
    return frame


def project_mm(H_mm_to_px: np.ndarray, pts_mm) -> np.ndarray:
    pts = np.asarray(pts_mm, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, H_mm_to_px).reshape(-1, 2)
