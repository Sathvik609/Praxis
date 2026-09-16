"""Board state from a calibrated frame (OpenCV cv2.__version__ == 5.0.0).

1. warp()          cv2.warpPerspective with the calibration homography -> canonical top-down
                   view of the board region at a fixed px/mm.
2. detect_holes()  cv2.HoughCircles on the canonical view, run ONCE and cached; each circle is
                   snapped to the nearest expected hole from the SheetSpec. Holes Hough misses
                   fall back to spec positions; hole_source reports "hough" | "mixed" | "spec".
3. occupancy()     HSV segmentation of saturated peg colour + cv2.findContours for peg blobs,
                   per-hole masked colour fraction and a masked cv2.matchTemplate score against
                   an empty-hole template -> hole_k: "empty" | "occupied".
4. free_pegs_mm()  peg blobs not inside any hole (source zone / dropped / in transit).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from praxis_session.perception.board_spec import NHPT_BOARD, SheetSpec
from praxis_session.perception.calibration import CalibrationResult


@dataclass(frozen=True)
class Hole:
    index: int
    x: float  # canonical px
    y: float
    r: float
    source: str  # "hough" | "spec"


class BoardState:
    def __init__(
        self,
        spec: SheetSpec = NHPT_BOARD,
        px_per_mm: float = 3.0,
        half_extent_mm: float = 70.0,
        peg_hsv_lo: tuple[int, int, int] = (0, 90, 60),
        peg_hsv_hi: tuple[int, int, int] = (180, 255, 255),
        occupied_fraction: float = 0.35,
    ) -> None:
        self.spec = spec
        self.px_per_mm = px_per_mm
        self.half_extent_mm = half_extent_mm
        self.canonical_w = self.canonical_h = int(round(2 * half_extent_mm * px_per_mm))
        self.peg_hsv_lo = np.array(peg_hsv_lo, dtype=np.uint8)
        self.peg_hsv_hi = np.array(peg_hsv_hi, dtype=np.uint8)
        self.occupied_fraction = occupied_fraction
        self._holes: list[Hole] | None = None
        self.hole_source: str | None = None
        self._empty_template: np.ndarray | None = None
        self._template_mask: np.ndarray | None = None
        targets = np.array(spec.targets_mm, np.float64)
        cx, cy = targets.mean(axis=0)
        d = np.linalg.norm(targets[:, None, :] - targets[None, :, :], axis=2)
        self.pitch_mm = float(d[d > 1e-9].min())
        # mm -> canonical px affine: translate board centre to canvas centre, scale.
        self._mm_to_canon = np.array(
            [
                [px_per_mm, 0, self.canonical_w / 2 - cx * px_per_mm],
                [0, px_per_mm, self.canonical_h / 2 - cy * px_per_mm],
                [0, 0, 1],
            ],
            dtype=np.float64,
        )

    # ---- geometry -------------------------------------------------------------------------
    @property
    def holes_cached(self) -> bool:
        return self._holes is not None

    @property
    def hole_radius_px(self) -> float:
        return self.spec.target_radius_mm * self.px_per_mm

    def mm_to_canonical(self, pt_mm: tuple[float, float]) -> tuple[float, float]:
        v = self._mm_to_canon @ np.array([pt_mm[0], pt_mm[1], 1.0])
        return float(v[0]), float(v[1])

    def canonical_to_mm(self, pt_px: tuple[float, float]) -> tuple[float, float]:
        v = np.linalg.inv(self._mm_to_canon) @ np.array([pt_px[0], pt_px[1], 1.0])
        return float(v[0]), float(v[1])

    def warp(self, frame_bgr: np.ndarray, cal: CalibrationResult) -> np.ndarray:
        if not cal.calibrated or cal.H_px_to_mm is None:
            raise RuntimeError("warp requires a calibrated frame")
        H = self._mm_to_canon @ cal.H_px_to_mm  # frame px -> mm -> canonical px
        return cv2.warpPerspective(
            frame_bgr, H, (self.canonical_w, self.canonical_h), flags=cv2.INTER_LINEAR
        )

    def holes_frame_px(self, cal: CalibrationResult) -> list[list[float]]:
        """Hole centres in frame pixels for the overlay (spec positions, calibrated)."""
        if not cal.calibrated:
            return []
        px = cal.to_px(np.array(self.spec.targets_mm, np.float32))
        return np.round(px, 1).tolist()

    # ---- holes ----------------------------------------------------------------------------
    def detect_holes(self, canonical_bgr: np.ndarray) -> list[Hole]:
        if self._holes is not None:
            return self._holes
        gray = cv2.cvtColor(canonical_bgr, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 1.2)
        r = self.hole_radius_px
        circles = cv2.HoughCircles(
            gray,
            cv2.HOUGH_GRADIENT,
            dp=1.0,
            minDist=self.pitch_mm * self.px_per_mm * 0.6,
            param1=100,
            param2=14,
            minRadius=int(r * 0.6),
            maxRadius=int(r * 1.5),
        )
        found = circles[0] if circles is not None else np.zeros((0, 3), np.float32)
        tol = 4.0 * self.px_per_mm
        holes: list[Hole] = []
        n_hough = 0
        for k, hm in enumerate(self.spec.targets_mm):
            ex, ey = self.mm_to_canonical(hm)
            best = None
            if len(found):
                d = np.hypot(found[:, 0] - ex, found[:, 1] - ey)
                j = int(np.argmin(d))
                if d[j] <= tol:
                    best = found[j]
            if best is not None:
                holes.append(Hole(k, float(best[0]), float(best[1]), float(best[2]), "hough"))
                n_hough += 1
            else:
                holes.append(Hole(k, ex, ey, r, "spec"))
        n = len(self.spec.targets_mm)
        self.hole_source = "hough" if n_hough == n else ("spec" if n_hough == 0 else "mixed")
        self._holes = holes
        self._build_empty_template()
        return holes

    def reset_holes(self) -> None:
        self._holes = None
        self.hole_source = None

    def _build_empty_template(self) -> None:
        """Synthetic empty-hole template (dark disc on white) plus a disc mask for matchTemplate."""
        r = int(round(self.hole_radius_px))
        side = 2 * r + 1
        tpl = np.full((side, side), 255, np.uint8)
        cv2.circle(tpl, (r, r), r, 0, -1, cv2.LINE_AA)
        mask = np.zeros((side, side), np.uint8)
        cv2.circle(mask, (r, r), r, 255, -1)
        self._empty_template = tpl
        self._template_mask = mask

    # ---- pegs -----------------------------------------------------------------------------
    def peg_mask(self, canonical_bgr: np.ndarray) -> np.ndarray:
        hsv = cv2.cvtColor(canonical_bgr, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, self.peg_hsv_lo, self.peg_hsv_hi)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        return cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    def peg_blobs(self, canonical_bgr: np.ndarray) -> list[tuple[float, float, float]]:
        """(x, y, area) in canonical px for every peg-coloured blob above a minimum area."""
        mask = self.peg_mask(canonical_bgr)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = (self.px_per_mm * 2.0) ** 2
        blobs = []
        for c in contours:
            a = cv2.contourArea(c)
            if a < min_area:
                continue
            m = cv2.moments(c)
            blobs.append((m["m10"] / m["m00"], m["m01"] / m["m00"], a))
        return blobs

    def hole_scores(self, canonical_bgr: np.ndarray) -> list[dict[str, float]]:
        holes = self.detect_holes(canonical_bgr)
        mask = self.peg_mask(canonical_bgr)
        gray = cv2.cvtColor(canonical_bgr, cv2.COLOR_BGR2GRAY)
        assert self._empty_template is not None and self._template_mask is not None
        r = int(round(self.hole_radius_px))
        out = []
        for h in holes:
            disc = np.zeros(mask.shape, np.uint8)
            cv2.circle(disc, (int(round(h.x)), int(round(h.y))), r, 255, -1)
            inside = disc > 0
            frac = float(mask[inside].mean() / 255.0) if inside.any() else 0.0
            x0, y0 = int(round(h.x)) - r, int(round(h.y)) - r
            patch = gray[max(y0, 0) : y0 + 2 * r + 1, max(x0, 0) : x0 + 2 * r + 1]
            score = 0.0
            if patch.shape == self._empty_template.shape:
                res = cv2.matchTemplate(
                    patch, self._empty_template, cv2.TM_CCORR_NORMED, mask=self._template_mask
                )
                score = float(res[0, 0])
            out.append({"peg_fraction": round(frac, 4), "empty_template_score": round(score, 4)})
        return out

    def occupancy(self, canonical_bgr: np.ndarray) -> dict[str, str]:
        scores = self.hole_scores(canonical_bgr)
        return {
            f"hole_{k}": "occupied" if s["peg_fraction"] >= self.occupied_fraction else "empty"
            for k, s in enumerate(scores)
        }

    def free_pegs_mm(self, canonical_bgr: np.ndarray) -> list[tuple[float, float]]:
        holes = self.detect_holes(canonical_bgr)
        near = self.hole_radius_px * 1.5
        out = []
        for x, y, _ in self.peg_blobs(canonical_bgr):
            if all(np.hypot(x - h.x, y - h.y) > near for h in holes):
                out.append(self.canonical_to_mm((x, y)))
        return out

    def to_event_payload(self, canonical_bgr: np.ndarray) -> dict[str, Any]:
        holes = self.detect_holes(canonical_bgr)
        scores = self.hole_scores(canonical_bgr)
        return {
            "occupancy": {
                f"hole_{k}": "occupied" if s["peg_fraction"] >= self.occupied_fraction else "empty"
                for k, s in enumerate(scores)
            },
            "scores": scores,
            "hole_source": self.hole_source,
            "holes_canonical_px": [[round(h.x, 1), round(h.y, 1), round(h.r, 1)] for h in holes],
            "free_pegs_mm": [
                [round(x, 2), round(y, 2)] for x, y in self.free_pegs_mm(canonical_bgr)
            ],
            "px_per_mm": self.px_per_mm,
        }
