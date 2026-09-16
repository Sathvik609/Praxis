"""ArUco sheet calibration: frame px <-> sheet mm via cv2.findHomography.

Refuses to calibrate until all four markers (ids 0-3) are visible.
OpenCV cv2.__version__ == 5.0.0 (cv2.aruco.ArucoDetector, cv2.findHomography).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from praxis_session.perception.board_spec import SheetSpec
from praxis_session.perception.render import DICT


@dataclass
class CalibrationResult:
    sheet: str
    calibrated: bool
    missing: list[int]
    H_px_to_mm: np.ndarray | None
    rms_mm: float | None
    marker_corners_px: dict[int, np.ndarray] = field(default_factory=dict)

    def to_mm(self, pts_px: np.ndarray) -> np.ndarray:
        assert self.H_px_to_mm is not None
        pts = np.asarray(pts_px, np.float32).reshape(-1, 1, 2)
        return cv2.perspectiveTransform(pts, self.H_px_to_mm).reshape(-1, 2)

    def to_px(self, pts_mm: np.ndarray) -> np.ndarray:
        assert self.H_px_to_mm is not None
        pts = np.asarray(pts_mm, np.float32).reshape(-1, 1, 2)
        return cv2.perspectiveTransform(pts, np.linalg.inv(self.H_px_to_mm)).reshape(-1, 2)

    def to_dict(self) -> dict:
        return {
            "sheet": self.sheet,
            "calibrated": self.calibrated,
            "missing": self.missing,
            "rms_mm": None if self.rms_mm is None else round(float(self.rms_mm), 3),
            "markers_px": {
                str(k): np.round(v, 1).tolist() for k, v in self.marker_corners_px.items()
            },
        }


class Calibrator:
    def __init__(self, spec: SheetSpec) -> None:
        self.spec = spec
        params = cv2.aruco.DetectorParameters()
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self._det = cv2.aruco.ArucoDetector(DICT, params)

    def run(self, frame_bgr: np.ndarray) -> CalibrationResult:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        corners, ids, _ = self._det.detectMarkers(gray)
        found: dict[int, np.ndarray] = {}
        if ids is not None:
            for c, i in zip(corners, ids.ravel().tolist(), strict=True):
                if i in self.spec.marker_centres_mm:
                    found[i] = c.reshape(4, 2)
        missing = sorted(set(self.spec.marker_centres_mm) - set(found))
        if missing:
            return CalibrationResult(self.spec.name, False, missing, None, None, found)
        order = sorted(found)
        src = np.concatenate([found[i] for i in order]).astype(np.float32)
        dst = np.concatenate([self.spec.marker_corners_mm(i) for i in order]).astype(np.float32)
        H, _ = cv2.findHomography(src, dst, 0)
        if H is None:
            return CalibrationResult(self.spec.name, False, [], None, None, found)
        proj = cv2.perspectiveTransform(src.reshape(-1, 1, 2), H).reshape(-1, 2)
        rms = float(np.sqrt(np.mean(np.sum((proj - dst) ** 2, axis=1))))
        return CalibrationResult(self.spec.name, True, [], H, rms, found)
