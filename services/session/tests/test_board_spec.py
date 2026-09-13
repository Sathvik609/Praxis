"""Board geometry is the single source of truth for docs/board.pdf and for calibration."""
from __future__ import annotations

import cv2
import numpy as np

from praxis_session.perception.board_spec import BOARD, render_board_image


def test_board_is_a4_with_four_markers_and_nine_holes() -> None:
    assert (BOARD.width_mm, BOARD.height_mm) == (210.0, 297.0)
    assert sorted(BOARD.marker_centers_mm) == [0, 1, 2, 3]
    assert len(BOARD.hole_centers_mm) == 9
    assert BOARD.hole_spacing_mm == 32.0


def test_holes_form_a_3x3_grid_with_32mm_spacing() -> None:
    xs = sorted({round(x, 3) for x, _ in BOARD.hole_centers_mm})
    ys = sorted({round(y, 3) for _, y in BOARD.hole_centers_mm})
    assert len(xs) == 3 and len(ys) == 3
    assert np.allclose(np.diff(xs), 32.0)
    assert np.allclose(np.diff(ys), 32.0)


def test_rendered_board_markers_detected_at_known_positions() -> None:
    px_per_mm = 4.0
    img = render_board_image(px_per_mm)
    assert img.shape == (int(297 * px_per_mm), int(210 * px_per_mm), 3)

    detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50))
    corners, ids, _ = detector.detectMarkers(img)
    assert ids is not None and sorted(ids.flatten().tolist()) == [0, 1, 2, 3]
    for c, i in zip(corners, ids.flatten()):
        cx, cy = c[0].mean(axis=0)
        ex, ey = BOARD.marker_centers_mm[int(i)]
        assert abs(cx / px_per_mm - ex) < 1.0, (i, cx / px_per_mm, ex)
        assert abs(cy / px_per_mm - ey) < 1.0, (i, cy / px_per_mm, ey)


def test_rendered_board_holes_found_by_hough() -> None:
    px_per_mm = 4.0
    img = render_board_image(px_per_mm)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    r = BOARD.hole_diameter_mm / 2 * px_per_mm
    circles = cv2.HoughCircles(
        gray, cv2.HOUGH_GRADIENT, dp=1, minDist=BOARD.hole_spacing_mm * px_per_mm * 0.6,
        param1=100, param2=15, minRadius=int(r * 0.7), maxRadius=int(r * 1.3),
    )
    assert circles is not None
    found = circles[0][:, :2] / px_per_mm
    for hx, hy in BOARD.hole_centers_mm:
        d = np.min(np.linalg.norm(found - np.array([hx, hy]), axis=1))
        assert d < 1.5, (hx, hy, d)
