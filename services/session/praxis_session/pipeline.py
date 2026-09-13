"""Per-frame session pipeline: calibration -> board state -> pegboard FSM / NHPT -> events.

Every call to process() takes one BGR frame (decoded in memory, never stored) and a timestamp
and returns the timestamped JSON events it produced, which are also appended to the EventRing.
Overlay geometry is returned in frame pixels so the browser can draw it; frames never go back.

Guardrail (CLAUDE.md §1): perception loss (any of the four markers missing for
`lost_after_frames` consecutive frames) pauses the FSM and emits `perception_lost` with the
reason; the UI shows why. `perception_regained` resumes.

OpenCV 5 (cv2.__version__ == 5.0.0 at authoring) does all image work in the modules below.
"""
from __future__ import annotations

from typing import Any, Literal

import numpy as np

from praxis_session.events import Event, EventRing, make_event
from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import BOARD, BoardSpec
from praxis_session.perception.calibration import Calibration, Calibrator
from praxis_session.perception.nhpt import NHPT
from praxis_session.perception.pegboard_fsm import Observation, PegboardFSM

Mode = Literal["calibrate", "pegboard", "nhpt"]
DEFAULT_PEGBOARD_TARGETS = [0, 1, 2, 3, 4, 5, 6, 7, 8]


class SessionPipeline:
    def __init__(
        self,
        mode: Mode = "calibrate",
        targets: list[int] | None = None,
        ring: EventRing | None = None,
        spec: BoardSpec = BOARD,
        lost_after_frames: int = 5,
        **fsm_kwargs: Any,
    ) -> None:
        if mode not in ("calibrate", "pegboard", "nhpt"):
            raise ValueError(f"unknown mode {mode!r}")
        self.mode: Mode = mode
        self.ring = ring if ring is not None else EventRing()
        self.spec = spec
        self.calibrator = Calibrator(spec)
        self.board = BoardState(spec)
        self.lost_after_frames = lost_after_frames
        self.fsm: PegboardFSM | None = None
        self.nhpt: NHPT | None = None
        if mode == "pegboard":
            self.fsm = PegboardFSM(targets=targets or DEFAULT_PEGBOARD_TARGETS, spec=spec, **fsm_kwargs)
        elif mode == "nhpt":
            self.nhpt = NHPT(spec=spec, **fsm_kwargs)
            self.fsm = self.nhpt.fsm
        self.frame_index = 0
        self.last_cal: Calibration | None = None
        self._last_cal_key: tuple | None = None
        self._lost_streak = 0
        self.paused = False
        self.last_t = 0.0

    # ---- public --------------------------------------------------------------------------
    def process(self, frame_bgr: np.ndarray, t: float) -> list[Event]:
        events: list[Event] = []
        self.last_t = t
        cal = self.calibrator.calibrate(frame_bgr)
        key = (cal.calibrated, tuple(cal.missing_ids))
        if key != self._last_cal_key:
            events.append(make_event("calibration", t=t, **cal.to_event_payload()))
            self._last_cal_key = key

        occupancy: dict[str, str] | None = None
        free_pegs: list[tuple[float, float]] = []
        if cal.calibrated:
            self.last_cal = cal
            if self._lost_streak >= self.lost_after_frames and self.paused:
                self.paused = False
                events.append(make_event("perception_regained", t=t))
            self._lost_streak = 0
            if self.fsm is not None:
                canon = self.board.warp(frame_bgr, cal)
                self.board.detect_holes(canon)
                occupancy = self.board.occupancy(canon)
                free_pegs = self.board.free_pegs_mm(canon)
                obs = Observation(t=t, occupancy=occupancy, free_pegs_mm=free_pegs)
                events += self.nhpt.step(obs) if self.nhpt is not None else self.fsm.step(obs)
        else:
            self._lost_streak += 1
            if self._lost_streak == self.lost_after_frames and not self.paused:
                self.paused = True
                events.append(make_event(
                    "perception_lost", t=t, reason="markers_missing", missing_ids=cal.missing_ids,
                ))

        events.append(make_event(
            "frame", t=t, frame_index=self.frame_index, calibrated=cal.calibrated,
            paused=self.paused, mode=self.mode, fsm=self.fsm.snapshot() if self.fsm else None,
            nhpt=self.nhpt.snapshot(t) if self.nhpt else None, occupancy=occupancy,
            free_pegs_mm=[[round(x, 1), round(y, 1)] for x, y in free_pegs],
            overlay=self._overlay(cal),
        ))
        self.frame_index += 1
        for e in events:
            self.ring.append(e)
        return events

    def snapshot(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "frame_index": self.frame_index,
            "calibrated": bool(self.last_cal and self.last_cal.calibrated and not self.paused),
            "paused": self.paused,
            "fsm": self.fsm.snapshot() if self.fsm else None,
            "nhpt": self.nhpt.snapshot(self.last_t) if self.nhpt else None,
            "reps": self.fsm.reps if self.fsm else 0,
            "target": self.fsm.target if self.fsm else None,
            "hole_source": self.board.hole_source,
        }

    # ---- overlay -------------------------------------------------------------------------
    def _overlay(self, cal: Calibration) -> dict[str, Any]:
        ov: dict[str, Any] = {
            "markers_px": {str(k): v.tolist() for k, v in cal.marker_corners_px.items()},
            "holes_px": [],
            "target": self.fsm.target if self.fsm else None,
        }
        use = cal if cal.calibrated else self.last_cal
        if use is None or not use.calibrated:
            return ov
        centers = use.mm_to_px(self.spec.hole_centers_mm)
        r_mm = self.spec.hole_diameter_mm / 2
        edge = use.mm_to_px([(x + r_mm, y) for x, y in self.spec.hole_centers_mm])
        radii = np.linalg.norm(edge - centers, axis=1)
        ov["holes_px"] = [[round(float(x), 1), round(float(y), 1), round(float(r), 1)] for (x, y), r in zip(centers, radii)]
        return ov
