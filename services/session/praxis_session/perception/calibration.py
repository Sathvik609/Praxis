"""ArUco sheet calibration: frame px <-> sheet mm via cv2.findHomography.

The first calibration of a session needs all four markers (ids 0-3) visible (CLAUDE.md §1:
refuse to start otherwise). After that, brief occlusion is tolerated (Sprint D-CAL-1):

- four markers            -> ``source="fresh"``: homography from 16 corners (exact fit);
- exactly three markers   -> ``source="partial"``: homography from 12 corners with
  ``cv2.RANSAC`` (3 px), still ``calibrated``; ``missing`` names the covered marker;
- one or two markers still where the last fix puts them (mean corner error <= ``ANCHOR_MM``)
  -> ``source="held"`` for as long as that stays true (24 Oct 2026, team test: a hand moving pegs
  or a cup on dot 1 / 5 covers two corners for seconds at a time, and the 1.5 s hold paused one
  real NHPT session 19 times); the visible markers prove the sheet has not moved;
- two markers that HAVE moved (the sheet was nudged) -> ``source="partial"``: homography from
  their 8 corners, kept only when it fits them to ``PAIR_RMS_MM``;
- otherwise (no marker in view, or one marker that moved), a fresh/partial result within
  ``HOLD_S`` seconds -> ``source="held"``: the previous homography is reused, ``age_s`` says how
  stale it is;
- otherwise not calibrated (``source=None``).

Mirrored video (11 Oct 2026): the web sends the camera's own (unmirrored) frames, but some
cameras, drivers and virtual cameras deliver a mirror image, in which no ArUco code decodes. When
no marker of the sheet is found, detection is repeated on ``cv2.flip(gray, 1)``; markers found
there have their corners mapped back to the frame (x -> w - 1 - x), so the homography includes
the reflection and every downstream step (warp, holes, cup, hand landmarks) works on the frame
as received; ``mirrored`` says so, and the orientation that worked is tried first next time.
``rejected`` counts candidate squares ArUco found but could not decode (blur, glare), which
lets the setup hint say "cannot read" rather than "missing".

``tilt_deg`` (Sprint D-CAL-3) is the angle between the camera axis and the sheet normal from
``cv2.solvePnP`` (planar IPPE) on the visible marker corners with a nominal pinhole
(f = 1.2 x frame width, principal point at the centre, no distortion); it is a setup gate,
not a measurement.

``camera`` (12 Oct 2026, found by the 3-D renders in evaluation/blender): a pinhole model of
the camera in sheet coordinates, so anything with height above the paper (a 32 mm peg standing
in its board) can be placed where the camera sees it on the sheet plane
(``lift_to_sheet_mm``). The laptop's focal length is not known, and the nominal 1.2 x width
puts a peg top 3-11 mm off at 35-50° for a typical 0.75-0.85 x width laptop lens. So while the
camera looks at the sheet at >= 15° (where one view constrains it), ``cv2.calibrateCamera`` is
run on the single view of the visible marker corners with the principal point, aspect ratio and
zero distortion fixed, which leaves the focal length and the pose (renders: within 2 % of the
true focal, peg top within 0.3 mm); the median of the first fits is kept for the session. Below
15° (or if the fit is implausible) the nominal focal is used, and the parallax is small there
anyway. The pose then comes from ``cv2.solvePnP`` (IPPE) with that focal.

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
ANCHOR_MM = 3.0  # visible marker corners within this of the last fix: the sheet has not moved
PAIR_RMS_MM = 1.0  # a two-marker refit must fit its own 8 corners this well
RANSAC_PX = 3.0
NOMINAL_F_PER_WIDTH = 1.2
FOCAL_FIT_MIN_TILT_DEG = 15.0  # one planar view constrains f only when it is seen at an angle
FOCAL_FIT_RANGE = (0.35, 3.0)  # plausible f / width; outside it the fit is discarded
FOCAL_FIT_MAX_RMS_PX = 2.0
FOCAL_SAMPLES = 15  # fits kept per session (the median is used)

Source = Literal["fresh", "held", "partial"]


@dataclass(frozen=True)
class CameraModel:
    """Pinhole camera in sheet coordinates (the sheet frame's +z points into the table)."""

    K: np.ndarray
    rvec: np.ndarray
    tvec: np.ndarray
    source: Literal["fit", "nominal"]
    mirrored: bool = False
    width: int = 640

    @property
    def focal_px(self) -> float:
        return float(self.K[0, 0])

    def project_px(self, pts_xyz_mm: np.ndarray) -> np.ndarray:
        """(x, y, height above the paper) mm -> frame px, in the frame as received."""
        pts = np.asarray(pts_xyz_mm, np.float64).reshape(-1, 3).copy()
        pts[:, 2] = -pts[:, 2]  # up off the paper is -z in the sheet frame
        px, _ = cv2.projectPoints(pts, self.rvec, self.tvec, self.K, None)
        px = px.reshape(-1, 2)
        if self.mirrored:
            px[:, 0] = self.width - 1 - px[:, 0]
        return px


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
    mirrored: bool = False
    rejected: int = 0
    # corners (N x 4 x 2, frame px) of the undecoded candidate squares; not serialised
    rejected_px: np.ndarray = field(default_factory=lambda: np.zeros((0, 4, 2), np.float32))
    camera: CameraModel | None = None  # not serialised

    def lift_to_sheet_mm(self, pts_mm: np.ndarray, height_mm: float) -> np.ndarray | None:
        """Where the camera sees sheet points raised `height_mm` above the paper, in sheet-plane
        mm (the coordinates of the canonical view): cv2.projectPoints through the camera model,
        then the measured homography. None without a camera model."""
        if self.camera is None or self.H_px_to_mm is None:
            return None
        pts = np.asarray(pts_mm, np.float64).reshape(-1, 2)
        xyz = np.hstack([pts, np.full((len(pts), 1), float(height_mm))])
        return self.to_mm(self.camera.project_px(xyz))

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
            "mirrored": self.mirrored,
            "rejected": self.rejected,
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


def fit_focal_px(found: dict[int, np.ndarray], spec: SheetSpec, frame_shape: tuple) -> float | None:
    """Focal length (px) from ONE view of the visible marker corners: cv2.calibrateCamera with
    the principal point, aspect ratio and zero distortion fixed, so only f and the pose are
    free. None when the fit fails or is implausible (the caller also skips near-overhead views,
    where f is unobservable)."""
    if len(found) < MIN_PARTIAL_MARKERS:
        return None
    h, w = frame_shape[:2]
    order = sorted(found)
    obj = np.concatenate([spec.marker_corners_mm(i) for i in order]).astype(np.float32)
    obj = np.hstack([obj, np.zeros((len(obj), 1), np.float32)])
    img = np.concatenate([found[i] for i in order]).astype(np.float32)
    flags = (
        cv2.CALIB_USE_INTRINSIC_GUESS | cv2.CALIB_FIX_PRINCIPAL_POINT | cv2.CALIB_FIX_ASPECT_RATIO
        | cv2.CALIB_ZERO_TANGENT_DIST | cv2.CALIB_FIX_K1 | cv2.CALIB_FIX_K2 | cv2.CALIB_FIX_K3
    )
    K0 = np.array([[1.0 * w, 0.0, w / 2.0], [0.0, 1.0 * w, h / 2.0], [0.0, 0.0, 1.0]], np.float64)
    try:
        rms, K, *_ = cv2.calibrateCamera([obj], [img], (w, h), K0, np.zeros(5), flags=flags)
    except cv2.error:
        return None
    f = float(K[0, 0])
    if not (FOCAL_FIT_RANGE[0] * w <= f <= FOCAL_FIT_RANGE[1] * w) or rms > FOCAL_FIT_MAX_RMS_PX:
        return None
    return f


class Calibrator:
    def __init__(self, spec: SheetSpec, hold_s: float = HOLD_S) -> None:
        self.spec = spec
        self.hold_s = hold_s
        params = cv2.aruco.DetectorParameters()
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self._det = cv2.aruco.ArucoDetector(DICT, params)
        self._last_good: CalibrationResult | None = None  # last fresh or partial result
        self._last_good_t: float = 0.0
        self._prefer_mirrored = False  # the orientation that decoded last time is tried first
        self._focals: list[float] = []  # single-view focal fits this session (median used)

    @property
    def ever_calibrated(self) -> bool:
        return self._last_good is not None

    def anchor_from(self, old: "Calibrator") -> None:
        """Keep `old`'s last fix as the anchor only (agent `recalibrate`, 25 Oct team test: the
        reset ran while a hand still hid every corner, and resuming then needed all four at once,
        41 s). Corners seen where that fix puts them hold it again at once, three corners refit and
        two refit when they fit; the timed 1.5 s hold, which needs no marker at all, does not
        carry over, so a sheet that moved is never measured through the old fix."""
        self._last_good, self._last_good_t = old._last_good, float("-inf")

    def run(self, frame_bgr: np.ndarray, t: float | None = None) -> CalibrationResult:
        t = time.time() if t is None else float(t)
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        w = gray.shape[1]
        mirrored = self._prefer_mirrored
        found, rej_px = self._detect(cv2.flip(gray, 1) if mirrored else gray)
        if not found:
            other, rej2 = self._detect(gray if mirrored else cv2.flip(gray, 1))
            if other:
                found, rej_px, mirrored = other, rej2, not mirrored
        mirrored = mirrored and bool(found)
        if found:
            self._prefer_mirrored = mirrored
        # `pnp` keeps the corners as a real camera saw them (the un-mirrored image) for solvePnP;
        # `found` is in the coordinates of the frame as received.
        pnp = found
        if mirrored:
            found = {k: np.column_stack([w - 1 - c[:, 0], c[:, 1]]).astype(np.float32) for k, c in pnp.items()}
            rej_px = np.stack([w - 1 - rej_px[..., 0], rej_px[..., 1]], axis=-1).astype(np.float32)
        rejected = len(rej_px)
        missing = sorted(set(self.spec.marker_centres_mm) - set(found))

        if not missing:
            res = self._fit(found, missing, "fresh", frame_bgr.shape, method=0, pnp=pnp)
        elif len(found) >= MIN_PARTIAL_MARKERS and self._last_good is not None:
            res = self._fit(found, missing, "partial", frame_bgr.shape, method=cv2.RANSAC, pnp=pnp)
        else:
            res = None
        if res is not None:
            res.mirrored, res.rejected, res.rejected_px = mirrored, rejected, rej_px

        if res is not None and res.calibrated:
            self._last_good, self._last_good_t = res, t
            return res

        if self._last_good is not None and found:
            prev = self._last_good
            if self._anchored(found, prev):
                # The visible markers sit where the last fix puts them: the sheet has not moved,
                # so the covered ones are only covered (a hand, the cup), however long.
                return CalibrationResult(
                    self.spec.name, True, missing, prev.H_px_to_mm, prev.rms_mm, found,
                    source="held", age_s=t - self._last_good_t, tilt_deg=prev.tilt_deg,
                    mirrored=prev.mirrored, rejected=rejected, rejected_px=rej_px, camera=prev.camera,
                )
            if len(found) >= 2:
                pair = self._fit(found, missing, "partial", frame_bgr.shape, method=0, pnp=pnp)
                if pair.calibrated and pair.rms_mm is not None and pair.rms_mm <= PAIR_RMS_MM:
                    pair.mirrored, pair.rejected, pair.rejected_px = mirrored, rejected, rej_px
                    self._last_good, self._last_good_t = pair, t
                    return pair

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
                mirrored=prev.mirrored,
                rejected=rejected,
                rejected_px=rej_px,
                camera=prev.camera,
            )
        return CalibrationResult(
            self.spec.name, False, missing, None, None, found,
            mirrored=mirrored, rejected=rejected, rejected_px=rej_px,
        )

    def _anchored(self, found: dict[int, np.ndarray], prev: CalibrationResult) -> bool:
        """The visible markers' corners, through the last fix, land on their printed positions."""
        if prev.H_px_to_mm is None:
            return False
        order = sorted(found)
        src = np.concatenate([found[i] for i in order]).astype(np.float64).reshape(-1, 1, 2)
        dst = np.concatenate([self.spec.marker_corners_mm(i) for i in order]).astype(np.float64)
        got = cv2.perspectiveTransform(src, prev.H_px_to_mm.astype(np.float64)).reshape(-1, 2)
        return float(np.mean(np.hypot(*(got - dst).T))) <= ANCHOR_MM

    def _detect(self, gray: np.ndarray) -> tuple[dict[int, np.ndarray], np.ndarray]:
        """This sheet's markers (id -> 4x2 corners) and the corners of undecoded candidates."""
        corners, ids, rejected = self._det.detectMarkers(gray)
        found: dict[int, np.ndarray] = {}
        if ids is not None:
            for c, i in zip(corners, ids.ravel().tolist(), strict=True):
                if i in self.spec.marker_centres_mm:
                    found[i] = c.reshape(4, 2)
        quads = np.array([r.reshape(4, 2) for r in rejected], np.float32).reshape(-1, 4, 2)
        return found, quads

    def _fit(
        self,
        found: dict[int, np.ndarray],
        missing: list[int],
        source: Source,
        frame_shape: tuple,
        method: int,
        pnp: dict[int, np.ndarray] | None = None,
    ) -> CalibrationResult:
        order = sorted(found)
        src = np.concatenate([found[i] for i in order]).astype(np.float32)
        dst = np.concatenate([self.spec.marker_corners_mm(i) for i in order]).astype(np.float32)
        if method == cv2.RANSAC:
            # findHomography measures the RANSAC threshold in the DESTINATION space, so the
            # robust fit runs sheet mm -> frame px (threshold in px, where corner noise lives)
            # and is inverted. Until 11 Oct 2026 it ran px -> mm, making "3 px" 3 mm: on a
            # close sheet a corner several px off was kept as an inlier.
            H_mm_px, _ = cv2.findHomography(dst, src, cv2.RANSAC, RANSAC_PX)
            H = None if H_mm_px is None else np.linalg.inv(H_mm_px)
        else:
            H, _ = cv2.findHomography(src, dst, method)
        if H is None:
            return CalibrationResult(self.spec.name, False, missing, None, None, found)
        proj = cv2.perspectiveTransform(src.reshape(-1, 1, 2), H).reshape(-1, 2)
        rms = float(np.sqrt(np.mean(np.sum((proj - dst) ** 2, axis=1))))
        tilt = sheet_tilt_deg(found if pnp is None else pnp, self.spec, frame_shape)
        camera = self._camera(found if pnp is None else pnp, frame_shape, tilt, mirrored=pnp is not None and pnp is not found)
        return CalibrationResult(
            self.spec.name, True, missing, H, rms, found, source=source, age_s=0.0, tilt_deg=tilt,
            camera=camera,
        )

    def _camera(
        self, pnp: dict[int, np.ndarray], frame_shape: tuple, tilt: float | None, mirrored: bool
    ) -> CameraModel | None:
        """The camera model for this fix: the session's fitted focal (median of the first
        FOCAL_SAMPLES fits, made while the view is tilted enough) or the nominal one, and the
        pose from cv2.solvePnP (IPPE) on the corners as the camera saw them (un-mirrored)."""
        h, w = frame_shape[:2]
        if len(self._focals) < FOCAL_SAMPLES and tilt is not None and tilt >= FOCAL_FIT_MIN_TILT_DEG:
            f = fit_focal_px(pnp, self.spec, frame_shape)
            if f is not None:
                self._focals.append(f)
        if self._focals:
            f, src = float(np.median(self._focals)), "fit"
        else:
            f, src = NOMINAL_F_PER_WIDTH * w, "nominal"
        K = np.array([[f, 0.0, w / 2.0], [0.0, f, h / 2.0], [0.0, 0.0, 1.0]], np.float64)
        order = sorted(pnp)
        obj = np.concatenate([self.spec.marker_corners_mm(i) for i in order]).astype(np.float64)
        obj = np.hstack([obj, np.zeros((len(obj), 1))])
        img = np.concatenate([pnp[i] for i in order]).astype(np.float64)
        ok, rvec, tvec = cv2.solvePnP(obj, img, K, None, flags=cv2.SOLVEPNP_IPPE)
        if not ok:
            return None
        return CameraModel(K, rvec, tvec, src, mirrored=mirrored, width=w)
