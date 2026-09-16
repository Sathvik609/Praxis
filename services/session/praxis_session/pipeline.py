"""Per-frame composition of perception stages into events (OpenCV cv2.__version__ == 5.0.0).

Phase 1 ships mode "calibrate"; later phases add "nhpt", "cup", "arm". One pipeline per
WebSocket connection; frames are processed and dropped, events go to the ring and the socket.
"""
from __future__ import annotations

from typing import Literal

import numpy as np

from praxis_session.events import Event, EventRing, make_event
from praxis_session.perception.board_spec import SHEETS
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.quality import (
    MarkerSteadiness,
    Presence,
    build_checks,
    lighting,
    task_area_in_view,
)

Mode = Literal["calibrate"]
MODES: tuple[str, ...] = ("calibrate",)
LOSS_FRAMES = 5
REQUIRED_CHECKS = ("camera", "task_area", "markers", "lighting")


class SessionPipeline:
    def __init__(self, mode: Mode, sheet: str, ring: EventRing | None = None) -> None:
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

    def _emit(self, out: list[Event], e: Event) -> None:
        if self.ring is not None:
            self.ring.append(e)
        out.append(e)

    def process(self, frame_bgr: np.ndarray, t: float, frame_index: int) -> list[Event]:
        out: list[Event] = []
        cal = self._cal.run(frame_bgr)
        cal_d = cal.to_dict() | {"frame_index": frame_index}
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
                "quality", t=t, frame_index=frame_index,
                lighting=light, steadiness=steady, presence=pres,
            ),
        )

        area = task_area_in_view(cal, self.spec, frame_bgr.shape)
        checks = build_checks(cal, light, steady, area, pres)
        required_ok = all(c["status"] == "pass" for c in checks if c["id"] in REQUIRED_CHECKS)
        self._emit(
            out,
            make_event(
                "setup_checks", t=t, frame_index=frame_index,
                checks=checks, all_required_pass=required_ok,
            ),
        )

        if cal.calibrated:
            self._was_calibrated, self._miss_streak = True, 0
            if self._lost:
                self._lost = False
                self._emit(out, make_event("perception_regained", t=t, frame_index=frame_index))
        elif self._was_calibrated:
            self._miss_streak += 1
            if self._miss_streak >= LOSS_FRAMES and not self._lost:
                self._lost = True
                self._emit(
                    out,
                    make_event(
                        "perception_lost", t=t, frame_index=frame_index, missing=cal.missing
                    ),
                )
        return out
