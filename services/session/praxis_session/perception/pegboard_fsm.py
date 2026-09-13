"""Pegboard transfer finite-state machine.

States: at_source -> grasped -> in_transit -> over_target -> seated -> hand_clear (-> at_source).
Inputs are Observations built from BoardState output (occupancy, free pegs in mm) plus an
optional hand position in mm (from the hand model, W4). Transitions are gated on debounced
occupancy deltas and free-peg / hand proximity. Emits Events: state_change, rep_complete,
wrong_hole, drop. No frames are touched here; cv2.__version__ == 5.0.0 upstream.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from praxis_session.events import Event, make_event
from praxis_session.perception.board_spec import BOARD, BoardSpec

STATES = ("at_source", "grasped", "in_transit", "over_target", "seated", "hand_clear")


@dataclass(frozen=True)
class Observation:
    t: float
    occupancy: dict[str, str]
    free_pegs_mm: list[tuple[float, float]] = field(default_factory=list)
    hand_mm: tuple[float, float] | None = None


def _dist(a: Sequence[float], b: Sequence[float]) -> float:
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))


class PegboardFSM:
    def __init__(
        self,
        targets: list[int] | None,
        spec: BoardSpec = BOARD,
        debounce_frames: int = 2,
        clear_frames: int = 3,
        drop_frames: int = 3,
        near_mm: float = 10.0,
        transit_mm: float = 20.0,
        clear_mm: float = 25.0,
        stationary_mm: float = 2.0,
    ) -> None:
        self.spec = spec
        self.targets = list(targets) if targets is not None else None
        self.debounce_frames = max(1, debounce_frames)
        self.clear_frames = max(1, clear_frames)
        self.drop_frames = max(1, drop_frames)
        self.near_mm = near_mm
        self.transit_mm = transit_mm
        self.clear_mm = clear_mm
        self.stationary_mm = stationary_mm

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
        self._still_streak = 0
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
        return {"state": self.state, "target": self.target, "reps": self.reps, "finished": self.finished}

    def step(self, obs: Observation) -> list[Event]:
        events: list[Event] = []
        if self.finished:
            return events
        prev = dict(self._stable)
        self._update_stable(obs.occupancy)
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

    def _go(self, to: str, t: float) -> Event:
        ev = make_event("state_change", t=t, **{"from": self.state, "to": to, "target": self.target})
        self.state = to
        return ev

    def _target_center(self) -> tuple[float, float] | None:
        return None if self.target is None else self.spec.hole_centers_mm[self.target]

    def _near_target(self, obs: Observation) -> bool:
        pts = list(obs.free_pegs_mm) + ([obs.hand_mm] if obs.hand_mm else [])
        if self.any_hole_mode:
            centers = [c for k, c in enumerate(self.spec.hole_centers_mm) if not self._stable.get(k, False)]
        else:
            c = self._target_center()
            centers = [c] if c else []
        return any(_dist(p, c) <= self.near_mm for p in pts for c in centers)

    def _seat_hole(self, newly_occupied: list[int]) -> int | None:
        if self.any_hole_mode:
            return newly_occupied[0] if newly_occupied else None
        return self.target if self.target in newly_occupied else None

    def _check_drop(self, obs: Observation) -> bool:
        """A free peg that sits still away from the hand for drop_frames while a peg is 'in hand'."""
        extra = len(obs.free_pegs_mm) > self._baseline_free
        if not extra:
            self._still_streak, self._still_pos = 0, None
            return False
        # Track the free peg farthest from the source (the one we are carrying / dropped).
        src = self._source_pos or (0.0, 0.0)
        peg = max(obs.free_pegs_mm, key=lambda p: _dist(p, src))
        if obs.hand_mm is not None and _dist(obs.hand_mm, peg) <= self.clear_mm:
            self._still_streak, self._still_pos = 0, None
            return False
        if self._still_pos is not None and _dist(peg, self._still_pos) <= self.stationary_mm:
            self._still_streak += 1
        else:
            self._still_streak = 1
        self._still_pos = peg
        return self._still_streak >= self.drop_frames

    def _reset_carry(self, obs: Observation) -> None:
        self._baseline_free = len(obs.free_pegs_mm)
        self._still_streak, self._still_pos = 0, None
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
            self._still_streak, self._still_pos = 0, None
            ev.append(self._go("grasped", obs.t))
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
        return [self._go("seated", obs.t)]

    def _in_seated(self, obs: Observation, newly_occupied: list[int]) -> list[Event]:
        ev: list[Event] = []
        hole = self._seated_hole
        assert hole is not None
        if not self._stable.get(hole, False):
            # Peg lifted back out before the hand cleared: treat as still carrying.
            ev.append(self._go("in_transit", obs.t))
            return ev
        c = self.spec.hole_centers_mm[hole]
        if obs.hand_mm is not None:
            clear = _dist(obs.hand_mm, c) > self.clear_mm
            self._clear_streak = self.clear_frames if clear else 0
        else:
            near_peg = any(_dist(p, c) <= self.clear_mm for p in obs.free_pegs_mm)
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
                "rep_complete", t=obs.t, rep=self.reps, hole=hole, target=self.target,
                duration_s=round(self._t_seated - self._t_grasp, 4),
                t_grasp=self._t_grasp, t_seated=self._t_seated, t_clear=obs.t,
            )
        ]
        if self.targets is not None:
            self._target_idx += 1
            if self._target_idx >= len(self.targets):
                self.finished = True
        elif all(self._stable.get(k, False) for k in range(len(self.spec.hole_centers_mm))):
            self.finished = True
        self._seated_hole = None
        self._reset_carry(obs)
        ev.append(self._go("at_source", obs.t))
        return ev
