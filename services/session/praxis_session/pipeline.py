"""Per-frame composition of perception stages into events (OpenCV cv2.__version__ == 5.0.0).

Modes: "calibrate" (Phase 1: calibration + setup checks) and "nhpt" (Phase 2: board state ->
peg FSM -> NHPT timer). Later phases add "cup" and "arm". One pipeline per WebSocket
connection or replay; frames are processed and dropped, events go to the ring and the socket.
"""
from __future__ import annotations

from typing import Any, Literal

import numpy as np

from praxis_session.events import Event, EventRing, make_event
from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import SHEETS
from praxis_session.perception.calibration import CalibrationResult, Calibrator
from praxis_session.perception.nhpt import NHPT
from praxis_session.perception.peg_fsm import Observation
from praxis_session.perception.quality import (
    MarkerSteadiness,
    Presence,
    build_checks,
    lighting,
    task_area_in_view,
)

Mode = Literal["calibrate", "nhpt"]
MODES: tuple[str, ...] = ("calibrate", "nhpt")
LOSS_FRAMES = 5
REQUIRED_CHECKS = ("camera", "task_area", "markers", "lighting")


class SessionPipeline:
    def __init__(
        self,
        mode: Mode,
        sheet: str,
        ring: EventRing | None = None,
        debounce_frames: int = 2,
        clear_frames: int = 3,
    ) -> None:
        if mode not in MODES:
            raise ValueError(f"bad mode {mode}")
        if sheet not in SHEETS:
            raise ValueError(f"bad sheet {sheet}")
        self.mode, self.spec, self.ring = mode, SHEETS[sheet], ring
        self._cal = Calibrator(self.spec)
        self._steady = MarkerSteadiness()
        self._presence = Presence()
        self._was_calibrated = False
        self._miss_streak = 0
        self._lost = False
        self._board: BoardState | None = None
        self._nhpt: NHPT | None = None
        if mode == "nhpt":
            self._board = BoardState(self.spec)
            self._nhpt = NHPT(
                spec=self.spec, debounce_frames=debounce_frames, clear_frames=clear_frames
            )

    # ---- public -------------------------------------------------------------------------
    def process(self, frame_bgr: np.ndarray, t: float, frame_index: int) -> list[Event]:
        if self.mode == "calibrate":
            return self._process_calibrate(frame_bgr, t, frame_index)
        return self._process_nhpt(frame_bgr, t, frame_index)

    def snapshot(self, t: float | None = None) -> dict[str, Any]:
        nhpt = None
        reps = 0
        if self._nhpt is not None:
            nhpt = self._nhpt.snapshot(t if t is not None else self._last_t)
            reps = self._nhpt.fsm.reps
        return {"mode": self.mode, "reps": reps, "nhpt": nhpt}

    # ---- internals ----------------------------------------------------------------------
    _last_t: float = 0.0

    def _emit(self, out: list[Event], e: Event) -> None:
        if self.ring is not None:
            self.ring.append(e)
        out.append(e)

    def _track_loss(self, out: list[Event], cal: CalibrationResult, t: float, i: int) -> None:
        if cal.calibrated:
            self._was_calibrated, self._miss_streak = True, 0
            if self._lost:
                self._lost = False
                self._emit(out, make_event("perception_regained", t=t, frame_index=i))
        elif self._was_calibrated:
            self._miss_streak += 1
            if self._miss_streak >= LOSS_FRAMES and not self._lost:
                self._lost = True
                self._emit(
                    out, make_event("perception_lost", t=t, frame_index=i, missing=cal.missing)
                )

    def _process_calibrate(self, frame_bgr: np.ndarray, t: float, i: int) -> list[Event]:
        out: list[Event] = []
        self._last_t = t
        cal = self._cal.run(frame_bgr)
        cal_d = cal.to_dict() | {"frame_index": i}
        if cal.calibrated:
            targets = np.array(self.spec.targets_mm, np.float32)
            cal_d["targets_px"] = np.round(cal.to_px(targets), 1).tolist()
        self._emit(out, make_event("calibration", t=t, **cal_d))

        light = lighting(frame_bgr)
        steady = self._steady.update(cal.marker_corners_px)
        pres = self._presence.update(frame_bgr)
        self._emit(
            out,
            make_event(
                "quality", t=t, frame_index=i, lighting=light, steadiness=steady, presence=pres
            ),
        )
        area = task_area_in_view(cal, self.spec, frame_bgr.shape)
        checks = build_checks(cal, light, steady, area, pres)
        required_ok = all(c["status"] == "pass" for c in checks if c["id"] in REQUIRED_CHECKS)
        self._emit(
            out,
            make_event(
                "setup_checks", t=t, frame_index=i, checks=checks, all_required_pass=required_ok
            ),
        )
        self._track_loss(out, cal, t, i)
        return out

    def _process_nhpt(self, frame_bgr: np.ndarray, t: float, i: int) -> list[Event]:
        assert self._board is not None and self._nhpt is not None
        out: list[Event] = []
        self._last_t = t
        cal = self._cal.run(frame_bgr)
        board_d: dict[str, Any] | None = None
        holes_px: list[list[float]] = []
        if cal.calibrated:
            canon = self._board.warp(frame_bgr, cal)
            board_d = self._board.to_event_payload(canon)
            holes_px = self._board.holes_frame_px(cal)
        occ = board_d["occupancy"] if board_d else {}
        next_hole = next(
            (k for k in range(len(self.spec.targets_mm)) if occ.get(f"hole_{k}") == "empty"), None
        )
        snap = self._nhpt.snapshot(t)
        self._emit(
            out,
            make_event(
                "frame",
                t=t,
                frame_index=i,
                calibrated=cal.calibrated,
                missing=cal.missing,
                nhpt=snap,
                board=(
                    {
                        "occupancy": occ,
                        "hole_source": board_d["hole_source"],
                        "free_pegs_mm": board_d["free_pegs_mm"],
                    }
                    if board_d
                    else {}
                ),
                overlay={
                    "holes_px": holes_px,
                    "target": snap["target"],
                    "next_hole": next_hole,
                    "markers_px": {
                        str(k): np.round(v, 1).tolist() for k, v in cal.marker_corners_px.items()
                    },
                },
            ),
        )
        if board_d is not None:
            obs = Observation(
                t=t,
                occupancy=board_d["occupancy"],
                free_pegs_mm=[(float(x), float(y)) for x, y in board_d["free_pegs_mm"]],
            )
            for e in self._nhpt.step(obs):
                self._emit(out, e)
        self._track_loss(out, cal, t, i)
        return out
