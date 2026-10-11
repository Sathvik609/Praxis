"""Waiter – cup: cup base on the printed 5-dot target sheet (OpenCV cv2.__version__ == 5.0.0).

CupSheetState: cv2.warpPerspective to a canonical top-down view of the whole sheet, HSV
segmentation (cv2.inRange) of the cup's blue base band, cv2.findContours -> largest blob ->
centroid + equivalent diameter in mm.

CupFSM: at_dot -> lifted -> in_transit -> over_dot -> placed -> hand_clear (-> at_dot).
A reach is one placement on a different dot. It is `verified` only if calibration held for the
whole reach and the cup base was seen resting on the destination; otherwise it is reported
`unverified` with a reason (marker_lost | cup_occluded). Dots follow ARC (1..5..1); a wrong dot
is reported and the sequence re-anchors. The slow -> fast phase switch is explicit
(set_phase), never automatic: the coach proposes and the patient confirms.

Reach time (11 Oct 2026): `clear_frames` stationary frames confirm a placement, but the
placement is timed at the first frame of that run (`t_placed` in the `placed` state_change), so
reach_ms is lift -> arrival at any frame rate (it was late by clear_frames - 1 frame periods,
+200 ms at 10 fps).

Sprint D-SEG-3: the base colour can be sampled from a tap (sample_cup_colour; the blue band
stays the default), and a placement that was inferred from the hand while the base was hidden
still counts as verified when the base was seen within `dot_radius_mm` of the destination at
any time in the last `rest_window_s` (0.6 s) before hand-clear - a hand from above hides the
base at the moment of release, but the cup is visible again as soon as the fingers open.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import cv2
import numpy as np

from praxis_session.events import Event, make_event
from praxis_session.perception.board import hsv_window_from_patch, hue_window_mask, normalise_to_paper
from praxis_session.perception.board_spec import CUP_TARGETS, SheetSpec
from praxis_session.perception.calibration import CalibrationResult

ARC: list[int] = [0, 1, 2, 3, 4, 3, 2, 1, 0]
Phase = Literal["slow", "fast"]
STATES = ("at_dot", "lifted", "in_transit", "over_dot", "placed", "hand_clear")


def _d(a, b) -> float:
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))


class CupSheetState:
    def __init__(
        self,
        spec: SheetSpec = CUP_TARGETS,
        px_per_mm: float = 2.0,
        cup_hsv_lo: tuple[int, int, int] = (95, 80, 60),
        cup_hsv_hi: tuple[int, int, int] = (130, 255, 255),
        min_diameter_mm: float = 30.0,
        max_aspect: float = 3.0,
        normalise: bool = True,
        paper_kernel_mm: float = 100.0,
        group_mm: float = 40.0,
        max_cup_mm: float = 100.0,
    ) -> None:
        self.spec = spec
        self.max_aspect = max_aspect
        self.group_mm = group_mm
        self.max_cup_mm = max_cup_mm
        self.normalise = normalise
        self.paper_kernel_mm = paper_kernel_mm
        self.px_per_mm = px_per_mm
        self.w, self.h = (
            int(round(spec.width_mm * px_per_mm)),
            int(round(spec.height_mm * px_per_mm)),
        )
        self.lo, self.hi = np.array(cup_hsv_lo, np.uint8), np.array(cup_hsv_hi, np.uint8)
        self.min_diameter_mm = min_diameter_mm
        self.colour_range: dict[str, Any] | None = None  # set by sample_cup_colour
        self._S = np.diag([px_per_mm, px_per_mm, 1.0])

    def warp(self, frame_bgr: np.ndarray, cal: CalibrationResult) -> np.ndarray:
        if not cal.calibrated or cal.H_px_to_mm is None:
            raise RuntimeError("warp requires a calibrated frame")
        canon = cv2.warpPerspective(frame_bgr, self._S @ cal.H_px_to_mm, (self.w, self.h))
        if self.normalise:
            # Paper-referenced white balance + flat field (board.normalise_to_paper); the kernel
            # is wider than the cup base so the base itself is never taken for shading.
            canon = normalise_to_paper(canon, self.px_per_mm, self.paper_kernel_mm)
        return canon

    def sample_cup_colour(
        self, canonical_bgr: np.ndarray, xy_mm: tuple[float, float]
    ) -> dict[str, Any]:
        """Set the cup-base colour window from a 6 mm patch at `xy_mm` (the patient taps the
        cup base); the default blue band applies until then. Returns the range for the trace."""
        centre = (xy_mm[0] * self.px_per_mm, xy_mm[1] * self.px_per_mm)
        rng = hsv_window_from_patch(canonical_bgr, centre, 3.0 * self.px_per_mm)
        self.colour_range = rng
        return rng

    def cup_mask(self, canonical_bgr: np.ndarray, colour_range: Any = "current") -> np.ndarray:
        """`colour_range`: "current" (the sampled window if any, else the default blue band),
        None (the default band) or a window dict to test without applying it (agent resample)."""
        rng = self.colour_range if isinstance(colour_range, str) else colour_range
        hsv = cv2.cvtColor(canonical_bgr, cv2.COLOR_BGR2HSV)
        if rng is None:
            mask = cv2.inRange(hsv, self.lo, self.hi)
        else:
            mask = hue_window_mask(hsv, rng)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        return cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)

    def cup_mm(self, canonical_bgr: np.ndarray, colour_range: Any = "current") -> tuple[float, float, float] | None:
        contours, _ = cv2.findContours(
            self.cup_mask(canonical_bgr, colour_range), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        ppm = self.px_per_mm
        # Fingers gripping the cup split its base band into pieces, none cup-sized on its own
        # (11 Oct 2026 sweep: 55 % visible in three pieces read as "no cup"). So the base is
        # the union of the pieces around a seed: every blob no longer than a cup whose centroid
        # is within `group_mm` of the seed's. The union must still be cup-sized and cup-shaped:
        # the base band seen from a laptop angle warps to a disc or a crescent (aspect <= ~2),
        # while a pen or a ruler of the same colour is a long thin bar and is never the cup.
        blobs = []
        for c in contours:
            a = cv2.contourArea(c)
            if a < (3.0 * ppm) ** 2 or max(cv2.minAreaRect(c)[1]) > self.max_cup_mm * ppm:
                continue
            m = cv2.moments(c)
            blobs.append((a, np.array([m["m10"] / m["m00"], m["m01"] / m["m00"]]), c))
        blobs.sort(key=lambda b: -b[0])
        for _, seed, _ in blobs:
            group = [b for b in blobs if float(np.linalg.norm(b[1] - seed)) <= self.group_mm * ppm]
            area = sum(b[0] for b in group)
            diameter_mm = 2 * np.sqrt(area / np.pi) / ppm
            if diameter_mm < self.min_diameter_mm:
                continue
            if not self._cup_shaped(np.concatenate([b[2] for b in group])):
                continue
            centre = sum(b[0] * b[1] for b in group) / area
            return (float(centre[0]) / ppm, float(centre[1]) / ppm, float(diameter_mm))
        return None

    def _cup_shaped(self, contour: np.ndarray) -> bool:
        (_, _), (a, b), _ = cv2.minAreaRect(contour)
        return min(a, b) > 0 and max(a, b) / min(a, b) <= self.max_aspect

    def dots_frame_px(self, cal: CalibrationResult) -> list[list[float]]:
        if not cal.calibrated:
            return []
        return np.round(cal.to_px(np.array(self.spec.targets_mm, np.float32)), 1).tolist()


@dataclass(frozen=True)
class CupObservation:
    t: float
    cup_mm: tuple[float, float, float] | tuple[float, float] | None
    hand_mm: tuple[float, float] | None
    calibrated: bool


class CupFSM:
    def __init__(
        self,
        spec: SheetSpec = CUP_TARGETS,
        dot_radius_mm: float = 25.0,
        lift_mm: float = 20.0,
        clear_frames: int = 3,
        stationary_mm: float = 4.0,
        hand_clear_mm: float = 60.0,
        slow_arcs: int = 2,
        fast_arcs: int = 2,
        rest_window_s: float = 0.6,
    ) -> None:
        self.spec = spec
        self.dots = [tuple(map(float, d)) for d in spec.targets_mm]
        self.dot_radius_mm, self.lift_mm = dot_radius_mm, lift_mm
        self.clear_frames = max(1, clear_frames)
        self.stationary_mm, self.hand_clear_mm = stationary_mm, hand_clear_mm
        self.slow_arcs, self.fast_arcs = slow_arcs, fast_arcs
        self.rest_window_s = rest_window_s
        self._rest_seen_t: float | None = None  # last t the base was seen on the destination
        self.state = "at_dot"
        self.dot: int | None = None
        self.phase: Phase = "slow"
        self.arcs_done = 0
        self.finished = False
        self.reaches: list[dict[str, Any]] = []
        self._seq_idx = 0
        self._t_lift = 0.0
        self._t_placed = 0.0
        self._settle_t = 0.0  # first frame of the current stationary run on the destination
        self._src: int | None = None
        self._dst: int | None = None
        self._lost = False
        self._occluded = False
        self._count = 0
        self._last_cup: tuple[float, float] | None = None
        self._arc_reaches: list[dict[str, Any]] = []
        self.arc_means_ms: list[float | None] = []
        self._dots_in_arc: set[int] = set()

    # ---- public --------------------------------------------------------------------------
    @property
    def expected_next(self) -> int | None:
        if self.finished or self._seq_idx + 1 >= len(ARC):
            return None
        return ARC[self._seq_idx + 1]

    @property
    def awaiting_phase(self) -> bool:
        return self.phase == "slow" and self.arcs_done >= self.slow_arcs and not self.finished

    def set_phase(self, phase: str) -> None:
        if phase not in ("slow", "fast"):
            raise ValueError(f"bad phase {phase}")
        self.phase = phase  # type: ignore[assignment]

    def snapshot(self) -> dict[str, Any]:
        return {
            "mode": "cup",
            "state": self.state,
            "dot": self.dot,
            "phase": self.phase,
            "arcs_done": self.arcs_done,
            "arc_index": min(self.arcs_done + 1, self.slow_arcs + self.fast_arcs),
            "arcs_planned": {"slow": self.slow_arcs, "fast": self.fast_arcs},
            "expected_next": self.expected_next,
            "dots_in_arc": sorted(self._dots_in_arc),
            "reaches_total": len(self.reaches),
            "unverified_total": sum(1 for r in self.reaches if not r["verified"]),
            "awaiting_phase": self.awaiting_phase,
            "finished": self.finished,
            "arc_means_ms": list(self.arc_means_ms),
        }

    def step(self, obs: CupObservation) -> list[Event]:
        if self.finished:
            return []
        if not obs.calibrated and self.state != "at_dot":
            self._lost = True
        cup = None if obs.cup_mm is None else (float(obs.cup_mm[0]), float(obs.cup_mm[1]))
        handler = getattr(self, f"_in_{self.state}")
        evs: list[Event] = handler(obs, cup)
        self._last_cup = cup
        return evs

    # ---- helpers -------------------------------------------------------------------------
    def _near_dot(self, p: tuple[float, float] | None, exclude: int | None = None) -> int | None:
        if p is None:
            return None
        best, bd = None, self.dot_radius_mm
        for k, d in enumerate(self.dots):
            if k == exclude:
                continue
            dist = _d(p, d)
            if dist <= bd:
                best, bd = k, dist
        return best

    def _go(self, to: str, t: float, **extra: Any) -> Event:
        ev = make_event(
            "state_change", t=t, **{"from": self.state, "to": to, "dot": self.dot, **extra}
        )
        self.state = to
        return ev

    # ---- states --------------------------------------------------------------------------
    def _in_at_dot(self, obs: CupObservation, cup) -> list[Event]:
        if self.dot is None:
            k = self._near_dot(cup)
            if k is not None:
                self.dot = k
                self._seq_idx = ARC.index(k)
                self._dots_in_arc.add(k)
            return []
        src = self.dots[self.dot]
        if cup is None or _d(cup, src) > self.lift_mm:
            self._t_lift, self._src, self._dst = obs.t, self.dot, None
            self._lost, self._occluded, self._count = not obs.calibrated, False, 0
            return [self._go("lifted", obs.t)]
        return []

    def _in_lifted(self, obs: CupObservation, cup) -> list[Event]:
        assert self._src is not None
        src = self.dots[self._src]
        if cup is not None and _d(cup, src) <= self.lift_mm:
            return [self._go("at_dot", obs.t)]  # false lift
        k = self._near_dot(cup, exclude=self._src)
        if k is not None:
            return self._enter_over(obs, k, occluded=False)
        if cup is None:
            hk = self._near_dot(obs.hand_mm, exclude=self._src)
            if hk is not None:
                return self._enter_over(obs, hk, occluded=True)
            return []
        return [self._go("in_transit", obs.t)]

    def _in_in_transit(self, obs: CupObservation, cup) -> list[Event]:
        k = self._near_dot(cup, exclude=self._src)
        if k is not None:
            return self._enter_over(obs, k, occluded=False)
        if cup is None:
            hk = self._near_dot(obs.hand_mm, exclude=self._src)
            if hk is not None:
                return self._enter_over(obs, hk, occluded=True)
        return []

    def _enter_over(self, obs: CupObservation, k: int, occluded: bool) -> list[Event]:
        self._dst, self._occluded, self._count = k, occluded, 1
        self._settle_t = obs.t
        self._rest_seen_t = None if occluded else obs.t
        evs = [self._go("over_dot", obs.t, to_dot=k)]
        return evs + self._maybe_place(obs)

    def _in_over_dot(self, obs: CupObservation, cup) -> list[Event]:
        assert self._dst is not None
        dst = self.dots[self._dst]
        if cup is not None:
            if _d(cup, dst) > self.dot_radius_mm:
                self._count = 0
                return [self._go("in_transit", obs.t)]
            moved = self._last_cup is not None and _d(cup, self._last_cup) > self.stationary_mm
            self._count = 1 if moved else self._count + 1
            if self._count == 1:
                self._settle_t = obs.t
            self._occluded = False
            self._rest_seen_t = obs.t
        else:
            if obs.hand_mm is not None and _d(obs.hand_mm, dst) <= self.dot_radius_mm:
                self._count += 1
                if self._count == 1:
                    self._settle_t = obs.t
                self._occluded = True
            else:
                self._count = 0
        return self._maybe_place(obs)

    def _maybe_place(self, obs: CupObservation) -> list[Event]:
        if self._count >= self.clear_frames:
            self._t_placed, self._count = self._settle_t, 0
            return [self._go("placed", obs.t, to_dot=self._dst, t_placed=self._t_placed)]
        return []

    def _in_placed(self, obs: CupObservation, cup) -> list[Event]:
        assert self._dst is not None
        dst = self.dots[self._dst]
        if cup is not None and _d(cup, dst) > self.dot_radius_mm:
            return [self._go("in_transit", obs.t)]  # picked up again before clearing
        if cup is not None:
            self._rest_seen_t = obs.t  # base seen resting on the dot while the hand lets go
        if obs.hand_mm is None or _d(obs.hand_mm, dst) > self.hand_clear_mm:
            self._count += 1
        else:
            self._count = 0
        if self._count >= self.clear_frames:
            evs = [self._go("hand_clear", obs.t)]
            return evs + self._complete_reach(obs)
        return []

    def _in_hand_clear(self, obs: CupObservation, cup) -> list[Event]:
        return [self._go("at_dot", obs.t)]

    def _complete_reach(self, obs: CupObservation) -> list[Event]:
        assert self._dst is not None and self._src is not None
        seen_resting = (
            self._rest_seen_t is not None and (obs.t - self._rest_seen_t) <= self.rest_window_s
        )
        occluded = self._occluded and not seen_resting
        reason = "marker_lost" if self._lost else ("cup_occluded" if occluded else None)
        expected = self.expected_next
        evs: list[Event] = []
        if expected is not None and self._dst != expected:
            evs.append(make_event("wrong_dot", t=obs.t, dot=self._dst, expected=expected))
            later = [i for i, d in enumerate(ARC) if d == self._dst and i > self._seq_idx]
            self._seq_idx = later[0] if later else ARC.index(self._dst)
        else:
            self._seq_idx += 1
        reach = {
            "rep": len(self.reaches) + 1,
            "from_dot": self._src,
            "to_dot": self._dst,
            "reach_ms": round((self._t_placed - self._t_lift) * 1000.0, 1),
            "verified": reason is None,
            "reason": reason,
            "arc": self.arcs_done + 1,
            "phase": self.phase,
            "t_lift": self._t_lift,
            "t_placed": self._t_placed,
            "t_clear": obs.t,
        }
        self.reaches.append(reach)
        self._arc_reaches.append(reach)
        self._dots_in_arc.add(self._dst)
        evs.append(make_event("reach_complete", t=obs.t, **reach))
        self.dot, self._src, self._dst = self._dst, None, None
        if self._seq_idx >= len(ARC) - 1:
            self.arcs_done += 1
            valid = [r["reach_ms"] for r in self._arc_reaches if r["verified"]]
            mean_ms = round(sum(valid) / len(valid), 1) if valid else None
            self.arc_means_ms.append(mean_ms)
            evs.append(
                make_event(
                    "arc_complete",
                    t=obs.t,
                    arc=self.arcs_done,
                    phase=self.phase,
                    mean_reach_ms=mean_ms,
                    unverified=sum(1 for r in self._arc_reaches if not r["verified"]),
                    reaches=len(self._arc_reaches),
                    awaiting_phase=self.awaiting_phase,
                )
            )
            self._seq_idx, self._arc_reaches, self._dots_in_arc = 0, [], {self.dot}
            if self.arcs_done >= self.slow_arcs + self.fast_arcs:
                self.finished = True
                evs.append(
                    make_event(
                        "cup_complete", t=obs.t, arcs=self.arcs_done, reaches=list(self.reaches)
                    )
                )
        evs.append(self._go("at_dot", obs.t))
        return evs
