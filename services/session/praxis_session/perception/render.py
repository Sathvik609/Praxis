"""Canonical (top-down) renderings of sheets, used by the PDF generator and synthetic tests.

OpenCV cv2.__version__ == 5.0.0 (cv2.aruco.generateImageMarker, cv2.circle).
"""

from __future__ import annotations

import cv2
import numpy as np

from praxis_session.perception.board_spec import SheetSpec

DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
INK = 40  # printed grey level for targets


def marker_image(marker_id: int, px: int) -> np.ndarray:
    return cv2.aruco.generateImageMarker(DICT, marker_id, px)


def sheet_canonical(spec: SheetSpec, px_per_mm: float) -> np.ndarray:
    """White sheet with ArUco markers and targets (filled dots, or rings for holes)."""
    w, h = int(round(spec.width_mm * px_per_mm)), int(round(spec.height_mm * px_per_mm))
    img = np.full((h, w), 255, np.uint8)
    for mid, (cx, cy) in spec.marker_centres_mm.items():
        s = int(round(spec.marker_size_mm * px_per_mm))
        m = marker_image(mid, s)
        x0, y0 = int(round(cx * px_per_mm - s / 2)), int(round(cy * px_per_mm - s / 2))
        img[y0 : y0 + s, x0 : x0 + s] = m
    r = int(round(spec.target_radius_mm * px_per_mm))
    for x, y in spec.targets_mm:
        c = (int(round(x * px_per_mm)), int(round(y * px_per_mm)))
        if spec.target_kind == "dot":
            cv2.circle(img, c, r, INK, -1, cv2.LINE_AA)
        else:
            cv2.circle(img, c, r, INK, max(1, int(px_per_mm)), cv2.LINE_AA)
    return img
