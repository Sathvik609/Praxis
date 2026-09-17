"""Camera-setup quality checks for screen 05 (OpenCV cv2.__version__ == 5.0.0).

Presence is a frame-difference fallback until the pose model lands (Phase 5); every presence
result carries method="frame_difference" so the UI and trace can label it.
"""

from __future__ import annotations

from collections import deque

import cv2
import numpy as np

from praxis_session.perception.board_spec import SheetSpec
from praxis_session.perception.calibration import CalibrationResult


def lighting(frame_bgr: np.ndarray) -> dict:
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    luma = float(gray.mean())
    sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    hint = None
    if luma < 60:
        hint = "Too dark. Add light in front of you, not behind."
    elif luma > 200:
        hint = "Too bright. Move the lamp or close the blind."
    elif sharp < 40:
        hint = "Image is blurry. Clean the lens or hold the camera still."
    return {
        "mean_luma": round(luma, 1),
        "sharpness": round(sharp, 1),
        "ok": hint is None,
        "hint": hint,
    }


class MarkerSteadiness:
    """Mean per-corner standard deviation of marker positions over a sliding window."""

    def __init__(self, window: int = 10, max_jitter_px: float = 2.0) -> None:
        self._hist: deque[dict[int, np.ndarray]] = deque(maxlen=window)
        self.max_jitter_px = max_jitter_px

    def update(self, marker_corners_px: dict[int, np.ndarray]) -> dict:
        self._hist.append({k: np.asarray(v, np.float32) for k, v in marker_corners_px.items()})
        jitters = []
        for k in marker_corners_px:
            pts = [h[k] for h in self._hist if k in h]
            if len(pts) >= 2:
                jitters.append(float(np.mean(np.std(np.stack(pts), axis=0))))
        jitter = float(np.mean(jitters)) if jitters else 0.0
        return {"jitter_px": round(jitter, 2), "ok": jitter < self.max_jitter_px}


def task_area_in_view(
    cal: CalibrationResult, spec: SheetSpec, frame_shape: tuple, margin_px: int = 16
) -> dict:
    if not cal.calibrated:
        return {"ok": False, "hint": "Show all four corner markers first."}
    h, w = frame_shape[:2]
    px = cal.to_px(np.array(spec.targets_mm, np.float32))
    inside = bool(
        np.all(
            (px[:, 0] >= margin_px)
            & (px[:, 0] <= w - margin_px)
            & (px[:, 1] >= margin_px)
            & (px[:, 1] <= h - margin_px)
        )
    )
    return {
        "ok": inside,
        "hint": None if inside else "Move the camera back so the whole sheet is in view.",
    }


MAX_TILT_DEG = 25.0
ANGLE_HINT = (
    "Mount the camera above the table, pointing straight down (a phone on a stand works)."
)


def camera_angle(cal: CalibrationResult, max_tilt_deg: float = MAX_TILT_DEG) -> dict:
    """Overhead-mount gate (D-CAL-3): the sheet-plane homography ignores height, so a peg top
    or a hand 30-100 mm above the sheet projects tens of mm off at a typical webcam angle.
    `tilt_deg` comes from cv2.solvePnP on the marker corners (calibration.py); above
    `max_tilt_deg` the setup asks for the camera to be moved. `ok` is None until there is a fix.
    """
    tilt = cal.tilt_deg if cal.calibrated else None
    if tilt is None:
        return {"tilt_deg": None, "max_tilt_deg": max_tilt_deg, "ok": None, "hint": ANGLE_HINT}
    ok = tilt <= max_tilt_deg
    return {
        "tilt_deg": round(float(tilt), 1),
        "max_tilt_deg": max_tilt_deg,
        "ok": ok,
        "hint": None if ok else ANGLE_HINT,
    }


class Presence:
    """Motion-energy presence fallback (labeled) until the pose model provides a person check."""

    def __init__(self, window: int = 30, threshold: float = 4.0) -> None:
        self._prev: np.ndarray | None = None
        self._motion: deque[float] = deque(maxlen=window)
        self.threshold = threshold

    def update(self, frame_bgr: np.ndarray) -> dict:
        gray = cv2.cvtColor(cv2.resize(frame_bgr, (160, 120)), cv2.COLOR_BGR2GRAY)
        if self._prev is not None:
            self._motion.append(float(cv2.absdiff(gray, self._prev).mean()))
        self._prev = gray
        if len(self._motion) < (self._motion.maxlen or 0):
            return {"present": None, "motion": None, "method": "frame_difference"}
        m = float(np.mean(self._motion))
        return {"present": m > self.threshold, "motion": round(m, 2), "method": "frame_difference"}


def build_checks(
    cal: CalibrationResult,
    lighting_d: dict,
    steadiness_d: dict,
    area_d: dict,
    presence_d: dict,
    camera_ok: bool = True,
    needs_sheet: bool = True,
) -> list[dict]:
    """The wireframe's five rows plus the camera-angle row (D-CAL-3), in order; status
    pass|check|pending with a fix hint.

    Arm to the front uses no printed sheet: with needs_sheet=False the marker, angle and
    task-area rows are replaced by one side-view row (pending until the pose model gates it)."""

    def row(id_: str, label: str, ok: bool | None, hint: str | None) -> dict:
        status = "pending" if ok is None else ("pass" if ok else "check")
        return {"id": id_, "label": label, "status": status, "hint": None if ok else hint}

    present = presence_d.get("present")
    # Setup needs all four markers (CLAUDE.md: refuse to start); a partial or held fix is
    # enough to keep a running session going but not to unlock Continue.
    markers_ok = bool(cal.calibrated and not cal.missing)
    if markers_ok:
        markers_hint = None
    elif cal.calibrated:
        markers_hint = (
            f"Marker {', '.join(map(str, cal.missing))} is covered. "
            "Keep all four corners clear to start."
        )
    else:
        markers_hint = (
            f"Markers missing: {', '.join(map(str, cal.missing))}. "
            "Flatten the sheet and keep it in view."
        )
    angle = camera_angle(cal)
    light_ok = bool(lighting_d["ok"] and steadiness_d["ok"])
    light_hint = lighting_d.get("hint") or (
        None if steadiness_d["ok"] else "Hold the camera still or rest it on the table."
    )
    if not needs_sheet:
        return [
            row("camera", "Camera permission", camera_ok, "Allow the camera in your browser."),
            row("person", "One person in view", present, "Sit sideways so your shoulder, elbow and hip are in view."),
            row(
                "side_view",
                "Side of your body to the camera",
                None,
                "Turn so your practising shoulder faces the camera; hips and shoulder in view.",
            ),
            row("lighting", "Lighting", bool(lighting_d["ok"]), lighting_d.get("hint")),
        ]
    return [
        row("camera", "Camera permission", camera_ok, "Allow the camera in your browser."),
        row(
            "person",
            "One person in view",
            present,
            "Sit so your upper body and the table are in view.",
        ),
        row("task_area", "Hand and task area in view", area_d["ok"], area_d.get("hint")),
        row("markers", "Sheet found · all four corner markers visible", markers_ok, markers_hint),
        row("angle", "Camera looks down at the sheet", angle["ok"], angle["hint"]),
        row("lighting", "Lighting and steady tracking", light_ok, light_hint),
    ]
