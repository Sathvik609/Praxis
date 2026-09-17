"""Peg finite-state machine (NHPT any-hole mode; ordered targets kept for tests only).

States: at_source -> grasped -> in_transit -> over_target -> seated -> hand_clear (-> at_source).
Inputs are Observations built from BoardState output (occupancy, free pegs in mm) plus the
hand model's thumb/index midpoint, pinch aperture and a "hand in the source zone" flag.
Transitions are gated on debounced occupancy deltas and free-peg / hand proximity. Emits
Events: state_change, rep_complete, wrong_hole, drop. No frames are touched here;
cv2.__version__ == 5.0.0 upstream (board.py).

Sprint D-SEG-2:
- grasp fires when the free-peg count drops (pegs on the sheet) OR when the pinch aperture is
  <= `pinch_grasp_mm` (25 mm, sheet-plane projection) while the hand is in the source zone for
  two consecutive observations - so pegs lifted from a dish, where no free peg is ever visible,
  still start the timer (`state_change.grasp` = "count" | "pinch");
- seating is hand-gated: once hand data has been seen in the session, a hole that fills without
  the hand having been within `hand_gate_mm` (30 mm) of it in the last `hand_gate_s` (0.5 s) is
  still counted but its rep_complete carries verified=False, reason="no_hand_near_hole"
  (unverified is not failed: CLAUDE.md §1). Without any hand data reps stay verified=True.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from praxis_session.events import Event, make_event
from praxis_session.perception.board_spec import NHPT_BOARD, SheetSpec

STATES = ("at_source", "grasped", "in_transit", "over_target", "seated", "hand_clear")


@dataclass(frozen=True)
class Observation:
    t: float
    occupancy: dict[str, str]
    free_pegs_mm: list[tuple[float, float]] = field(default_factory=list)
    hand_mm: tuple[float, float] | None = None
    pinch_mm: float | None = None  # thumb-index aperture, sheet-plane projection (relative)
    hand_in_source_zone: bool = False  # hand within 40 mm of the dish zone or of a free peg


def _dist(a: Sequence[float], b: Sequence[float]) -> float:
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))


class PegFSM:
    def __init__(
        self,
        targets: list[int] | None,
        spec: SheetSpec = NHPT_BOARD,
        debounce_frames: int = 2,
        clear_frames: int = 3,
        drop_after_s: float = 1.5,
        drop_after_hand_s: float = 0.3,
        near_mm: float = 10.0,
        transit_mm: float = 20.0,
        clear_mm: float = 25.0,
        peg_clear_mm: float = 15.0,
        stationary_mm: float = 2.0,
        pinch_grasp_mm: float = 25.0,
        pinch_frames: int = 2,
        hand_gate_mm: float = 30.0,
        hand_gate_s: float = 0.5,
    ) -> None:
        self.spec = spec
        self.targets = list(targets) if targets is not None else None
        self.debounce_frames = max(1, debounce_frames)
        self.clear_frames = max(1, clear_frames)
        self.drop_after_s = drop_after_s
        self.drop_after_hand_s = drop_after_hand_s
        self.near_mm = near_mm
        self.transit_mm = transit_mm
        self.clear_mm = clear_mm
        self.peg_clear_mm = peg_clear_mm
        self.stationary_mm = stationary_mm
        self.pinch_grasp_mm = pinch_grasp_mm
        self.pinch_frames = max(1, pinch_frames)
        self.hand_gate_mm = hand_gate_mm
        self.hand_gate_s = hand_gate_s
        self._pinch_streak = 0
        self._hand_ever = False
        self._hand_near_t: dict[int, float] = {}  # hole -> last t the hand was within the gate
        self._seat_verified = True
        self._seat_reason: str | None = None

        self.state = "at_source"
        self.reps = 0
        self.finished = False
        self._target_idx = 0
        self._stable: dict[int, bool] = {}
        self._raw_streak: dict[int, tuple[bool, int]] = {}
        self._last_free: list[tuple[float, float]] = []
        self._baseline_free = 0
        self._source_pos: tuple[float, float] | None = None
        self._t_grasp = 0.0
        self._t_seated = 0.0
        self._seated_hole: int | None = None
        self._clear_streak = 0
        self._still_since: float | None = None
        self._still_pos: tuple[float, float] | None = None
        self._wrong: set[int] = set()

    # ---- public --------------------------------------------------------------------------
    @property
    def target(self) -> int | None:
        if self.finished or self.targets is None:
            return None
        return self.targets[self._target_idx]

    @property
    def any_hole_mode(self) -> bool:
        return self.targets is None

    def snapshot(self) -> dict:
        return {
            "state": self.state,
            "target": self.target,
            "reps": self.reps,
            "finished": self.finished,
        }

    def step(self, obs: Observation) -> list[Event]:
        events: list[Event] = []
        if self.finished:
            return events
        prev = dict(self._stable)
        self._update_stable(obs.occupancy)
        self._track_hand(obs)
        newly_occupied = [k for k, v in self._stable.items() if v and not prev.get(k, False)]
        newly_empty = [k for k, v in self._stable.items() if not v and prev.get(k, False)]

        # Wrong-hole bookkeeping (any state past grasp).
        if self.state in ("grasped", "in_transit", "over_target") and not self.any_hole_mode:
            for k in newly_occupied:
                if k != self.target:
                    self._wrong.add(k)
                    events.append(make_event("wrong_hole", t=obs.t, hole=k, target=self.target))
        for k in newly_empty:
            self._wrong.discard(k)

        handler = getattr(self, f"_in_{self.state}")
        events += handler(obs, newly_occupied)
        self._last_free = list(obs.free_pegs_mm)
        return events

    # ---- helpers -------------------------------------------------------------------------
    def _update_stable(self, occupancy: dict[str, str]) -> None:
        for key, val in occupancy.items():
            k = int(key.split("_")[1])
            raw = val == "occupied"
            if k not in self._stable:
                self._stable[k] = raw
                self._raw_streak[k] = (raw, 1)
                continue
            last, n = self._raw_streak[k]
            n = n + 1 if raw == last else 1
            self._raw_streak[k] = (raw, n)
            if raw != self._stable[k] and n >= self.debounce_frames:
                self._stable[k] = raw

    def _track_hand(self, obs: Observation) -> None:
        """Remember when the hand was last within the seating gate of each hole, and keep the
        pinch-in-zone streak for the dish grasp."""
        if obs.hand_mm is None:
            self._pinch_streak = 0
            return
        self._hand_ever = True
        for k, c in enumerate(self.spec.targets_mm):
            if _dist(obs.hand_mm, c) <= self.hand_gate_mm:
                self._hand_near_t[k] = obs.t
        pinched = obs.pinch_mm is not None and obs.pinch_mm <= self.pinch_grasp_mm
        self._pinch_streak = self._pinch_streak + 1 if pinched and obs.hand_in_source_zone else 0

    def _hand_verifies(self, hole: int, t: float) -> bool:
        if not self._hand_ever:
            return True  # no hand data in this session: occupancy is the verification
        last = self._hand_near_t.get(hole)
        return last is not None and (t - last) <= self.hand_gate_s

    def _go(self, to: str, t: float, **extra: object) -> Event:
        ev = make_event(
            "state_change", t=t, **{"from": self.state, "to": to, "target": self.target, **extra}
        )
        self.state = to
        return ev

    def _target_center(self) -> tuple[float, float] | None:
        return None if self.target is None else self.spec.targets_mm[self.target]

    def _near_target(self, obs: Observation) -> bool:
        pts = list(obs.free_pegs_mm) + ([obs.hand_mm] if obs.hand_mm else [])
        if self.any_hole_mode:
            centers = [
                c for k, c in enumerate(self.spec.targets_mm) if not self._stable.get(k, False)
            ]
        else:
            c = self._target_center()
            centers = [c] if c else []
        return any(_dist(p, c) <= self.near_mm for p in pts for c in centers)

    def _seat_hole(self, newly_occupied: list[int]) -> int | None:
        if self.any_hole_mode:
            return newly_occupied[0] if newly_occupied else None
        return self.target if self.target in newly_occupied else None

    def _check_drop(self, obs: Observation) -> bool:
        """A free peg that sits still (away from the hand, if the hand is known) for long enough
        while a peg is 'in hand'. Time-based, so frame rate does not change the behaviour."""
        extra = len(obs.free_pegs_mm) > self._baseline_free
        if not extra:
            self._still_since, self._still_pos = None, None
            return False
        # Track the free peg farthest from the source (the one we are carrying / dropped).
        src = self._source_pos or (0.0, 0.0)
        peg = max(obs.free_pegs_mm, key=lambda p: _dist(p, src))
        if obs.hand_mm is not None and _dist(obs.hand_mm, peg) <= self.clear_mm:
            self._still_since, self._still_pos = None, None
            return False
        if self._still_pos is None or _dist(peg, self._still_pos) > self.stationary_mm:
            self._still_since = obs.t
        self._still_pos = peg
        limit = self.drop_after_hand_s if obs.hand_mm is not None else self.drop_after_s
        return self._still_since is not None and (obs.t - self._still_since) >= limit

    def _reset_carry(self, obs: Observation) -> None:
        self._baseline_free = len(obs.free_pegs_mm)
        self._still_since, self._still_pos = None, None
        self._clear_streak = 0

    # ---- state handlers ------------------------------------------------------------------
    def _in_at_source(self, obs: Observation, newly_occupied: list[int]) -> list[Event]:
        ev: list[Event] = []
        if self._last_free and len(obs.free_pegs_mm) < len(self._last_free):
            # The peg that disappeared is the one with no close match in the current set.
            gone = [p for p in self._last_free if all(_dist(p, q) > 5.0 for q in obs.free_pegs_mm)]
            self._source_pos = gone[0] if gone else self._last_free[0]
            self._baseline_free = len(obs.free_pegs_mm)
            self._t_grasp = obs.t
            self._still_since, self._still_pos = None, None
            self._pinch_streak = 0
            ev.append(self._go("grasped", obs.t, grasp="count"))
        elif self._pinch_streak >= self.pinch_frames and obs.hand_mm is not None:
            # Pegs in a dish: no free-peg blob ever disappears, the pinch is the lift.
            self._source_pos = obs.hand_mm
            self._baseline_free = len(obs.free_pegs_mm)
            self._t_grasp = obs.t
            self._still_since, self._still_pos = None, None
            self._pinch_streak = 0
            ev.append(self._go("grasped", obs.t, grasp="pinch"))
        return ev

    def _in_grasped(self, obs: Observation, newly_occupied: list[int]) -> list[Event]:
        ev: list[Event] = []
        hole = self._seat_hole(newly_occupied)
        if hole is not None:
            return ev + self._seat(obs, hole)
        src = self._source_pos or (0.0, 0.0)
        moved = [p for p in obs.free_pegs_mm if _dist(p, src) > self.transit_mm]
        hand_away = obs.hand_mm is not None and _dist(obs.hand_mm, src) > self.transit_mm
        if moved or hand_away:
            ev.append(self._go("in_transit", obs.t))
        return ev

    def _in_in_transit(self, obs: Observation, newly_occupied: list[int]) -> list[Event]:
        ev: list[Event] = []
        hole = self._seat_hole(newly_occupied)
        if hole is not None:
            return ev + self._seat(obs, hole)
        if self._check_drop(obs):
            ev.append(make_event("drop", t=obs.t, free_pegs_mm=[list(p) for p in obs.free_pegs_mm]))
            self._reset_carry(obs)
            ev.append(self._go("at_source", obs.t))
            return ev
        if self._near_target(obs):
            ev.append(self._go("over_target", obs.t))
        return ev

    def _in_over_target(self, obs: Observation, newly_occupied: list[int]) -> list[Event]:
        ev: list[Event] = []
        hole = self._seat_hole(newly_occupied)
        if hole is not None:
            return ev + self._seat(obs, hole)
        if self._check_drop(obs):
            ev.append(make_event("drop", t=obs.t, free_pegs_mm=[list(p) for p in obs.free_pegs_mm]))
            self._reset_carry(obs)
            ev.append(self._go("at_source", obs.t))
            return ev
        if not self._near_target(obs) and (obs.free_pegs_mm or obs.hand_mm):
            ev.append(self._go("in_transit", obs.t))
        return ev

    def _seat(self, obs: Observation, hole: int) -> list[Event]:
        self._seated_hole = hole
        self._t_seated = obs.t
        self._clear_streak = 0
        self._seat_verified = self._hand_verifies(hole, obs.t)
        self._seat_reason = None if self._seat_verified else "no_hand_near_hole"
        return [self._go("seated", obs.t, verified=self._seat_verified, reason=self._seat_reason)]

    def _in_seated(self, obs: Observation, newly_occupied: list[int]) -> list[Event]:
        ev: list[Event] = []
        hole = self._seated_hole
        assert hole is not None
        if not self._stable.get(hole, False):
            # Peg lifted back out before the hand cleared: treat as still carrying.
            ev.append(self._go("in_transit", obs.t))
            return ev
        c = self.spec.targets_mm[hole]
        if obs.hand_mm is not None:
            clear = _dist(obs.hand_mm, c) > self.clear_mm
            self._clear_streak = self.clear_frames if clear else 0
        else:
            near_peg = any(_dist(p, c) <= self.peg_clear_mm for p in obs.free_pegs_mm)
            self._clear_streak = 0 if near_peg else self._clear_streak + 1
        if self._clear_streak >= self.clear_frames:
            ev.append(self._go("hand_clear", obs.t))
            ev += self._in_hand_clear(obs, newly_occupied)
        return ev

    def _in_hand_clear(self, obs: Observation, newly_occupied: list[int]) -> list[Event]:
        hole = self._seated_hole
        assert hole is not None
        self.reps += 1
        ev = [
            make_event(
                "rep_complete",
                t=obs.t,
                rep=self.reps,
                hole=hole,
                target=self.target,
                duration_s=round(self._t_seated - self._t_grasp, 4),
                t_grasp=self._t_grasp,
                t_seated=self._t_seated,
                t_clear=obs.t,
                verified=self._seat_verified,
                reason=self._seat_reason,
            )
        ]
        if self.targets is not None:
            self._target_idx += 1
            if self._target_idx >= len(self.targets):
                self.finished = True
        elif all(self._stable.get(k, False) for k in range(len(self.spec.targets_mm))):
            self.finished = True
        self._seated_hole = None
        self._reset_carry(obs)
        ev.append(self._go("at_source", obs.t))
        return ev
