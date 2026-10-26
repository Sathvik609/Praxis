"""Automated Nine-Hole Peg Test: the peg FSM in any-hole test mode (cv2.__version__ == 5.0.0 upstream).

Any-hole targets, timer from the first peg lift (first at_source -> grasped) to the ninth peg
seated, per-peg splits (seated-to-seated). Emits nhpt_start, nhpt_split, nhpt_complete on top
of the FSM's own events. This is a timing aid, not a clinical instrument.

A first peg whose lift was never seen (12 Oct 2026; peg_fsm "grasp_not_seen") starts the timer
at its seat: `nhpt_start.inferred` / `nhpt_complete.start_inferred` say so, and the total then
misses that peg's transfer time.

The timer uses the FSM's own event times (`t_grasp`, `t_seated`: the first frame of the confirmed
run), not the frame on which the debounce confirmed it (11 Oct 2026; the total was late by
(debounce - 1) frame periods before).

Occupancy debounce is time-based: `debounce_s` (0.25 s in the product) is converted to a
frame count from the observed frame gaps (median of the last ten), so a 100 ms flicker is
ignored at 12 fps and at 30 fps alike; `debounce_frames` stays as a floor for slow streams.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Any

from praxis_session.events import Event, make_event
from praxis_session.perception.board_spec import NHPT_BOARD, SheetSpec
from praxis_session.perception.peg_fsm import Observation, PegFSM


class NHPT:
    def __init__(
        self,
        spec: SheetSpec = NHPT_BOARD,
        n_pegs: int = 9,
        debounce_s: float | None = None,
        **fsm_kwargs: Any,
    ) -> None:
        self.fsm = PegFSM(targets=None, spec=spec, **fsm_kwargs)
        self.n_pegs = n_pegs
        self.debounce_s = debounce_s
        self._debounce_floor = self.fsm.debounce_frames
        self._gaps: deque[float] = deque(maxlen=10)
        self._last_t: float | None = None
        self.t_start: float | None = None
        self.t_end: float | None = None
        self.start_inferred = False
        self.pegs: list[dict[str, Any]] = []
        self._last_seat_t: float | None = None

    def _update_debounce(self, t: float) -> None:
        if self._last_t is not None and t > self._last_t:
            self._gaps.append(t - self._last_t)
        self._last_t = t
        if self.debounce_s is None or not self._gaps:
            return
        dt = sorted(self._gaps)[len(self._gaps) // 2]
        frames = math.ceil(self.debounce_s / dt - 1e-9)
        self.fsm.debounce_frames = max(self._debounce_floor, frames)

    @property
    def started(self) -> bool:
        return self.t_start is not None

    @property
    def completed(self) -> bool:
        return self.t_end is not None

    @property
    def total_s(self) -> float | None:
        return (
            None
            if self.t_end is None or self.t_start is None
            else round(self.t_end - self.t_start, 4)
        )

    @property
    def state(self) -> str:
        return self.fsm.state

    def elapsed(self, t: float) -> float:
        if self.t_start is None:
            return 0.0
        if self.t_end is not None:
            return self.total_s or 0.0
        return round(t - self.t_start, 4)

    def step(self, obs: Observation) -> list[Event]:
        self._update_debounce(obs.t)
        if self.completed:
            # Timer is frozen, but the FSM still runs so the final rep_complete / hand_clear fire.
            return self.fsm.step(obs)
        out: list[Event] = []
        for ev in self.fsm.step(obs):
            out.append(ev)
            if ev.type == "state_change" and ev.payload["to"] == "grasped" and self.t_start is None:
                self.t_start = float(ev.payload.get("t_grasp", ev.t))
                self.start_inferred = ev.payload.get("grasp") == "unseen"
                self._last_seat_t = self.t_start
                out.append(make_event("nhpt_start", t=ev.t, t_start=self.t_start, inferred=self.start_inferred))
            elif (
                ev.type == "state_change"
                and ev.payload["to"] == "seated"
                and self.t_start is not None
                # a hole already counted (a carried peg read over it, then the real seat) does
                # not count again: the test ends when nine different holes are filled
                and self.fsm._seated_hole not in {p["hole"] for p in self.pegs}
            ):
                hole = self.fsm._seated_hole
                assert self._last_seat_t is not None
                t_seat = float(ev.payload.get("t_seated", ev.t))
                split = round(t_seat - self._last_seat_t, 4)
                self._last_seat_t = t_seat
                self.pegs.append(
                    {"peg": len(self.pegs) + 1, "hole": hole, "t": t_seat, "split_s": split}
                )
                out.append(
                    make_event(
                        "nhpt_split",
                        t=ev.t,
                        peg=len(self.pegs),
                        hole=hole,
                        split_s=split,
                        elapsed_s=round(t_seat - self.t_start, 4),
                    )
                )
                if len(self.pegs) >= self.n_pegs:
                    self.t_end = t_seat
                    out.append(
                        make_event(
                            "nhpt_complete",
                            t=ev.t,
                            total_s=self.total_s,
                            start_inferred=self.start_inferred,
                            splits_s=[p["split_s"] for p in self.pegs],
                            pegs=list(self.pegs),
                        )
                    )
                    break
        return out

    def snapshot(self, t: float) -> dict[str, Any]:
        return {
            "mode": "nhpt",
            **self.fsm.snapshot(),
            "started": self.started,
            "completed": self.completed,
            "pegs_done": len(self.pegs),
            "elapsed_s": self.elapsed(t),
            "total_s": self.total_s,
        }
