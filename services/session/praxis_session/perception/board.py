"""Board state from a calibrated frame (OpenCV cv2.__version__ == 5.0.0).

1. warp()          cv2.warpPerspective with the calibration homography -> canonical top-down
                   view of the board region at a fixed px/mm, then normalise_to_paper(): a
                   per-channel grey closing (cv2.morphologyEx) estimates the white paper's
                   brightness and the view is divided by it (flat field + white balance), so
                   the HSV windows below hold in a dim room, under a warm bulb or a shadow.
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
                       minus the skin band H 0-25 (OpenCV 0-180 units: 0-50 deg), S 40-170,
                       V 40-255 (light to deep skin tones), which also drops a light wooden
                       board or peg tint;
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
4. free_pegs_mm()  peg blobs not inside any hole (source zone / dropped / in transit) and no
                   longer than 45 mm (cv2.minAreaRect: a pen is not a peg). The hand
                   box (from the hand tracker, expanded by 15 mm) is excluded here only - never
                   from hole occupancy, because the hand covers a hole right after seating a peg.
5. Height (12 Oct 2026, found by the 3-D renders, evaluation/results/synthetic3d_v0.md). A real
                   peg is 32 mm tall and stands in a board on the sheet; from a laptop camera
                   20-50 deg off vertical its body lands on the sheet plane as a streak that
                   starts a few mm past the hole (the board's thickness) and ends 10-40 mm past
                   it, away from the camera. On the hole disc alone a seated peg read empty, its
                   streak was a "free peg", and at ~50 deg it lit the next row's hole. With the
                   calibration's camera model (calibration.CameraModel, focal from a single-view
                   cv2.calibrateCamera) each hole gets two regions in the canonical view, drawn
                   with cv2.line between cv2.projectPoints of the hole raised to two heights:
                     - the **seat column**: z = 10..24 mm above the hole, 3 mm half-width - only a
                       peg standing in that hole covers it, whatever the board thickness;
                     - the **footprint**: z = 0..32 mm, 5 mm half-width - all a seated peg covers.
                   A hole is occupied when its column is >= 50 % peg-coloured; otherwise the disc
                   rule above decides, unless the disc lies in the footprint of a hole whose
                   column shows a standing peg (>= 15 % peg colour, so a peg only partly
                   segmented in dim light counts): then the disc is that peg's streak.
                   Free pegs exclude blobs centred inside any footprint. Without a camera model,
                   or for the flat discs of the 2-D renders (which never fill a column), the
                   rules above are unchanged (tests/test_parallax.py).
                   Hidden is not empty: a hole keeps its last decision while something covers
                   it - its region (column + disc) is >= 50 % more skin-coloured than on the empty
                   board; or it no longer looks like its empty template (score < 0.5) and no peg
                   colour explains it (a large hand is normalised to "paper" in this view); or its
                   column is only partly peg-coloured (25-50 %: fingers over a seated peg). On the
                   renders the forearm passing over seated pegs flipped them empty and they were
                   counted again when it left.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

import cv2
import numpy as np

from praxis_session.perception.board_spec import NHPT_BOARD, SheetSpec
from praxis_session.perception.calibration import CalibrationResult

# HSV skin band (OpenCV H in 0-180, i.e. 0-50 degrees): light to deep skin tones, and with it
# light wood and cardboard tints. Saturated pegs sit above S 170 and are not touched. The V floor
# was 80 until 11 Oct 2026: a deep skin tone (BGR 35,45,75 -> V 75) slipped under it and read as
# four phantom pegs (evaluation/results/robustness_v0.md); 40 covers it, and the peg mask's own
# V >= 60 floor leaves no gap below.
SKIN_HSV_LO = (0, 40, 40)
SKIN_HSV_HI = (25, 170, 255)
# Paper-referenced normalisation (11 Oct 2026): the printed sheet is white paper, so its
# brightness at every point is a measured reference for the light falling there. A grey-level
# closing (dilate then erode, per channel) on a 2 mm-per-cell copy of the canonical view removes
# everything darker and smaller than the kernel (ink, pegs, the cup base) and keeps the paper and
# large-scale shading such as a lamp's shadow edge; dividing by it maps the paper to PAPER_LEVEL
# in every channel. That is white balance and flat-field correction in one step, so the fixed
# HSV windows hold under a dim room, a warm bulb or a shadow across the sheet. Gain is capped
# where there is no paper (outside the frame: black after the warp).
PAPER_LEVEL = 250.0
PAPER_FLOOR = 16.0  # below this the "paper" is not paper (off-frame); caps the gain at ~15x
PAPER_CELL_MM = 2.0
SKIN_S_MARGIN = 20  # a sampled colour with median S above 170 + margin keeps the skin exclusion
HUE_WINDOW = 6  # +-12 degrees in OpenCV's 0-180 hue units

RectMM = tuple[float, float, float, float]


def normalise_to_paper(canonical_bgr: np.ndarray, px_per_mm: float, kernel_mm: float) -> np.ndarray:
    """Divide the canonical view by its paper brightness (see PAPER_LEVEL). `kernel_mm` must be
    larger than the largest dark object on the sheet that should not be taken for shading
    (a peg, a printed ring or marker, the cup base)."""
    h, w = canonical_bgr.shape[:2]
    cell_mm = max(PAPER_CELL_MM, kernel_mm / 15.0)  # ~15 cells across the kernel keeps it cheap
    step = max(1, int(round(px_per_mm * cell_mm)))
    small = cv2.resize(canonical_bgr, (max(1, w // step), max(1, h // step)), interpolation=cv2.INTER_AREA)
    k = max(3, int(round(kernel_mm / cell_mm)) | 1)
    # A rectangular element is separable (fast) and, for a smooth light field, as good as a disc.
    paper = cv2.morphologyEx(small, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    paper = cv2.blur(paper, (3, 3))
    paper = cv2.resize(paper, (w, h), interpolation=cv2.INTER_LINEAR)
    paper = cv2.max(paper, np.full_like(paper, int(PAPER_FLOOR)))
    return cv2.divide(canonical_bgr, paper, scale=PAPER_LEVEL)  # saturating uint8


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
        normalise: bool = True,
        paper_kernel_mm: float = 30.0,
        max_peg_len_mm: float = 45.0,
        column_z_mm: tuple[float, float] = (10.0, 24.0),
        column_r_mm: float = 3.0,
        column_occupied_fraction: float = 0.5,
        footprint_z_mm: tuple[float, float] = (0.0, 32.0),
        footprint_r_mm: float = 5.0,
        disc_in_footprint: float = 0.25,
    ) -> None:
        self.spec = spec
        self.column_z_mm = column_z_mm
        self.column_r_mm = column_r_mm
        self.column_occupied_fraction = column_occupied_fraction
        self.footprint_z_mm = footprint_z_mm
        self.footprint_r_mm = footprint_r_mm
        self.disc_in_footprint = disc_in_footprint
        self._cal: CalibrationResult | None = None  # the fix of the last warp (camera model)
        self._geom: dict[str, Any] | None = None
        self.occluded_skin = 0.5  # extra skin share of a hole's region that means "hidden"
        self.hidden_template_score = 0.5  # below this (and no peg colour) the hole is covered
        self.column_seen_fraction = 0.15  # a column this peg-coloured is a standing peg, seen or not in full
        self._skin_base: list[float] = []  # skin share per hole on the empty board
        self._disc_cache: dict[tuple, np.ndarray] = {}
        self._last_occ: list[bool] | None = None
        self.normalise = normalise
        self.paper_kernel_mm = paper_kernel_mm
        self.max_peg_len_mm = max_peg_len_mm
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
        canon = cv2.warpPerspective(
            frame_bgr, H, (self.canonical_w, self.canonical_h), flags=cv2.INTER_LINEAR
        )
        self._cal = cal
        if self.normalise:
            canon = normalise_to_paper(canon, self.px_per_mm, self.paper_kernel_mm)
        return canon

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
        self._geom = None
        self._skin_base = []
        self._last_occ = None

    # ---- height-aware regions (section 5 of the module docstring) ---------------------------
    def seat_geometry(self) -> dict[str, Any] | None:
        """Per hole: seat-column and footprint masks (canonical px) and, for every pair, the share
        of hole k's disc inside hole j's footprint. Recomputed only when a projected end moves by
        more than half a pixel (the camera model changes slowly)."""
        cal = self._cal
        if cal is None or cal.camera is None or self._holes is None:
            return None
        centres = np.array([self.canonical_to_mm((h.x, h.y)) for h in self._holes], np.float64)
        zs = (*self.column_z_mm, *self.footprint_z_mm)
        ends = [cal.lift_to_sheet_mm(centres, z) for z in zs]  # 4 x (n, 2) mm
        ends_px = np.array([[self.mm_to_canonical((float(p[0]), float(p[1]))) for p in e] for e in ends])
        if self._geom is not None and np.abs(self._geom["ends_px"] - ends_px).max() <= 1.0:
            return self._geom  # within 1 px (1/3 mm): the regions have not moved
        shape = (self.canonical_h, self.canonical_w)
        n = len(self._holes)

        def capsule(a: np.ndarray, b: np.ndarray, r_mm: float) -> np.ndarray:
            m = np.zeros(shape, np.uint8)
            t = max(1, int(round(2 * r_mm * self.px_per_mm)))
            cv2.line(m, (int(round(a[0])), int(round(a[1]))), (int(round(b[0])), int(round(b[1]))), 255, t, cv2.LINE_8)
            return np.flatnonzero(m)

        columns = [capsule(ends_px[0, k], ends_px[1, k], self.column_r_mm) for k in range(n)]
        footprints = [capsule(ends_px[2, k], ends_px[3, k], self.footprint_r_mm) for k in range(n)]
        any_foot = np.zeros(shape[0] * shape[1], bool)
        overlap = np.zeros((n, n))
        for j in range(n):
            foot = np.zeros(shape[0] * shape[1], bool)
            foot[footprints[j]] = True
            any_foot |= foot
            for k, h in enumerate(self._holes):
                if j != k:
                    overlap[k, j] = float(foot[self._disc_idx(h)].mean())
        self._geom = {"ends_px": ends_px, "columns": columns, "footprints": footprints,
                      "any_footprint": any_foot.reshape(shape), "disc_in_footprint": overlap}
        return self._geom

    def _disc_idx(self, h: Hole) -> np.ndarray:
        """Flat canonical indices of hole h's disc (cached per hole position)."""
        key = (h.index, round(h.x, 2), round(h.y, 2))
        idx = self._disc_cache.get(key)
        if idx is None:
            d = np.zeros((self.canonical_h, self.canonical_w), np.uint8)
            cv2.circle(d, (int(round(h.x)), int(round(h.y))), int(round(self.hole_radius_px)), 255, -1)
            idx = self._disc_cache[key] = np.flatnonzero(d)
        return idx

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
        skin = self.skin_mask(canonical_bgr)
        self._skin_base = [self._disc_fraction(skin, h) for h in self._holes]

    def _patch(self, gray: np.ndarray, h: Hole) -> np.ndarray | None:
        m = self.template_half_px
        x0, y0 = int(round(h.x)) - m, int(round(h.y)) - m
        if x0 < 0 or y0 < 0 or x0 + 2 * m + 1 > gray.shape[1] or y0 + 2 * m + 1 > gray.shape[0]:
            return None
        return gray[y0 : y0 + 2 * m + 1, x0 : x0 + 2 * m + 1]

    def _disc_fraction(self, mask: np.ndarray, h: Hole) -> float:
        if mask.shape[:2] == (self.canonical_h, self.canonical_w):
            idx = self._disc_idx(h)
            return float(mask.ravel()[idx].mean() / 255.0) if idx.size else 0.0
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

    def skin_mask(self, canonical_bgr: np.ndarray) -> np.ndarray:
        hsv = cv2.cvtColor(canonical_bgr, cv2.COLOR_BGR2HSV)
        return cv2.inRange(hsv, np.array(SKIN_HSV_LO, np.uint8), np.array(SKIN_HSV_HI, np.uint8))

    # ---- pegs -----------------------------------------------------------------------------
    def peg_mask(self, canonical_bgr: np.ndarray, colour_range: Any = "current") -> np.ndarray:
        """`colour_range`: "current", None (the default saturated band) or a window to test."""
        rng = self.colour_range if isinstance(colour_range, str) else colour_range
        hsv = cv2.cvtColor(canonical_bgr, cv2.COLOR_BGR2HSV)
        if rng is None:
            mask = cv2.inRange(hsv, self.peg_hsv_lo, self.peg_hsv_hi)
            skin_excluded = True
        else:
            mask = hue_window_mask(hsv, rng)
            skin_excluded = bool(rng["skin_excluded"])
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
        self, canonical_bgr: np.ndarray, exclude_mm: Sequence[RectMM] | None = None, colour_range: Any = "current"
    ) -> list[tuple[float, float, float]]:
        """(x, y, area) in canonical px for every peg-coloured blob above a minimum area and no
        longer than `max_peg_len_mm` (a peg lying on its side is ~32 mm; a pen or a phone is not
        a peg), outside the excluded (hand) rectangles."""
        mask = self._exclude(self.peg_mask(canonical_bgr, colour_range), exclude_mm)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = (self.px_per_mm * 2.0) ** 2
        max_len = self.max_peg_len_mm * self.px_per_mm
        blobs = []
        for c in contours:
            a = cv2.contourArea(c)
            if a < min_area or max(cv2.minAreaRect(c)[1]) > max_len:
                continue
            m = cv2.moments(c)
            blobs.append((m["m10"] / m["m00"], m["m01"] / m["m00"], a))
        return blobs

    def hole_scores(self, canonical_bgr: np.ndarray) -> list[dict[str, float]]:
        holes = self.detect_holes(canonical_bgr)
        mask = self.peg_mask(canonical_bgr)
        gray = cv2.cvtColor(canonical_bgr, cv2.COLOR_BGR2GRAY)
        assert self._template_mask is not None
        geom = self.seat_geometry()
        skin = self.skin_mask(canonical_bgr)
        out = []
        for h in holes:
            frac = self._disc_fraction(mask, h)
            score = None
            tpl = self._templates[h.index] if h.index < len(self._templates) else None
            patch = self._patch(gray, h)
            if tpl is not None and patch is not None and patch.shape == tpl.shape:
                res = cv2.matchTemplate(patch, tpl, cv2.TM_CCOEFF_NORMED, mask=self._template_mask)
                score = float(np.nan_to_num(res[0, 0]))
            col = None
            skin_frac = self._disc_fraction(skin, h)
            if geom is not None and geom["columns"][h.index].size:
                region = geom["columns"][h.index]
                col = float(mask.ravel()[region].mean() / 255.0)
                skin_frac = max(skin_frac, float(skin.ravel()[region].mean() / 255.0))
            base = self._skin_base[h.index] if h.index < len(self._skin_base) else 0.0
            # Covered, not empty: the hole no longer looks like its empty template and no peg
            # colour explains it (a large hand is normalised to "paper" in this view, so the
            # skin share alone misses it).
            half = self.column_occupied_fraction / 2
            covered = (
                score is not None and score < self.hidden_template_score
                and frac < max(0.0, self.occupied_fraction - self.tie_zone)
                and (col is None or col < half)
            )
            # A column only partly peg-coloured (fingers over a seated peg, or a peg going in)
            # cannot say either way: hold the last decision rather than flip.
            # A disc clearly full of peg colour (a flat or near-overhead peg) is evidence enough.
            covered = covered or (
                col is not None and half <= col < self.column_occupied_fraction
                and frac < self.occupied_fraction + self.tie_zone
            )
            out.append(
                {
                    "peg_fraction": round(frac, 4),
                    "empty_template_score": None if score is None else round(score, 4),
                    "column_fraction": None if col is None else round(col, 4),
                    "hidden": bool(skin_frac - base >= self.occluded_skin or covered),
                }
            )
        return out

    def decide(self, scores: list[dict[str, Any]]) -> list[bool]:
        """Occupied per hole: the seat column first, then the disc rule unless the disc is
        explained by another hole's standing peg (module docstring, section 5)."""
        col_occ = [s.get("column_fraction") is not None and s["column_fraction"] >= self.column_occupied_fraction for s in scores]
        # a standing peg, even one only partly segmented (dim light), casts its streak forwards
        col_seen = [s.get("column_fraction") is not None and s["column_fraction"] >= self.column_seen_fraction for s in scores]
        geom = self._geom if self._cal is not None and self._cal.camera is not None else None
        out = []
        for k, s in enumerate(scores):
            if col_occ[k]:
                out.append(True)
            elif s.get("hidden") and self._last_occ is not None and k < len(self._last_occ):
                out.append(self._last_occ[k])  # a hand over the hole: hidden is not a change
            elif geom is not None and any(
                col_seen[j] and geom["disc_in_footprint"][k, j] >= self.disc_in_footprint
                for j in range(len(scores)) if j != k
            ):
                out.append(False)  # another peg's streak, not a peg in this hole
            else:
                out.append(self._occupied(s))
        self._last_occ = list(out)
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
            f"hole_{k}": "occupied" if occ else "empty"
            for k, occ in enumerate(self.decide(self.hole_scores(canonical_bgr)))
        }

    def free_pegs_mm(
        self, canonical_bgr: np.ndarray, exclude_mm: Sequence[RectMM] | None = None
    ) -> list[tuple[float, float]]:
        holes = self.detect_holes(canonical_bgr)
        near = self.hole_radius_px * 1.5
        geom = self.seat_geometry()
        out = []
        for x, y, _ in self.peg_blobs(canonical_bgr, exclude_mm):
            if not all(np.hypot(x - h.x, y - h.y) > near for h in holes):
                continue
            if geom is not None:
                xi, yi = int(round(x)), int(round(y))
                if 0 <= yi < self.canonical_h and 0 <= xi < self.canonical_w and geom["any_footprint"][yi, xi]:
                    continue  # a peg standing in a hole, seen from an angle
            out.append(self.canonical_to_mm((x, y)))
        return out

    def to_event_payload(
        self, canonical_bgr: np.ndarray, exclude_mm: Sequence[RectMM] | None = None
    ) -> dict[str, Any]:
        holes = self.detect_holes(canonical_bgr)
        scores = self.hole_scores(canonical_bgr)
        return {
            "occupancy": {
                f"hole_{k}": "occupied" if occ else "empty"
                for k, occ in enumerate(self.decide(scores))
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
