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
    return {"mean_luma": round(luma, 1), "sharpness": round(sharp, 1), "ok": hint is None, "hint": hint}


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
    return {"ok": inside, "hint": None if inside else "Move the camera back so the whole sheet is in view."}


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
) -> list[dict]:
    """The five wireframe rows, in order; status pass|check|pending with a fix hint."""

    def row(id_: str, label: str, ok: bool | None, hint: str | None) -> dict:
        status = "pending" if ok is None else ("pass" if ok else "check")
        return {"id": id_, "label": label, "status": status, "hint": None if ok else hint}

    present = presence_d.get("present")
    markers_hint = (
        None
        if cal.calibrated
        else f"Markers missing: {', '.join(map(str, cal.missing))}. Flatten the sheet and keep it in view."
    )
    light_ok = bool(lighting_d["ok"] and steadiness_d["ok"])
    light_hint = lighting_d.get("hint") or (
        None if steadiness_d["ok"] else "Hold the camera still or rest it on the table."
    )
    return [
        row("camera", "Camera permission", camera_ok, "Allow the camera in your browser."),
        row("person", "One person in view", present, "Sit so your upper body and the table are in view."),
        row("task_area", "Hand and task area in view", area_d["ok"], area_d.get("hint")),
        row("markers", "Sheet found · all four corner markers visible", cal.calibrated, markers_hint),
        row("lighting", "Lighting and steady tracking", light_ok, light_hint),
    ]
