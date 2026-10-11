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


# Variance of the Laplacian below this reads as blurry. 40 (synthetic) failed a focused Mac webcam
# on a plain wall (~33, 10 Oct); heavy blur measures < 10.
BLUR_MIN_SHARPNESS = 15.0


def lighting(frame_bgr: np.ndarray) -> dict:
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    luma = float(gray.mean())
    sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    hint = None
    if luma < 60:
        hint = "Too dark. Add light in front of you, not behind."
    elif luma > 200:
        hint = "Too bright. Move the lamp or close the blind."
    elif sharp < BLUR_MIN_SHARPNESS:
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


# Below this the 8 mm pegs are under ~6 px wide (synthetic-derived, 10 Oct; see docs/RISKS.md).
MIN_PX_PER_MM = 0.75


def sheet_px_per_mm(cal: CalibrationResult, spec: SheetSpec) -> float:
    """Image pixels per sheet millimetre at the sheet centre (mean of the two axes)."""
    cx, cy = spec.width_mm / 2, spec.height_mm / 2
    p = cal.to_px(np.array([[cx, cy], [cx + 10, cy], [cx, cy + 10]], np.float32))
    return float((np.linalg.norm(p[1] - p[0]) + np.linalg.norm(p[2] - p[0])) / 20.0)


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
    ppm = sheet_px_per_mm(cal, spec)
    big_enough = ppm >= MIN_PX_PER_MM
    hint = None
    if not inside:
        hint = "Move the camera back so the whole sheet is in view."
    elif not big_enough:
        hint = "Move the camera closer so the sheet fills more of the view."
    return {"ok": inside and big_enough, "hint": hint, "px_per_mm": round(ppm, 2)}


# Laptop camera only (10 Oct, product owner): the sheet sits 25–35 cm in front of the laptop and
# the screen is tilted forward, so the built-in camera looks down at ~40–50°. Calibration holds
# well past 60° on renders, but beyond ~50° a seated peg (~20 mm proud) hides the next hole
# (32 mm pitch), so 50° is the limit.
MAX_TILT_DEG = 50.0
ANGLE_HINT = (
    "Tilt the laptop screen forward and move the sheet closer, so the camera looks down at it."
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


def corner_name(spec: SheetSpec, marker_id: int) -> str:
    """Where marker `marker_id` sits on the sheet as printed ("bottom-right"); patients see
    corners, not ArUco ids."""
    cx, cy = spec.marker_centres_mm[marker_id]
    return f"{'top' if cy < spec.height_mm / 2 else 'bottom'}-{'left' if cx < spec.width_mm / 2 else 'right'}"


# ArUco candidate squares that did not decode, with no marker read at all: the sheet is probably
# there but blurred or glaring (11 Oct sweep: 5-9 on motion-blurred renders, 0 on an empty view).
UNREADABLE_MIN_REJECTED = 4


def missing_marker_causes(
    cal: CalibrationResult, spec: SheetSpec, frame_shape: tuple
) -> dict[int, str]:
    """Why each missing marker is missing: "outside" when its predicted square (with the white
    margin around it) leaves the frame; "unreadable" when ArUco found a candidate square there
    that did not decode (blur, glare); else "covered". The prediction is the homography of the
    markers that ARE visible (cv2.findHomography on their corners, sheet mm -> frame px); with
    no marker visible there is nothing to predict from and the result is empty."""
    if not cal.missing or not cal.marker_corners_px:
        return {}
    ids = sorted(cal.marker_corners_px)
    src = np.concatenate([spec.marker_corners_mm(i) for i in ids]).astype(np.float32)
    dst = np.concatenate([np.asarray(cal.marker_corners_px[i], np.float32) for i in ids])
    H, _ = cv2.findHomography(src, dst, 0)
    if H is None:
        return {}
    h, w = frame_shape[:2]
    out: dict[int, str] = {}
    for i in cal.missing:
        c = spec.marker_corners_mm(i)
        ctr = c.mean(axis=0)
        quad = (ctr + (c - ctr) * 1.5).reshape(-1, 1, 2).astype(np.float32)
        px = cv2.perspectiveTransform(quad, H).reshape(-1, 2)
        inside = bool(np.all((px[:, 0] >= 0) & (px[:, 0] < w) & (px[:, 1] >= 0) & (px[:, 1] < h)))
        seen = any(
            cv2.pointPolygonTest(px.reshape(-1, 1, 2), (float(x), float(y)), False) >= 0
            for x, y in np.asarray(cal.rejected_px, np.float32).reshape(-1, 2)
        )
        out[i] = "outside" if not inside else ("unreadable" if seen else "covered")
    return out


def _markers_named(spec: SheetSpec | None, ids: list[int]) -> str:
    if spec is None:
        return ", ".join(map(str, ids))
    return ", ".join(f"{corner_name(spec, i)} corner ({i})" for i in ids)


def build_checks(
    cal: CalibrationResult,
    lighting_d: dict,
    steadiness_d: dict,
    area_d: dict,
    presence_d: dict,
    camera_ok: bool = True,
    needs_sheet: bool = True,
    spec: SheetSpec | None = None,
    frame_shape: tuple | None = None,
) -> list[dict]:
    """The wireframe's five rows plus the camera-angle row (D-CAL-3), in order; status
    pass|check|pending with a fix hint. With `frame_shape`, a missing marker's hint says
    whether it is outside the picture or covered (`missing_marker_causes`).

    Arm to the front uses no printed sheet: with needs_sheet=False the marker, angle and
    task-area rows are replaced by one side-view row (pending until the pose model gates it)."""

    def row(id_: str, label: str, ok: bool | None, hint: str | None) -> dict:
        status = "pending" if ok is None else ("pass" if ok else "check")
        return {"id": id_, "label": label, "status": status, "hint": None if ok else hint}

    present = presence_d.get("present")
    # Setup needs all four markers (CLAUDE.md: refuse to start); a partial or held fix is
    # enough to keep a running session going but not to unlock Continue.
    markers_ok = bool(cal.calibrated and not cal.missing)
    causes = (
        missing_marker_causes(cal, spec, frame_shape)
        if spec is not None and frame_shape is not None and not markers_ok
        else {}
    )
    if markers_ok:
        markers_hint = None
    elif causes:
        # Name the cause per corner (11 Oct 2026 sweep: a sheet half out of the frame was told
        # to "flatten the sheet").
        out = [i for i in cal.missing if causes.get(i) == "outside"]
        unread = [i for i in cal.missing if causes.get(i) == "unreadable"]
        cov = [i for i in cal.missing if causes.get(i) not in ("outside", "unreadable")]
        parts = [] if cal.calibrated else [f"Markers missing: {_markers_named(spec, cal.missing)}."]
        if out:
            parts.append(
                f"The {_markers_named(spec, out)} {'are' if len(out) > 1 else 'is'} outside the picture: "
                "move the sheet into the middle of the view, or tilt the screen."
            )
        if unread:
            parts.append(
                f"The marker{'s' if len(unread) > 1 else ''} in the {_markers_named(spec, unread)} "
                f"{'are' if len(unread) > 1 else 'is'} in view but cannot be read: hold the laptop still, "
                "wipe the lens and add light."
            )
        if cov:
            parts.append(
                f"The marker{'s' if len(cov) > 1 else ''} in the {_markers_named(spec, cov)} "
                f"{'are' if len(cov) > 1 else 'is'} covered or creased: clear and flatten {'them' if len(cov) > 1 else 'it'}."
            )
        if cal.calibrated:
            parts.append("Keep all four corners clear to start.")
        markers_hint = " ".join(parts)
    elif cal.calibrated:
        n = len(cal.missing)
        markers_hint = (
            f"The marker{'s' if n > 1 else ''} in the {_markers_named(spec, cal.missing)} {'are' if n > 1 else 'is'} covered. "
            "Keep all four corners clear to start."
            if spec is not None
            else f"Marker {', '.join(map(str, cal.missing))} is covered. Keep all four corners clear to start."
        )
    elif cal.rejected >= UNREADABLE_MIN_REJECTED and not cal.marker_corners_px:
        markers_hint = (
            f"Markers missing: {_markers_named(spec, cal.missing)}. No corner marker can be read: "
            "if the sheet is in view, hold the laptop still, wipe the lens and add light."
        )
    else:
        markers_hint = (
            f"Markers missing: {_markers_named(spec, cal.missing)}. "
            "Put the whole sheet flat on the table, in view of the camera."
        )
    angle = camera_angle(cal)
    light_ok = bool(lighting_d["ok"] and steadiness_d["ok"])
    light_hint = lighting_d.get("hint") or (
        None if steadiness_d["ok"] else "Hold the camera still or rest it on the table."
    )
    if not needs_sheet:
        return [
            row("camera", "Camera permission", camera_ok, "Allow the camera in your browser."),
            row("person", "One person in view", present, "Face the camera with both shoulders and your hips in view."),
            row(
                "side_view",
                "Facing the camera",
                None,
                "Turn your chair so you face the camera straight on.",
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
