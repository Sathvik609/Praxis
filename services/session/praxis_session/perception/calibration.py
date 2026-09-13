"""ArUco calibration: four DICT_4X4_50 markers at known mm positions -> homography -> px<->mm.

OpenCV 5 (cv2.__version__ == 5.0.0 at authoring): cv2.aruco.ArucoDetector for detection,
cv2.findHomography for the plane mapping. We refuse to report `calibrated` until all four
markers are visible (CLAUDE.md §1). The result is a plain dataclass whose to_event_payload()
goes straight into the JSON event stream.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from praxis_session.perception.board_spec import BOARD, BoardSpec, aruco_dictionary


@dataclass(frozen=True)
class Calibration:
    calibrated: bool
    marker_ids: list[int]
    missing_ids: list[int]
    homography: np.ndarray | None  # 3x3, frame px -> sheet mm
    reprojection_error_mm: float
    marker_corners_px: dict[int, np.ndarray] = field(default_factory=dict)

    def px_to_mm(self, pts_px: Any) -> np.ndarray:
        self._require()
        pts = np.asarray(pts_px, dtype=np.float32).reshape(-1, 1, 2)
        return cv2.perspectiveTransform(pts, self.homography).reshape(-1, 2)

    def mm_to_px(self, pts_mm: Any) -> np.ndarray:
        self._require()
        pts = np.asarray(pts_mm, dtype=np.float32).reshape(-1, 1, 2)
        return cv2.perspectiveTransform(pts, np.linalg.inv(self.homography)).reshape(-1, 2)

    def _require(self) -> None:
        if not self.calibrated or self.homography is None:
            raise RuntimeError("not calibrated: all four markers must be visible")

    def to_event_payload(self) -> dict[str, Any]:
        return {
            "calibrated": self.calibrated,
            "marker_ids": sorted(self.marker_ids),
            "missing_ids": self.missing_ids,
            "reprojection_error_mm": float(self.reprojection_error_mm),
            "homography_px_to_mm": None if self.homography is None else self.homography.tolist(),
            "marker_corners_px": {str(k): v.tolist() for k, v in self.marker_corners_px.items()},
        }


class Calibrator:
    """Stateless per-frame calibrator. Keep the last good Calibration in the caller."""

    def __init__(self, spec: BoardSpec = BOARD) -> None:
        self.spec = spec
        params = cv2.aruco.DetectorParameters()
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self._detector = cv2.aruco.ArucoDetector(aruco_dictionary(), params)
        self._expected = sorted(spec.marker_centers_mm)

    def detect(self, frame_bgr: np.ndarray) -> dict[int, np.ndarray]:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY) if frame_bgr.ndim == 3 else frame_bgr
        corners, ids, _ = self._detector.detectMarkers(gray)
        found: dict[int, np.ndarray] = {}
        if ids is None:
            return found
        for c, i in zip(corners, ids.flatten()):
            i = int(i)
            if i in self.spec.marker_centers_mm and i not in found:
                found[i] = c.reshape(4, 2).astype(np.float32)
        return found

    def calibrate(self, frame_bgr: np.ndarray) -> Calibration:
        found = self.detect(frame_bgr)
        missing = [i for i in self._expected if i not in found]
        if missing:
            return Calibration(False, sorted(found), missing, None, float("inf"), found)

        src_px = np.concatenate([found[i] for i in self._expected], axis=0)
        dst_mm = np.concatenate([self.spec.marker_corners_mm(i) for i in self._expected], axis=0)
        H, _ = cv2.findHomography(src_px, dst_mm, method=0)
        if H is None:
            return Calibration(False, sorted(found), [], None, float("inf"), found)

        proj = cv2.perspectiveTransform(src_px.reshape(-1, 1, 2), H).reshape(-1, 2)
        err = float(np.sqrt(np.mean(np.sum((proj - dst_mm) ** 2, axis=1))))
        return Calibration(True, sorted(found), [], H.astype(np.float64), err, found)
