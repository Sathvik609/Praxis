"""ArUco sheet calibration: frame px <-> sheet mm via cv2.findHomography.

The first calibration of a session needs all four markers (ids 0-3) visible (CLAUDE.md §1:
refuse to start otherwise). After that, brief occlusion is tolerated (Sprint D-CAL-1):

- four markers            -> ``source="fresh"``: homography from 16 corners (exact fit);
- exactly three markers   -> ``source="partial"``: homography from 12 corners with
  ``cv2.RANSAC`` (3 px), still ``calibrated``; ``missing`` names the covered marker;
- fewer than three, but a fresh/partial result within ``HOLD_S`` seconds -> ``source="held"``:
  the previous homography is reused, ``age_s`` says how stale it is;
- otherwise not calibrated (``source=None``).

``tilt_deg`` (Sprint D-CAL-3) is the angle between the camera axis and the sheet normal from
``cv2.solvePnP`` (planar IPPE) on the visible marker corners with a nominal pinhole
(f = 1.2 x frame width, principal point at the centre, no distortion); it is a setup gate,
not a measurement.

OpenCV cv2.__version__ == 5.0.0 (cv2.aruco.ArucoDetector, cv2.findHomography, cv2.solvePnP).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Literal

import cv2
import numpy as np

from praxis_session.perception.board_spec import SheetSpec
from praxis_session.perception.render import DICT

HOLD_S = 1.5
MIN_PARTIAL_MARKERS = 3
RANSAC_PX = 3.0
NOMINAL_F_PER_WIDTH = 1.2

Source = Literal["fresh", "held", "partial"]


@dataclass
class CalibrationResult:
    sheet: str
    calibrated: bool
    missing: list[int]
    H_px_to_mm: np.ndarray | None
    rms_mm: float | None
    marker_corners_px: dict[int, np.ndarray] = field(default_factory=dict)
    source: Source | None = None
    age_s: float = 0.0
    tilt_deg: float | None = None

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
            "source": self.source,
            "age_s": round(float(self.age_s), 3),
            "tilt_deg": None if self.tilt_deg is None else round(float(self.tilt_deg), 1),
            "markers_px": {
                str(k): np.round(v, 1).tolist() for k, v in self.marker_corners_px.items()
            },
        }


def nominal_intrinsics(frame_shape: tuple) -> np.ndarray:
    """Pinhole guess for an uncalibrated webcam: f = 1.2 x width, principal point centred."""
    h, w = frame_shape[:2]
    f = NOMINAL_F_PER_WIDTH * w
    return np.array([[f, 0.0, w / 2.0], [0.0, f, h / 2.0], [0.0, 0.0, 1.0]], np.float64)


def sheet_tilt_deg(
    found: dict[int, np.ndarray], spec: SheetSpec, frame_shape: tuple
) -> float | None:
    """Angle (deg) between the camera's optical axis and the sheet normal, via cv2.solvePnP.

    Object points are the visible marker corners on the sheet plane (z = 0, mm); image points
    their detected px corners; the planar IPPE solver returns the sheet pose in camera
    coordinates. The sheet normal in camera coordinates is the third column of R, so the tilt
    is arccos(|R[2, 2]|): 0° when the camera looks straight down at the sheet.
    """
    if len(found) < MIN_PARTIAL_MARKERS:
        return None
    order = sorted(found)
    obj = np.concatenate([spec.marker_corners_mm(i) for i in order]).astype(np.float64)
    obj = np.hstack([obj, np.zeros((len(obj), 1))])
    img = np.concatenate([found[i] for i in order]).astype(np.float64)
    ok, rvec, _ = cv2.solvePnP(
        obj, img, nominal_intrinsics(frame_shape), None, flags=cv2.SOLVEPNP_IPPE
    )
    if not ok:
        return None
    R, _ = cv2.Rodrigues(rvec)
    cos = float(np.clip(abs(R[2, 2]), -1.0, 1.0))
    return float(np.degrees(np.arccos(cos)))


class Calibrator:
    def __init__(self, spec: SheetSpec, hold_s: float = HOLD_S) -> None:
        self.spec = spec
        self.hold_s = hold_s
        params = cv2.aruco.DetectorParameters()
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self._det = cv2.aruco.ArucoDetector(DICT, params)
        self._last_good: CalibrationResult | None = None  # last fresh or partial result
        self._last_good_t: float = 0.0

    @property
    def ever_calibrated(self) -> bool:
        return self._last_good is not None

    def run(self, frame_bgr: np.ndarray, t: float | None = None) -> CalibrationResult:
        t = time.time() if t is None else float(t)
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        corners, ids, _ = self._det.detectMarkers(gray)
        found: dict[int, np.ndarray] = {}
        if ids is not None:
            for c, i in zip(corners, ids.ravel().tolist(), strict=True):
                if i in self.spec.marker_centres_mm:
                    found[i] = c.reshape(4, 2)
        missing = sorted(set(self.spec.marker_centres_mm) - set(found))

        if not missing:
            res = self._fit(found, missing, "fresh", frame_bgr.shape, method=0)
        elif len(found) >= MIN_PARTIAL_MARKERS and self._last_good is not None:
            res = self._fit(found, missing, "partial", frame_bgr.shape, method=cv2.RANSAC)
        else:
            res = None

        if res is not None and res.calibrated:
            self._last_good, self._last_good_t = res, t
            return res

        # Hold the last good homography through a short occlusion (never before a first fix).
        if self._last_good is not None and 0.0 <= t - self._last_good_t <= self.hold_s:
            prev = self._last_good
            return CalibrationResult(
                self.spec.name,
                True,
                missing,
                prev.H_px_to_mm,
                prev.rms_mm,
                found,
                source="held",
                age_s=t - self._last_good_t,
                tilt_deg=prev.tilt_deg,
            )
        return CalibrationResult(self.spec.name, False, missing, None, None, found)

    def _fit(
        self,
        found: dict[int, np.ndarray],
        missing: list[int],
        source: Source,
        frame_shape: tuple,
        method: int,
    ) -> CalibrationResult:
        order = sorted(found)
        src = np.concatenate([found[i] for i in order]).astype(np.float32)
        dst = np.concatenate([self.spec.marker_corners_mm(i) for i in order]).astype(np.float32)
        H, _ = cv2.findHomography(src, dst, method, RANSAC_PX)
        if H is None:
            return CalibrationResult(self.spec.name, False, missing, None, None, found)
        proj = cv2.perspectiveTransform(src.reshape(-1, 1, 2), H).reshape(-1, 2)
        rms = float(np.sqrt(np.mean(np.sum((proj - dst) ** 2, axis=1))))
        tilt = sheet_tilt_deg(found, self.spec, frame_shape)
        return CalibrationResult(
            self.spec.name, True, missing, H, rms, found, source=source, age_s=0.0, tilt_deg=tilt
        )
