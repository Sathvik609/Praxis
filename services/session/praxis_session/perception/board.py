"""Board state from a calibrated frame (OpenCV cv2.__version__ == 5.0.0).

1. warp()          cv2.warpPerspective with the calibration homography -> canonical top-down
                   view of the board region at a fixed px/mm.
2. detect_holes()  cv2.HoughCircles on the canonical view, run ONCE and cached; each circle is
                   snapped to the nearest expected hole from the SheetSpec. Holes Hough misses
                   fall back to spec positions; hole_source reports "hough" | "mixed" | "spec".
                   **The Hough centre is what occupancy is measured on**: the per-hole disc in
                   hole_scores() is drawn at (Hole.x, Hole.y), so a grid printed or placed a few
                   mm off the spec (<= 4 mm) is scored where the hole really is
                   (tests/test_board.py::test_hough_centres_refine_occupancy_on_a_misprinted_grid).
                   At the same time an empty-hole template is captured PER HOLE from the
                   canonical view (a 1.4 r square around the Hough centre) for holes that are
                   clearly empty at that moment; NHPT starts with every hole empty, and
                   reset_holes() re-captures.
3. occupancy()     Peg mask = cv2.inRange in HSV, then cv2.findContours for blobs. Two mask
                   modes:
                     - default: "saturated, not sheet-white and not skin" - S >= 90, V >= 60
                       minus the skin band H 0-25 (OpenCV 0-180 units: 0-12), S 40-170, V 80-255,
                       which also drops a light wooden board or peg tint;
                     - sampled: sample_peg_colour() sets a +-12 deg hue window (+-6 units, wrapped
                       around red) with S/V floors from a 6 mm patch the patient tapped; the skin
                       band is excluded only when it does not overlap the sampled window.
                   Per hole: `peg_fraction` = share of the disc (at the Hough centre) covered by
                   the peg mask. **The masked cv2.matchTemplate score is a tie-breaker**: when
                   `peg_fraction` is within +-0.1 of `occupied_fraction`, the hole is "empty" iff
                   the masked TM_CCOEFF_NORMED score against its captured empty template is
                   >= `template_empty_score` (0.75; measured on synthetic frames: empty ~0.99,
                   seated peg ~0.61, peg hovering 5 mm off the hole ~0.81). Outside the tie zone
                   the fraction alone decides
                   (tests/test_board.py::test_template_score_breaks_ties_near_the_fraction_threshold).
4. free_pegs_mm()  peg blobs not inside any hole (source zone / dropped / in transit). The hand
                   box (from the hand tracker, expanded by 15 mm) is excluded here only - never
                   from hole occupancy, because the hand covers a hole right after seating a peg.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

import cv2
import numpy as np

from praxis_session.perception.board_spec import NHPT_BOARD, SheetSpec
from praxis_session.perception.calibration import CalibrationResult

# HSV skin band (OpenCV H in 0-180, i.e. 0-50 degrees): light-to-mid skin tones, and with it
# light wood and cardboard tints. Saturated pegs sit above S 170 and are not touched.
SKIN_HSV_LO = (0, 40, 80)
SKIN_HSV_HI = (25, 170, 255)
SKIN_S_MARGIN = 20  # a sampled colour with median S above 170 + margin keeps the skin exclusion
HUE_WINDOW = 6  # +-12 degrees in OpenCV's 0-180 hue units

RectMM = tuple[float, float, float, float]


def hsv_window_from_patch(
    canonical_bgr: np.ndarray, centre_px: tuple[float, float], radius_px: float
) -> dict[str, Any]:
    """Median HSV of a disc patch -> a hue window (+-HUE_WINDOW, may wrap below 0 / above 180)
    and S/V floors at 60 % of the medians (never below 40). Shared by the peg and cup samplers."""
    hsv = cv2.cvtColor(canonical_bgr, cv2.COLOR_BGR2HSV)
    mask = np.zeros(hsv.shape[:2], np.uint8)
    cv2.circle(mask, (int(round(centre_px[0])), int(round(centre_px[1]))), int(round(radius_px)), 255, -1)
    px = hsv[mask > 0]
    if px.size == 0:
        raise ValueError("sample patch is outside the canonical view")
    h, s, v = (int(np.median(px[:, k])) for k in range(3))
    h_lo, h_hi = h - HUE_WINDOW, h + HUE_WINDOW
    s_min, v_min = max(40, int(0.6 * s)), max(40, int(0.6 * v))
    # The skin band stays excluded unless the sampled colour could itself be read as skin:
    # a hue window touching 0-25 (allowing for wrap-around) with skin-like saturation.
    hue_overlap = any(
        a <= SKIN_HSV_HI[0] and b >= SKIN_HSV_LO[0]
        for a, b in ((h_lo, h_hi), (h_lo + 180, h_hi + 180), (h_lo - 180, h_hi - 180))
    )
    skin_overlap = hue_overlap and s <= SKIN_HSV_HI[1] + SKIN_S_MARGIN
    return {
        "source": "sampled",
        "h": h,
        "s": s,
        "v": v,
        "h_lo": h_lo,
        "h_hi": h_hi,
        "s_min": s_min,
        "v_min": v_min,
        "skin_excluded": not skin_overlap,
    }


def hue_window_mask(hsv: np.ndarray, rng: dict[str, Any]) -> np.ndarray:
    """cv2.inRange for a window that may wrap around the red end of the hue circle."""
    lo_sv, hi_sv = (rng["s_min"], rng["v_min"]), (255, 255)
    parts = []
    h_lo, h_hi = rng["h_lo"], rng["h_hi"]
    for a, b in ((h_lo, h_hi), (h_lo + 180, h_hi + 180), (h_lo - 180, h_hi - 180)):
        a, b = max(a, 0), min(b, 180)
        if a <= b:
            parts.append(cv2.inRange(hsv, np.array((a, *lo_sv), np.uint8), np.array((b, *hi_sv), np.uint8)))
    mask = parts[0]
    for p in parts[1:]:
        mask = cv2.bitwise_or(mask, p)
    return mask


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
        template_empty_score: float | None = 0.75,
        tie_zone: float = 0.1,
        hand_margin_mm: float = 15.0,
    ) -> None:
        self.spec = spec
        self.px_per_mm = px_per_mm
        self.half_extent_mm = half_extent_mm
        self.canonical_w = self.canonical_h = int(round(2 * half_extent_mm * px_per_mm))
        self.peg_hsv_lo = np.array(peg_hsv_lo, dtype=np.uint8)
        self.peg_hsv_hi = np.array(peg_hsv_hi, dtype=np.uint8)
        self.occupied_fraction = occupied_fraction
        self.template_empty_score = template_empty_score
        self.tie_zone = tie_zone
        self.hand_margin_mm = hand_margin_mm
        self.colour_range: dict[str, Any] | None = None  # set by sample_peg_colour
        self._holes: list[Hole] | None = None
        self.hole_source: str | None = None
        self._templates: list[np.ndarray | None] = []
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

    @property
    def template_half_px(self) -> int:
        return int(round(1.4 * self.hole_radius_px))

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

    def in_source_zone(self, pt_mm: tuple[float, float]) -> bool:
        """Off the hole grid (further than one pitch from every hole) but within reach of it:
        where a dish of pegs sits, on either side of the board."""
        d = [float(np.hypot(pt_mm[0] - x, pt_mm[1] - y)) for x, y in self.spec.targets_mm]
        cx, cy = np.array(self.spec.targets_mm, np.float64).mean(axis=0)
        return min(d) > self.pitch_mm and float(np.hypot(pt_mm[0] - cx, pt_mm[1] - cy)) < 200.0

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
        self._capture_empty_templates(canonical_bgr)
        return holes

    def reset_holes(self) -> None:
        self._holes = None
        self.hole_source = None
        self._templates = []

    def _capture_empty_templates(self, canonical_bgr: np.ndarray) -> None:
        """Per-hole grey templates from the view the holes were detected on, plus a disc mask
        for cv2.matchTemplate. A hole that is not clearly empty right now gets no template
        (its tie-break is off until reset_holes())."""
        assert self._holes is not None
        m = self.template_half_px
        side = 2 * m + 1
        mask = np.zeros((side, side), np.uint8)
        cv2.circle(mask, (m, m), m, 255, -1)
        self._template_mask = mask
        gray = cv2.cvtColor(canonical_bgr, cv2.COLOR_BGR2GRAY)
        peg = self.peg_mask(canonical_bgr)
        self._templates = []
        for h in self._holes:
            patch = self._patch(gray, h)
            frac = self._disc_fraction(peg, h)
            clearly_empty = frac < max(0.0, self.occupied_fraction - self.tie_zone)
            self._templates.append(patch.copy() if patch is not None and clearly_empty else None)

    def _patch(self, gray: np.ndarray, h: Hole) -> np.ndarray | None:
        m = self.template_half_px
        x0, y0 = int(round(h.x)) - m, int(round(h.y)) - m
        if x0 < 0 or y0 < 0 or x0 + 2 * m + 1 > gray.shape[1] or y0 + 2 * m + 1 > gray.shape[0]:
            return None
        return gray[y0 : y0 + 2 * m + 1, x0 : x0 + 2 * m + 1]

    def _disc_fraction(self, mask: np.ndarray, h: Hole) -> float:
        disc = np.zeros(mask.shape, np.uint8)
        cv2.circle(disc, (int(round(h.x)), int(round(h.y))), int(round(self.hole_radius_px)), 255, -1)
        inside = disc > 0
        return float(mask[inside].mean() / 255.0) if inside.any() else 0.0

    # ---- colour ---------------------------------------------------------------------------
    def sample_peg_colour(self, canonical_bgr: np.ndarray, xy_mm: tuple[float, float]) -> dict[str, Any]:
        """Set the peg colour window from a 6 mm patch at `xy_mm` (a peg the patient tapped).
        Returns the range for the trace; `colour_range` keeps it until the next sample."""
        rng = hsv_window_from_patch(canonical_bgr, self.mm_to_canonical(xy_mm), 3.0 * self.px_per_mm)
        self.colour_range = rng
        return rng

    # ---- pegs -----------------------------------------------------------------------------
    def peg_mask(self, canonical_bgr: np.ndarray) -> np.ndarray:
        hsv = cv2.cvtColor(canonical_bgr, cv2.COLOR_BGR2HSV)
        if self.colour_range is None:
            mask = cv2.inRange(hsv, self.peg_hsv_lo, self.peg_hsv_hi)
            skin_excluded = True
        else:
            mask = hue_window_mask(hsv, self.colour_range)
            skin_excluded = bool(self.colour_range["skin_excluded"])
        if skin_excluded:
            skin = cv2.inRange(hsv, np.array(SKIN_HSV_LO, np.uint8), np.array(SKIN_HSV_HI, np.uint8))
            mask = cv2.bitwise_and(mask, cv2.bitwise_not(skin))
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        return cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    def _exclude(self, mask: np.ndarray, exclude_mm: Sequence[RectMM] | None) -> np.ndarray:
        if not exclude_mm:
            return mask
        out = mask.copy()
        pad = self.hand_margin_mm
        for x0, y0, x1, y1 in exclude_mm:
            a = self.mm_to_canonical((min(x0, x1) - pad, min(y0, y1) - pad))
            b = self.mm_to_canonical((max(x0, x1) + pad, max(y0, y1) + pad))
            cv2.rectangle(out, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), 0, -1)
        return out

    def peg_blobs(
        self, canonical_bgr: np.ndarray, exclude_mm: Sequence[RectMM] | None = None
    ) -> list[tuple[float, float, float]]:
        """(x, y, area) in canonical px for every peg-coloured blob above a minimum area,
        outside the excluded (hand) rectangles."""
        mask = self._exclude(self.peg_mask(canonical_bgr), exclude_mm)
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
        assert self._template_mask is not None
        out = []
        for h in holes:
            frac = self._disc_fraction(mask, h)
            score = None
            tpl = self._templates[h.index] if h.index < len(self._templates) else None
            patch = self._patch(gray, h)
            if tpl is not None and patch is not None and patch.shape == tpl.shape:
                res = cv2.matchTemplate(patch, tpl, cv2.TM_CCOEFF_NORMED, mask=self._template_mask)
                score = float(np.nan_to_num(res[0, 0]))
            out.append(
                {
                    "peg_fraction": round(frac, 4),
                    "empty_template_score": None if score is None else round(score, 4),
                }
            )
        return out

    def _occupied(self, s: dict[str, float]) -> bool:
        frac, score = s["peg_fraction"], s["empty_template_score"]
        if (
            self.template_empty_score is not None
            and score is not None
            and abs(frac - self.occupied_fraction) <= self.tie_zone
        ):
            return score < self.template_empty_score
        return frac >= self.occupied_fraction

    def occupancy(
        self, canonical_bgr: np.ndarray, exclude_mm: Sequence[RectMM] | None = None
    ) -> dict[str, str]:
        # exclude_mm is accepted for symmetry with free_pegs_mm; holes are never blanked.
        return {
            f"hole_{k}": "occupied" if self._occupied(s) else "empty"
            for k, s in enumerate(self.hole_scores(canonical_bgr))
        }

    def free_pegs_mm(
        self, canonical_bgr: np.ndarray, exclude_mm: Sequence[RectMM] | None = None
    ) -> list[tuple[float, float]]:
        holes = self.detect_holes(canonical_bgr)
        near = self.hole_radius_px * 1.5
        out = []
        for x, y, _ in self.peg_blobs(canonical_bgr, exclude_mm):
            if all(np.hypot(x - h.x, y - h.y) > near for h in holes):
                out.append(self.canonical_to_mm((x, y)))
        return out

    def to_event_payload(
        self, canonical_bgr: np.ndarray, exclude_mm: Sequence[RectMM] | None = None
    ) -> dict[str, Any]:
        holes = self.detect_holes(canonical_bgr)
        scores = self.hole_scores(canonical_bgr)
        return {
            "occupancy": {
                f"hole_{k}": "occupied" if self._occupied(s) else "empty"
                for k, s in enumerate(scores)
            },
            "scores": scores,
            "hole_source": self.hole_source,
            "holes_canonical_px": [[round(h.x, 1), round(h.y, 1), round(h.r, 1)] for h in holes],
            "free_pegs_mm": [
                [round(x, 2), round(y, 2)] for x, y in self.free_pegs_mm(canonical_bgr, exclude_mm)
            ],
            "px_per_mm": self.px_per_mm,
            "colour": self.colour_range,
        }
