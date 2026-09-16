"""Arm to the front (shoulder flexion) finite-state machine.

States: start_pose -> moving -> target_reached -> hold -> return (-> start_pose). One rep per
return. Target is clamped to the ceiling in code (CLAUDE.md guardrails). Events: state_change,
rep_complete{verified, reason}, target_missed, hold_too_short, compensation_lean,
shoulder_hiking, set_complete, arm_complete. Angles arrive from pose.py (camera-relative).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from praxis_session.events import Event, make_event

STATES = ("start_pose", "moving", "target_reached", "hold", "return")


@dataclass(frozen=True)
class ArmObservation:
    t: float
    shoulder_deg: float | None
    trunk_lean_deg: float
    shoulder_hike_norm: float
    view_ok: bool


class ArmFSM:
    def __init__(
        self,
        target_deg: float = 90.0,
        ceiling_deg: float = 90.0,
        hold_s: float = 3.0,
        sets: int = 2,
        reps_per_set: int = 8,
        start_below_deg: float = 25.0,
        tolerance_deg: float = 10.0,
        lean_limit_deg: float = 12.0,
        lean_events_to_flag: int = 3,
        hike_limit: float = 0.08,
        baseline_frames: int = 10,
    ) -> None:
        self.ceiling_deg = ceiling_deg
        self.clamped = target_deg > ceiling_deg
        self.target_deg = min(target_deg, ceiling_deg)
        self.hold_s, self.sets, self.reps_per_set = hold_s, sets, reps_per_set
        self.start_below_deg, self.tolerance_deg = start_below_deg, tolerance_deg
        self.lean_limit_deg, self.lean_events_to_flag = lean_limit_deg, lean_events_to_flag
        self.hike_limit, self.baseline_frames = hike_limit, baseline_frames
        self.state = "start_pose"
        self.set, self.rep = 1, 0
        self.finished = False
        self.reps: list[dict[str, Any]] = []
        self.lean_count = 0
        self.hike_count = 0
        self._angle: float | None = None
        self._lean = 0.0
        self._peak = 0.0
        self._t_move = 0.0
        self._t_hold = 0.0
        self._held = 0.0
        self._reason: str | None = None
        self._lean_this_rep = False
        self._hike_this_rep = False
        self._hike_samples: list[float] = []
        self._hike_baseline = 0.0
        self._best_this_set = 0.0

    # ---- public --------------------------------------------------------------------------
    def snapshot(self) -> dict[str, Any]:
        return {
            "mode": "arm",
            "state": self.state,
            "set": self.set,
            "rep": self.rep,
            "sets": self.sets,
            "reps_per_set": self.reps_per_set,
            "target_deg": self.target_deg,
            "ceiling_deg": self.ceiling_deg,
            "clamped": self.clamped,
            "hold_s": self.hold_s,
            "hold_progress": round(min(1.0, self._held / self.hold_s), 3)
            if self.state == "hold"
            else 0.0,
            "angle_now": self._angle,
            "peak_this_rep": round(self._peak, 1),
            "best_this_set": round(self._best_this_set, 1),
            "trunk_lean_deg": self._lean,
            "reps_total": len(self.reps),
            "unverified_total": sum(1 for r in self.reps if not r["verified"]),
            "flags": {
                "lean": self.lean_count >= self.lean_events_to_flag,
                "lean_count": self.lean_count,
                "hike_count": self.hike_count,
            },
            "finished": self.finished,
        }

    def step(self, obs: ArmObservation) -> list[Event]:
        if self.finished or obs.shoulder_deg is None:
            self._angle = None if obs.shoulder_deg is None else self._angle
            return []
        self._angle, self._lean = obs.shoulder_deg, obs.trunk_lean_deg
        evs: list[Event] = []
        if self.state in ("moving", "target_reached", "hold"):
            self._peak = max(self._peak, obs.shoulder_deg)
            evs += self._compensation(obs)
        handler = getattr(self, f"_in_{self.state}")
        return evs + handler(obs)

    # ---- helpers -------------------------------------------------------------------------
    def _go(self, to: str, t: float) -> Event:
        ev = make_event(
            "state_change",
            t=t,
            **{"from": self.state, "to": to, "set": self.set, "rep": self.rep + 1},
        )
        self.state = to
        return ev

    def _compensation(self, obs: ArmObservation) -> list[Event]:
        evs: list[Event] = []
        if abs(obs.trunk_lean_deg) > self.lean_limit_deg and not self._lean_this_rep:
            self._lean_this_rep = True
            self.lean_count += 1
            evs.append(
                make_event(
                    "compensation_lean",
                    t=obs.t,
                    lean_deg=obs.trunk_lean_deg,
                    count=self.lean_count,
                    flagged=self.lean_count >= self.lean_events_to_flag,
                )
            )
        hike = obs.shoulder_hike_norm - self._hike_baseline
        if hike > self.hike_limit and not self._hike_this_rep:
            self._hike_this_rep = True
            self.hike_count += 1
            evs.append(
                make_event("shoulder_hiking", t=obs.t, hike=round(hike, 3), count=self.hike_count)
            )
        return evs

    # ---- states --------------------------------------------------------------------------
    def _in_start_pose(self, obs: ArmObservation) -> list[Event]:
        if len(self._hike_samples) < self.baseline_frames:
            self._hike_samples.append(obs.shoulder_hike_norm)
            self._hike_baseline = sum(self._hike_samples) / len(self._hike_samples)
        if obs.shoulder_deg > self.start_below_deg + 5:
            self._peak, self._t_move, self._held, self._reason = obs.shoulder_deg, obs.t, 0.0, None
            self._lean_this_rep = self._hike_this_rep = False
            return [self._go("moving", obs.t)]
        return []

    def _in_moving(self, obs: ArmObservation) -> list[Event]:
        if obs.shoulder_deg >= self.target_deg - self.tolerance_deg:
            evs = [self._go("target_reached", obs.t)]
            self._t_hold = obs.t
            evs.append(self._go("hold", obs.t))
            return evs
        if obs.shoulder_deg < self.start_below_deg and self._peak > self.start_below_deg + 5:
            self._reason = "target_missed"
            evs = [
                make_event(
                    "target_missed",
                    t=obs.t,
                    peak_deg=round(self._peak, 1),
                    target_deg=self.target_deg,
                )
            ]
            evs.append(self._go("return", obs.t))
            return evs + self._in_return(obs)
        return []

    def _in_target_reached(self, obs: ArmObservation) -> list[Event]:  # pragma: no cover
        self._t_hold = obs.t
        return [self._go("hold", obs.t)]

    def _in_hold(self, obs: ArmObservation) -> list[Event]:
        self._held = obs.t - self._t_hold
        if obs.shoulder_deg < self.target_deg - self.tolerance_deg - 5:
            evs: list[Event] = []
            if self._held < self.hold_s:
                self._reason = "hold_too_short"
                evs.append(
                    make_event(
                        "hold_too_short", t=obs.t, held_s=round(self._held, 2), hold_s=self.hold_s
                    )
                )
            evs.append(self._go("return", obs.t))
            return evs
        return []

    def _in_return(self, obs: ArmObservation) -> list[Event]:
        if obs.shoulder_deg >= self.start_below_deg:
            return []
        self.rep += 1
        rep = {
            "set": self.set,
            "rep": self.rep,
            "peak_deg": round(self._peak, 1),
            "hold_s": round(self._held, 2),
            "verified": self._reason is None,
            "reason": self._reason,
            "lean": self._lean_this_rep,
            "hike": self._hike_this_rep,
            "t_start": self._t_move,
            "t_end": obs.t,
        }
        self.reps.append(rep)
        if rep["verified"]:
            self._best_this_set = max(self._best_this_set, self._peak)
        evs = [make_event("rep_complete", t=obs.t, **rep)]
        if self.rep >= self.reps_per_set:
            evs.append(make_event("set_complete", t=obs.t, set=self.set, reps=self.rep))
            if self.set >= self.sets:
                self.finished = True
                evs.append(make_event("arm_complete", t=obs.t, sets=self.set, reps=len(self.reps)))
                return evs
            self.set += 1
            self.rep = 0
            self._best_this_set = 0.0
        self._held = 0.0
        evs.append(self._go("start_pose", obs.t))
        return evs
