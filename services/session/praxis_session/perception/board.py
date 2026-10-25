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
6. Uncoloured pegs (24 Oct 2026, team test). Wooden, white and grey pegs carry no colour the
                   window above can use (natural wood even sits inside the skin band), and the
                   team's real session logged `pegs_detected: 0`. When the holes are first found
                   the empty board is kept as a reference (NHPT starts with every hole empty), and
                   the peg mask also takes every pixel that differs from it (max channel
                   cv2.absdiff >= `change_threshold`, after a small blur). The change is measured
                   on the warped view BEFORE paper normalisation (which flattens a hand into
                   "paper" and leaves only the hole rings it covers), with each channel scaled
                   by the ratio of its median to the reference's so exposure drift is not change.
                   cv2.connectedComponentsWithStats splits that change: a component with more
                   than `occluder_area_mm2` (several pegs' worth) OUTSIDE the holes' peg
                   footprints is a hand or forearm (nine seated pegs at 45 deg merge into one
                   component, but it lies inside their footprints), so it is the **occluder**
                   mask, never pegs; a hole whose disc or column it covers is
                   hidden and keeps its last decision, and the skin rule below only hides a hole
                   while an occluder is there (a seated wooden peg is skin-coloured itself).
                   Coloured pegs read exactly as before; the change only adds what colour misses
                   (tests/test_uncoloured_pegs.py).
                   Round 2 (same day, a real session counted nine pegs for one: fingertips and
                   their shadows changed the board too): a hole filled by change alone (no peg
                   colour) counts only once the board has been **quiet** for `quiet_frames` frames
                   running (no occluder, and less than `stray_area_mm2` of the change appeared or
                   went since the last frame: a resting peg does not move, fingers and shadows do);
                   change that lies mostly (`stray_outside_frac`) outside the footprints never makes
                   a NEW seat (still fingertips and their shadow; a seated peg they touch stays);
                   loose pegs (lifts, drops) come from colour only.
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
    paper = paper_field(canonical_bgr, px_per_mm, kernel_mm)
    return cv2.divide(canonical_bgr, paper, scale=PAPER_LEVEL)  # saturating uint8


def paper_field(canonical_bgr: np.ndarray, px_per_mm: float, kernel_mm: float) -> np.ndarray:
    """The paper's own brightness at every point (normalise_to_paper's divisor)."""
    h, w = canonical_bgr.shape[:2]
    cell_mm = max(PAPER_CELL_MM, kernel_mm / 15.0)  # ~15 cells across the kernel keeps it cheap
    step = max(1, int(round(px_per_mm * cell_mm)))
    small = cv2.resize(canonical_bgr, (max(1, w // step), max(1, h // step)), interpolation=cv2.INTER_AREA)
    k = max(3, int(round(kernel_mm / cell_mm)) | 1)
    # A rectangular element is separable (fast) and, for a smooth light field, as good as a disc.
    paper = cv2.morphologyEx(small, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    paper = cv2.blur(paper, (3, 3))
    paper = cv2.resize(paper, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.max(paper, np.full_like(paper, int(PAPER_FLOOR)))


class EmptyReference:
    """The empty board or sheet as the camera saw it at the start (blurred, before paper
    normalisation) and its own paper level, for change detection (module docstring, section 6;
    also the cup sheet, cup.py). `changed()` is max-channel cv2.absdiff >= threshold after
    matching each channel's median to the reference's (exposure drift is not change), minus
    ghosts: where the reference had something (ink, a peg in the dish) and bare paper now shows,
    removal is not an object. Paper is every channel within -20 % / +15 % of the reference's
    paper level, which a bright object added later cannot raise."""

    def __init__(self, raw_bgr: np.ndarray, px_per_mm: float, kernel_mm: float) -> None:
        self.ref = cv2.GaussianBlur(raw_bgr, (3, 3), 0)
        self._ref_f = self.ref.astype(np.float32)
        self._med = np.median(self._ref_f.reshape(-1, 3), axis=0)
        self._paper = paper_field(self.ref, px_per_mm, kernel_mm).astype(np.float32)
        self._obj = ~self._paper_like(self._ref_f)

    @property
    def shape(self) -> tuple[int, ...]:
        return self.ref.shape

    def _paper_like(self, bgr: np.ndarray) -> np.ndarray:
        ratio = bgr / self._paper
        return ((ratio >= 0.8) & (ratio <= 1.15)).all(axis=2)

    def changed(self, raw_bgr: np.ndarray, threshold: float) -> np.ndarray:
        cur = cv2.GaussianBlur(raw_bgr, (3, 3), 0).astype(np.float32)
        cur_med = np.median(cur.reshape(-1, 3), axis=0)
        cur = np.clip(cur * (self._med / np.maximum(cur_med, 1.0)), 0, 255)
        out = np.abs(cur - self._ref_f).max(axis=2) >= threshold
        return out & ~(self._obj & self._paper_like(cur))


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
        change_threshold: int = 38,
        occluder_area_mm2: float = 700.0,
        stray_area_mm2: float = 60.0,
        quiet_frames: int = 3,
    ) -> None:
        self.spec = spec
        self.change_threshold = change_threshold
        self.occluder_area_mm2 = occluder_area_mm2
        # section 6: change outside the peg footprints bigger than this (fingertips, a hand's
        # shadow) means the board is not quiet; a peg seen by change alone needs `quiet_frames`
        self.stray_area_mm2 = stray_area_mm2
        self.stray_outside_frac = 0.4
        self._stray_mask: np.ndarray | None = None
        self.quiet_frames = quiet_frames
        self._stray = False
        self._prev_changed: np.ndarray | None = None
        self._change_frame: np.ndarray | None = None
        self._frame_quiet = True
        self._quiet_run = 0
        self._change_run: list[int] = []
        self._ref: EmptyReference | None = None  # the empty board, section 6
        self._raw: np.ndarray | None = None  # the last warp before paper normalisation
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
        self._raw = canon
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
        self._ref = None
        self._quiet_run = 0
        self._change_run = []
        self._prev_changed = None
        self._change_frame = None

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
        raw = self._raw if self._raw is not None and self._raw.shape == canonical_bgr.shape else canonical_bgr
        self._ref = EmptyReference(raw, self.px_per_mm, self.paper_kernel_mm)  # section 6

    def change_masks(self, canonical_bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
        """(peg-sized change, occluder) against the empty board, or None before it exists."""
        if self._ref is None or self._ref.shape != canonical_bgr.shape:
            return None
        raw = self._raw if self._raw is not None and self._raw.shape == canonical_bgr.shape else canonical_bgr
        changed = self._ref.changed(raw, self.change_threshold)
        changed = changed.astype(np.uint8) * 255
        changed = cv2.morphologyEx(changed, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
        n, labels, stats, _ = cv2.connectedComponentsWithStats(changed, connectivity=8)
        big = self.occluder_area_mm2 * self.px_per_mm**2
        large = np.zeros(n, bool)
        # Area outside where seated pegs stand: the footprints, or discs of 1.5 r without
        # a camera model. Nine pegs at 45 deg touch, but stay inside their footprints.
        geom = self.seat_geometry()
        if geom is not None:
            seat = geom["any_footprint"]
        else:
            disc = np.zeros(changed.shape, np.uint8)
            for h in self._holes or []:
                cv2.circle(disc, (int(round(h.x)), int(round(h.y))), int(round(1.5 * self.hole_radius_px)), 255, -1)
            seat = disc > 0
        outside = np.bincount(labels[~seat], minlength=n)
        outside[0] = 0
        cand = np.flatnonzero(stats[:, cv2.CC_STAT_AREA] > big)
        cand = cand[cand > 0]
        large[cand] = outside[cand] > big
        # Something moving (fingertips, a hand's shadow): more than `stray_area_mm2` of change
        # appeared or went since the last frame. A peg resting anywhere does not move.
        if self._change_frame is not raw:  # once per frame (change_masks runs more than once)
            k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            prev = self._prev_changed
            moved = None if prev is None or prev.shape != changed.shape else cv2.morphologyEx(cv2.bitwise_xor(prev, changed), cv2.MORPH_OPEN, k3)
            self._stray = moved is None or int(np.count_nonzero(moved)) > self.stray_area_mm2 * self.px_per_mm**2
            self._prev_changed, self._change_frame = changed, raw
        if large.any():
            # fingertips the threshold split off the hand: small pieces within 4 mm of it
            k = max(3, int(round(8 * self.px_per_mm)) | 1)
            near = cv2.dilate(np.where(large[labels], 255, 0).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
            touching = np.unique(labels[(near > 0) & (labels > 0)])
            large[touching] = True
        occluder = np.where(large[labels], 255, 0).astype(np.uint8)
        # Mostly outside the footprints and not a hand: fingertips or their shadow, never a peg
        # (deep run 24 Oct: frozen fingertips over an empty hole read as a seated peg). A seated
        # peg's change lies inside its own footprint.
        area = np.maximum(stats[:, cv2.CC_STAT_AREA], 1)
        stray = (~large) & (outside > self.stray_outside_frac * area)
        stray[0] = False
        # kept apart, not removed: a seated peg the fingers touch merges with them and must
        # stay seated; the stray share only stops a NEW seat (_gate_change_only)
        self._stray_mask = np.where(stray[labels], 255, 0).astype(np.uint8)
        return cv2.bitwise_and(changed, cv2.bitwise_not(occluder)), occluder

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
    def peg_mask(self, canonical_bgr: np.ndarray, colour_range: Any = "current", include_change: bool = True) -> np.ndarray:
        """`colour_range`: "current", None (the default saturated band) or a window to test.
        `include_change` False: colour only (loose pegs, section 6)."""
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
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))  # 1.7 mm: wood-grain specks go
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        change = self.change_masks(canonical_bgr) if include_change else None
        if change is not None:  # section 6: what colour misses (wooden, white, grey pegs)
            mask = cv2.bitwise_and(cv2.bitwise_or(mask, change[0]), cv2.bitwise_not(change[1]))
        return mask

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
        # colour only: change alone is a moving hand as often as a dropped peg (section 6)
        mask = self._exclude(self.peg_mask(canonical_bgr, colour_range, include_change=False), exclude_mm)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = (self.px_per_mm * 5.0) ** 2  # 25 mm2: a peg's top alone is ~40; specks are not pegs
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
        change = self.change_masks(canonical_bgr)
        occluder = None if change is None else change[1]
        colour = None if change is None else self.peg_mask(canonical_bgr, include_change=False)
        self._frame_quiet = change is None or (not self._stray and not occluder.any())
        out = []
        for h in holes:
            frac = self._disc_fraction(mask, h)
            colour_seen = False
            stray_share = 0.0
            if self._stray_mask is not None and change is not None:
                stray_share = self._disc_fraction(self._stray_mask, h)
                if geom is not None and geom["columns"][h.index].size:
                    stray_share = max(stray_share, float(self._stray_mask.ravel()[geom["columns"][h.index]].mean() / 255.0))
            if colour is not None:
                colour_seen = self._disc_fraction(colour, h) >= self.occupied_fraction
                if geom is not None and geom["columns"][h.index].size:
                    colour_seen = colour_seen or float(colour.ravel()[geom["columns"][h.index]].mean() / 255.0) >= self.column_occupied_fraction
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
            occl = 0.0
            if occluder is not None:
                occl = self._disc_fraction(occluder, h)
                if geom is not None and geom["columns"][h.index].size:
                    occl = max(occl, float(occluder.ravel()[geom["columns"][h.index]].mean() / 255.0))
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
                    "colour_seen": colour_seen,
                    "stray_share": round(stray_share, 4),
                    # with the empty board known, skin hides a hole only while an occluder is
                    # there (a seated wooden peg is skin-coloured itself), section 6
                    "hidden": bool(
                        (skin_frac - base >= self.occluded_skin and (occluder is None or occl >= 0.15))
                        or covered
                        or occl >= 0.3
                    ),
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
            elif s.get("hidden") and self._ref is not None:
                out.append(False)  # covered before any decision: a peg not seen is not counted
            elif geom is not None and any(
                col_seen[j] and geom["disc_in_footprint"][k, j] >= self.disc_in_footprint
                for j in range(len(scores)) if j != k
            ):
                out.append(False)  # another peg's streak, not a peg in this hole
            else:
                out.append(self._occupied(s))
        if self._ref is not None:
            out = self._gate_change_only(scores, out)
        self._last_occ = list(out)
        return out

    def _gate_change_only(self, scores: list[dict[str, Any]], out: list[bool]) -> list[bool]:
        """A hole newly filled by change alone (no peg colour) counts only after the board has
        been quiet for `quiet_frames` frames running with it filled (section 6): a seated peg
        stays when the hand has gone, fingertips and shadows move on."""
        self._quiet_run = self._quiet_run + 1 if self._frame_quiet else 0
        if len(self._change_run) != len(out):
            self._change_run = [0] * len(out)
        last = self._last_occ if self._last_occ is not None and len(self._last_occ) == len(out) else [False] * len(out)
        for k, s in enumerate(scores):
            if out[k] and not last[k] and not s.get("colour_seen"):
                # fingertips or their shadow over the hole (change mostly off the footprints)
                fingers = s.get("stray_share", 0.0) >= 0.3
                self._change_run[k] = self._change_run[k] + 1 if self._frame_quiet and not fingers else 0
                if self._quiet_run < self.quiet_frames or self._change_run[k] < self.quiet_frames:
                    out[k] = False
            else:
                self._change_run[k] = 0
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
