"""Hand landmarks and hand metrics (OpenCV cv2.__version__ == 5.0.0, cv2.dnn).

Two-stage MediaPipe models from OpenCV Zoo (Apache-2.0, docs/LICENSES.md): palm detection
(192x192) then hand landmarks (224x224) -> 21 points in frame px. Metrics are computed in
sheet millimetres through the ArUco calibration: pinch aperture (thumb tip 4 <-> index tip 8),
path speed, spectral arc length (SPARC, Balasubramanian et al. 2015) of the index-tip speed,
and tremor as the dominant 3-12 Hz component of the detrended index-tip trace.
"""
from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from praxis_session.perception.calibration import CalibrationResult

MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
PALM_MODEL = "palm_detection_mediapipe_2023feb.onnx"
HAND_MODEL = "handpose_estimation_mediapipe_2023feb.onnx"
THUMB_TIP, INDEX_TIP = 4, 8
CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20), (0, 17),
]


@dataclass
class HandResult:
    landmarks_px: np.ndarray  # (21, 2)
    z: np.ndarray  # (21,) relative depth
    conf: float
    handedness: float  # 0 = left ... 1 = right (model's own convention, mirrored webcams flip it)
    bbox: np.ndarray  # (4,) x1 y1 x2 y2

    def to_dict(self) -> dict:
        return {
            "present": True,
            "landmarks_px": np.round(self.landmarks_px, 1).tolist(),
            "conf": round(float(self.conf), 3),
            "handedness": round(float(self.handedness), 3),
            "bbox": np.round(self.bbox, 1).tolist(),
        }


class _quiet_cv_logs:
    def __enter__(self):
        import cv2

        try:
            self._prev = cv2.utils.logging.getLogLevel()
            cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
        except AttributeError:  # pragma: no cover
            self._prev = None
        return self

    def __exit__(self, *exc):
        import cv2

        if self._prev is not None:
            cv2.utils.logging.setLogLevel(self._prev)
        return False


class HandTracker:
    """Palm detector + hand landmarker through cv2.dnn. `available` is False without models."""

    def __init__(self, models_dir: Path = MODELS_DIR, conf_threshold: float = 0.8) -> None:
        self.models_dir = Path(models_dir)
        self.available = False
        self.last_ms = 0.0
        palm, hand = self.models_dir / PALM_MODEL, self.models_dir / HAND_MODEL
        if palm.exists() and hand.exists():

            from praxis_session.perception.zoo.mp_handpose import MPHandPose
            from praxis_session.perception.zoo.mp_palmdet import MPPalmDet

            # The vendored wrappers call setPreferableTarget, which OpenCV 5's graph engine
            # ignores with a WARN log on every construction; silence that one line.
            with _quiet_cv_logs():
                self._palm = MPPalmDet(str(palm), nmsThreshold=0.3, scoreThreshold=0.6, topK=100)
                self._hand = MPHandPose(str(hand), confThreshold=conf_threshold)
            self.available = True

    def detect(self, frame_bgr: np.ndarray) -> HandResult | None:
        if not self.available:
            return None
        t0 = time.perf_counter()
        try:
            palms = self._palm.infer(frame_bgr)
            if palms is None or len(palms) == 0:
                return None
            best = palms[np.argmax(palms[:, -1])]
            out = self._hand.infer(frame_bgr, best)
        finally:
            self.last_ms = (time.perf_counter() - t0) * 1000.0
        if out is None:
            return None
        lm = out[4:67].reshape(21, 3)
        return HandResult(
            landmarks_px=lm[:, :2].astype(np.float32),
            z=lm[:, 2].astype(np.float32),
            conf=float(out[131]),
            handedness=float(out[130]),
            bbox=out[0:4].astype(np.float32),
        )


# ---- metrics ------------------------------------------------------------------------------
def sparc(velocity: np.ndarray, fs: float, padlevel: int = 4, fc: float = 10.0, amp_th: float = 0.05) -> float:
    """Spectral arc length of a speed profile (more negative = less smooth)."""
    v = np.asarray(velocity, np.float64)
    if v.size < 4 or not np.any(v):
        return 0.0
    nfft = int(2 ** (math.ceil(math.log2(v.size)) + padlevel))
    f = np.arange(0, fs, fs / nfft)[:nfft]
    mf = np.abs(np.fft.fft(v, nfft))
    mf = mf / mf.max()
    sel = f <= fc
    f_sel, mf_sel = f[sel], mf[sel]
    inx = np.nonzero(mf_sel >= amp_th)[0]
    if inx.size < 2:
        return 0.0
    f_sel, mf_sel = f_sel[inx[0] : inx[-1] + 1], mf_sel[inx[0] : inx[-1] + 1]
    return float(-np.sum(np.sqrt((np.diff(f_sel) / (f_sel[-1] - f_sel[0])) ** 2 + np.diff(mf_sel) ** 2)))


def tremor(trace_xy: np.ndarray, fs: float, band: tuple[float, float] = (3.0, 12.0)) -> tuple[float | None, float]:
    """Dominant frequency in `band` of the detrended 2-D trace and the band's share of power."""
    x = np.asarray(trace_xy, np.float64)
    if x.ndim != 2 or x.shape[0] < int(fs):  # need >= 1 s
        return None, 0.0
    n = x.shape[0]
    t = np.arange(n)
    det = np.empty_like(x)
    for k in range(x.shape[1]):
        a, b = np.polyfit(t, x[:, k], 1)
        det[:, k] = x[:, k] - (a * t + b)
    if np.allclose(det, 0.0, atol=1e-9):
        return None, 0.0
    spec = np.sum(np.abs(np.fft.rfft(det, axis=0)) ** 2, axis=1)
    freqs = np.fft.rfftfreq(n, 1.0 / fs)
    spec[0] = 0.0
    total = float(spec.sum())
    if total <= 0:
        return None, 0.0
    in_band = (freqs >= band[0]) & (freqs <= band[1])
    if not in_band.any():
        return None, 0.0
    ratio = float(spec[in_band].sum() / total)
    peak = float(freqs[in_band][np.argmax(spec[in_band])])
    return (peak if ratio > 0.3 else None), round(ratio, 3)


def pinch_mm(res: HandResult | None, cal: CalibrationResult) -> float | None:
    if res is None or not cal.calibrated:
        return None
    pts = cal.to_mm(res.landmarks_px[[THUMB_TIP, INDEX_TIP]])
    return round(float(np.linalg.norm(pts[0] - pts[1])), 2)


class HandMetrics:
    """Sliding-window metrics of the index fingertip in sheet mm."""

    def __init__(self, window_s: float = 3.0) -> None:
        self.window_s = window_s
        self._hist: deque[tuple[float, np.ndarray]] = deque()

    def update(self, t: float, res: HandResult | None, cal: CalibrationResult) -> dict:
        out: dict = {
            "present": res is not None, "pinch_mm": None, "index_tip_mm": None,
            "path_mm_s": None, "sparc": None, "tremor_hz": None, "tremor_ratio": 0.0,
        }
        if res is None or not cal.calibrated:
            if res is None:
                self._hist.clear()
            return out
        tip = cal.to_mm(res.landmarks_px[[INDEX_TIP]])[0]
        out["pinch_mm"] = pinch_mm(res, cal)
        out["index_tip_mm"] = [round(float(tip[0]), 1), round(float(tip[1]), 1)]
        self._hist.append((t, tip.astype(np.float64)))
        while self._hist and t - self._hist[0][0] > self.window_s:
            self._hist.popleft()
        if len(self._hist) >= 10:
            ts = np.array([h[0] for h in self._hist])
            xy = np.stack([h[1] for h in self._hist])
            dur = float(ts[-1] - ts[0])
            if dur > 0:
                fs = (len(ts) - 1) / dur
                step = np.linalg.norm(np.diff(xy, axis=0), axis=1)
                out["path_mm_s"] = round(float(step.sum() / dur), 1)
                speed = step / np.maximum(np.diff(ts), 1e-6)
                out["sparc"] = round(sparc(speed, fs), 3)
                hz, ratio = tremor(xy, fs)
                out["tremor_hz"], out["tremor_ratio"] = (None if hz is None else round(hz, 1)), ratio
        return out
