"""Physical geometry of the Praxis calibration sheet + nine-hole board, in millimetres.

Single source of truth used by tools/make_board.py (the printable PDF), calibration.py (marker
world coordinates for the homography) and board.py (expected hole positions in the canonical
view). Rendering here uses OpenCV 5 (cv2.__version__ == 5.0.0 at authoring): cv2.aruco for the
markers, cv2.circle for the hole marks.

Coordinate frame: origin at the top-left corner of the A4 sheet, x to the right, y down, mm.

Standard NHPT (Mathiowetz 1985): 3x3 holes, 32 mm centre-to-centre, 7.1 mm diameter. We keep
the spacing exactly and draw printed hole marks at 10 mm so Hough circles are robust at
640x480 (see docs/RISKS.md).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

ARUCO_DICT_ID = cv2.aruco.DICT_4X4_50


@dataclass(frozen=True)
class BoardSpec:
    width_mm: float = 210.0
    height_mm: float = 297.0
    marker_size_mm: float = 40.0
    # id -> (cx, cy)
    marker_centers_mm: dict[int, tuple[float, float]] = field(
        default_factory=lambda: {
            0: (35.0, 35.0),
            1: (175.0, 35.0),
            2: (175.0, 262.0),
            3: (35.0, 262.0),
        }
    )
    hole_spacing_mm: float = 32.0
    hole_diameter_mm: float = 10.0
    board_center_mm: tuple[float, float] = (105.0, 148.5)

    @property
    def hole_centers_mm(self) -> list[tuple[float, float]]:
        """Row-major, top-left first: index k = row*3 + col, matching hole_k in events."""
        cx, cy = self.board_center_mm
        s = self.hole_spacing_mm
        return [(cx + (c - 1) * s, cy + (r - 1) * s) for r in range(3) for c in range(3)]

    def marker_corners_mm(self, marker_id: int) -> np.ndarray:
        """4x2 array, clockwise from top-left, matching cv2.aruco corner order."""
        cx, cy = self.marker_centers_mm[marker_id]
        h = self.marker_size_mm / 2
        return np.array(
            [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]],
            dtype=np.float32,
        )


BOARD = BoardSpec()


def aruco_dictionary() -> cv2.aruco.Dictionary:
    return cv2.aruco.getPredefinedDictionary(ARUCO_DICT_ID)


def marker_bitmap(marker_id: int, side_px: int) -> np.ndarray:
    """Grayscale marker image (uint8, side_px x side_px) from the DICT_4X4_50 dictionary."""
    return cv2.aruco.generateImageMarker(aruco_dictionary(), marker_id, side_px)


def render_board_image(px_per_mm: float, spec: BoardSpec = BOARD) -> np.ndarray:
    """Render the sheet as a BGR image at the requested scale. White background, black ink."""
    w = int(round(spec.width_mm * px_per_mm))
    h = int(round(spec.height_mm * px_per_mm))
    img = np.full((h, w, 3), 255, dtype=np.uint8)

    side = int(round(spec.marker_size_mm * px_per_mm))
    for mid in spec.marker_centers_mm:
        bmp = marker_bitmap(mid, side)
        x0, y0 = spec.marker_corners_mm(mid)[0]
        x0 = int(round(x0 * px_per_mm))
        y0 = int(round(y0 * px_per_mm))
        img[y0 : y0 + side, x0 : x0 + side] = cv2.cvtColor(bmp, cv2.COLOR_GRAY2BGR)

    r = int(round(spec.hole_diameter_mm / 2 * px_per_mm))
    for hx, hy in spec.hole_centers_mm:
        c = (int(round(hx * px_per_mm)), int(round(hy * px_per_mm)))
        cv2.circle(img, c, r, (0, 0, 0), thickness=-1, lineType=cv2.LINE_AA)
    return img
