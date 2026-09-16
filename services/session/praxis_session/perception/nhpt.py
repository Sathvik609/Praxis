"""Automated Nine-Hole Peg Test: the peg FSM in any-hole test mode (cv2.__version__ == 5.0.0 upstream).

Any-hole targets, timer from the first peg lift (first at_source -> grasped) to the ninth peg
seated, per-peg splits (seated-to-seated). Emits nhpt_start, nhpt_split, nhpt_complete on top
of the FSM's own events. This is a timing aid, not a clinical instrument (CLAUDE.md §1).
"""
from __future__ import annotations

from typing import Any

from praxis_session.events import Event, make_event
from praxis_session.perception.board_spec import NHPT_BOARD, SheetSpec
from praxis_session.perception.peg_fsm import Observation, PegFSM


class NHPT:
    def __init__(self, spec: SheetSpec = NHPT_BOARD, n_pegs: int = 9, **fsm_kwargs: Any) -> None:
        self.fsm = PegFSM(targets=None, spec=spec, **fsm_kwargs)
        self.n_pegs = n_pegs
        self.t_start: float | None = None
        self.t_end: float | None = None
        self.pegs: list[dict[str, Any]] = []
        self._last_seat_t: float | None = None

    @property
    def started(self) -> bool:
        return self.t_start is not None

    @property
    def completed(self) -> bool:
        return self.t_end is not None

    @property
    def total_s(self) -> float | None:
        return None if self.t_end is None or self.t_start is None else round(self.t_end - self.t_start, 4)

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
        if self.completed:
            # Timer is frozen, but the FSM still runs so the final rep_complete / hand_clear fire.
            return self.fsm.step(obs)
        out: list[Event] = []
        for ev in self.fsm.step(obs):
            out.append(ev)
            if ev.type == "state_change" and ev.payload["to"] == "grasped" and self.t_start is None:
                self.t_start = ev.t
                self._last_seat_t = ev.t
                out.append(make_event("nhpt_start", t=ev.t))
            elif ev.type == "state_change" and ev.payload["to"] == "seated" and self.t_start is not None:
                hole = self.fsm._seated_hole
                assert self._last_seat_t is not None
                split = round(ev.t - self._last_seat_t, 4)
                self._last_seat_t = ev.t
                self.pegs.append({"peg": len(self.pegs) + 1, "hole": hole, "t": ev.t, "split_s": split})
                out.append(make_event(
                    "nhpt_split", t=ev.t, peg=len(self.pegs), hole=hole, split_s=split,
                    elapsed_s=round(ev.t - self.t_start, 4),
                ))
                if len(self.pegs) >= self.n_pegs:
                    self.t_end = ev.t
                    out.append(make_event(
                        "nhpt_complete", t=ev.t, total_s=self.total_s,
                        splits_s=[p["split_s"] for p in self.pegs], pegs=list(self.pegs),
                    ))
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
