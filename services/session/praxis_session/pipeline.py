"""Per-frame composition of perception stages into events (OpenCV cv2.__version__ == 5.0.0).

Modes: "calibrate" (Phase 1: calibration + setup checks) and "nhpt" (Phase 2: board state ->
peg FSM -> NHPT timer). Later phases add "cup" and "arm". One pipeline per WebSocket
connection or replay; frames are processed and dropped, events go to the ring and the socket.
"""

from __future__ import annotations

import time
from typing import Any, Literal

import numpy as np

from praxis_session.events import Event, EventRing, make_event
from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import SHEETS
from praxis_session.perception.calibration import CalibrationResult, Calibrator
from praxis_session.perception.cup import CupFSM, CupObservation, CupSheetState
from praxis_session.perception.arm_fsm import ArmFSM, ArmObservation, gate_for
from praxis_session.perception.hand import HandMetrics, HandTracker
from praxis_session.perception.pose import SKELETON, OneEuro, PoseResult, PoseTracker, arm_angles
from praxis_session.perception.nhpt import NHPT
from praxis_session.perception.peg_fsm import Observation
from praxis_session.perception.quality import (
    MarkerSteadiness,
    Presence,
    build_checks,
    lighting,
    task_area_in_view,
)

Mode = Literal["calibrate", "nhpt", "cup", "arm"]
MODES: tuple[str, ...] = ("calibrate", "nhpt", "cup", "arm")
POSE_LOSS_FRAMES = 15
LOSS_FRAMES = 5
REQUIRED_CHECKS = ("camera", "task_area", "markers", "lighting")
REQUIRED_BY_MODE: dict[str, tuple[str, ...]] = {
    "default": REQUIRED_CHECKS,
    "arm": ("camera", "lighting"),  # no sheet; side-view/pose gating lands with the pose checks
}


class SessionPipeline:
    def __init__(
        self,
        mode: Mode,
        sheet: str,
        ring: EventRing | None = None,
        debounce_frames: int = 2,
        clear_frames: int = 3,
        use_hand: bool = True,
        use_pose: bool = True,
        side: str = "left",
        target_deg: float = 90.0,
        hold_s: float = 3.0,
        sets: int = 2,
        reps: int = 8,
        for_mode: str | None = None,
    ) -> None:
        if mode not in MODES:
            raise ValueError(f"bad mode {mode}")
        # In calibrate mode, which exercise the setup is for (arm needs no sheet).
        self.for_mode = for_mode or mode
        if mode == "arm":
            sheet = "nhpt_board" if sheet in ("none", "") else sheet  # no sheet is used in arm mode
        if sheet not in SHEETS:
            raise ValueError(f"bad sheet {sheet}")
        self.mode, self.spec, self.ring = mode, SHEETS[sheet], ring
        self.side = side
        self._cal = Calibrator(self.spec)
        self._steady = MarkerSteadiness()
        self._presence = Presence()
        self._was_calibrated = False
        self._miss_streak = 0
        self._lost = False
        self._board: BoardState | None = None
        self._nhpt: NHPT | None = None
        self._hand: HandTracker | None = None
        self._hand_metrics = HandMetrics()
        if use_hand and mode != "calibrate":
            tracker = HandTracker()
            self._hand = tracker if tracker.available else None
        self._cup_sheet: CupSheetState | None = None
        self._cup: CupFSM | None = None
        self._arm: ArmFSM | None = None
        self._pose: PoseTracker | None = None
        self._angle_filter = OneEuro(min_cutoff=1.5, beta=0.05)
        self._pose_miss = 0
        self._pose_lost = False
        self._pose_seen = False
        if mode == "arm":
            self._arm = ArmFSM(target_deg=target_deg, hold_s=hold_s, sets=sets, reps_per_set=reps)
            if use_pose:
                tracker = PoseTracker()
                self._pose = tracker if tracker.available else None
        if mode == "nhpt":
            self._board = BoardState(self.spec)
            self._nhpt = NHPT(
                spec=self.spec, debounce_frames=debounce_frames, clear_frames=clear_frames
            )
        elif mode == "cup":
            self._cup_sheet = CupSheetState(self.spec)
            self._cup = CupFSM(spec=self.spec, clear_frames=clear_frames)

    # ---- public -------------------------------------------------------------------------
    def process(self, frame_bgr: np.ndarray, t: float, frame_index: int) -> list[Event]:
        if self.mode == "calibrate":
            return self._process_calibrate(frame_bgr, t, frame_index)
        if self.mode == "cup":
            return self._process_cup(frame_bgr, t, frame_index)
        if self.mode == "arm":
            t0 = time.perf_counter()
            res = self._pose.detect(frame_bgr) if self._pose is not None else None
            self._detect_ms = (time.perf_counter() - t0) * 1000.0
            return self.process_pose(res, t, frame_index)
        return self._process_nhpt(frame_bgr, t, frame_index)

    def command(self, cmd: dict[str, Any]) -> dict[str, Any]:
        """Text commands from the client (progression prompt answers etc.)."""
        name = cmd.get("cmd")
        if name == "set_phase" and self._cup is not None:
            try:
                self._cup.set_phase(str(cmd.get("phase")))
            except ValueError as e:
                return {"ok": False, "error": str(e)}
            return {"ok": True, "phase": self._cup.phase}
        return {"ok": False, "error": f"unknown command {name!r} for mode {self.mode}"}

    def snapshot(self, t: float | None = None) -> dict[str, Any]:
        nhpt = None
        reps = 0
        if self._nhpt is not None:
            nhpt = self._nhpt.snapshot(t if t is not None else self._last_t)
            reps = self._nhpt.fsm.reps
        cup = self._cup.snapshot() if self._cup is not None else None
        if cup is not None:
            reps = cup["reaches_total"]
        arm = self._arm.snapshot() if self._arm is not None else None
        if arm is not None:
            reps = arm["reps_total"]
        return {"mode": self.mode, "reps": reps, "nhpt": nhpt, "cup": cup, "arm": arm}

    # ---- internals ----------------------------------------------------------------------
    _last_t: float = 0.0
    _detect_ms: float = 0.0

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
        needs_sheet = self.for_mode != "arm"
        area = task_area_in_view(cal, self.spec, frame_bgr.shape)
        checks = build_checks(cal, light, steady, area, pres, needs_sheet=needs_sheet)
        required = REQUIRED_BY_MODE.get(self.for_mode, REQUIRED_BY_MODE["default"])
        required_ok = all(c["status"] == "pass" for c in checks if c["id"] in required)
        self._emit(
            out,
            make_event(
                "setup_checks", t=t, frame_index=i, checks=checks, all_required_pass=required_ok
            ),
        )
        if needs_sheet:
            self._track_loss(out, cal, t, i)
        return out

    def _hand_block(
        self, frame_bgr: np.ndarray, t: float, cal: CalibrationResult
    ) -> tuple[dict, tuple[float, float] | None]:
        """Run the hand tracker (if available) and return (event block, hand position in mm)."""
        if self._hand is None:
            return {"present": False}, None
        res = self._hand.detect(frame_bgr)
        metrics = self._hand_metrics.update(t, res, cal)
        if res is None:
            return {"present": False}, None
        block = res.to_dict() | {k: v for k, v in metrics.items() if k != "present"}
        block["ms"] = round(self._hand.last_ms, 1)
        hand_mm = None
        if cal.calibrated:
            tips = cal.to_mm(res.landmarks_px[[4, 8]])
            mid = tips.mean(axis=0)
            hand_mm = (float(mid[0]), float(mid[1]))
        return block, hand_mm

    def _process_nhpt(self, frame_bgr: np.ndarray, t: float, i: int) -> list[Event]:
        assert self._board is not None and self._nhpt is not None
        out: list[Event] = []
        self._last_t = t
        t0 = time.perf_counter()
        cal = self._cal.run(frame_bgr)
        board_d: dict[str, Any] | None = None
        holes_px: list[list[float]] = []
        if cal.calibrated:
            canon = self._board.warp(frame_bgr, cal)
            board_d = self._board.to_event_payload(canon)
            holes_px = self._board.holes_frame_px(cal)
        hand_block, hand_mm = self._hand_block(frame_bgr, t, cal)
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
                hand=hand_block,
                models={"hand": self._hand is not None},
                proc_ms=round((time.perf_counter() - t0) * 1000.0, 1),
            ),
        )
        if board_d is not None:
            obs = Observation(
                t=t,
                occupancy=board_d["occupancy"],
                free_pegs_mm=[(float(x), float(y)) for x, y in board_d["free_pegs_mm"]],
                hand_mm=hand_mm,
            )
            for e in self._nhpt.step(obs):
                self._emit(out, e)
        self._track_loss(out, cal, t, i)
        return out

    def _process_cup(self, frame_bgr: np.ndarray, t: float, i: int) -> list[Event]:
        assert self._cup_sheet is not None and self._cup is not None
        out: list[Event] = []
        self._last_t = t
        t0 = time.perf_counter()
        cal = self._cal.run(frame_bgr)
        cup_mm = None
        dots_px: list[list[float]] = []
        cup_px = None
        if cal.calibrated:
            canon = self._cup_sheet.warp(frame_bgr, cal)
            cup_mm = self._cup_sheet.cup_mm(canon)
            dots_px = self._cup_sheet.dots_frame_px(cal)
            if cup_mm is not None:
                cup_px = np.round(cal.to_px(np.array([cup_mm[:2]], np.float32))[0], 1).tolist()
        hand_block, hand_mm = self._hand_block(frame_bgr, t, cal)
        snap = self._cup.snapshot()
        self._emit(
            out,
            make_event(
                "frame",
                t=t,
                frame_index=i,
                calibrated=cal.calibrated,
                missing=cal.missing,
                cup=snap
                | {
                    "cup_mm": None if cup_mm is None else [round(v, 1) for v in cup_mm],
                    "hand_clear": hand_mm is None
                    or self._cup.dot is None
                    or float(
                        np.hypot(*(np.array(hand_mm) - np.array(self._cup.dots[self._cup.dot])))
                    )
                    > self._cup.hand_clear_mm,
                },
                overlay={
                    "dots_px": dots_px,
                    "cup_px": cup_px,
                    "expected_next": snap["expected_next"],
                    "markers_px": {
                        str(k): np.round(v, 1).tolist() for k, v in cal.marker_corners_px.items()
                    },
                },
                hand=hand_block,
                models={"hand": self._hand is not None},
                proc_ms=round((time.perf_counter() - t0) * 1000.0, 1),
            ),
        )
        obs = CupObservation(t=t, cup_mm=cup_mm, hand_mm=hand_mm, calibrated=cal.calibrated)
        for e in self._cup.step(obs):
            self._emit(out, e)
        self._track_loss(out, cal, t, i)
        return out

    def process_pose(self, res: PoseResult | None, t: float, frame_index: int) -> list[Event]:
        """Arm mode from a pose result (the model output, or injected landmarks in tests/replay)."""
        assert self._arm is not None
        out: list[Event] = []
        self._last_t = t
        t0 = time.perf_counter()
        angles: dict[str, Any] | None = None
        skeleton: list[list[list[float]]] = []
        ghost: list[float] | None = None
        shoulder_px: list[float] | None = None
        if res is not None:
            angles = arm_angles(res, self.side)
            angles["shoulder_deg"] = round(self._angle_filter.filter(t, angles["shoulder_deg"]), 1)
            lm = res.landmarks_px
            skeleton = [
                [np.round(lm[a], 1).tolist(), np.round(lm[b], 1).tolist()] for a, b in SKELETON
            ]
            si = 11 if self.side == "left" else 12
            ei, hi = si + 2, si + 12
            sh, el, hp = lm[si], lm[ei], lm[hi]
            shoulder_px = np.round(sh, 1).tolist()
            trunk = hp - sh
            if np.linalg.norm(trunk) > 1e-6:
                d = trunk / np.linalg.norm(trunk)
                arm_len = float(np.linalg.norm(el - sh))
                a = np.radians(self._arm.target_deg)
                cands = []
                for sgn in (1, -1):
                    rot = np.array(
                        [[np.cos(sgn * a), -np.sin(sgn * a)], [np.sin(sgn * a), np.cos(sgn * a)]]
                    )
                    cands.append(sh + arm_len * (rot @ d))
                cur = el - sh
                best = min(cands, key=lambda c: -float(np.dot(c - sh, cur)))
                ghost = np.round(best, 1).tolist()
        else:
            self._angle_filter.reset()
        obs = ArmObservation(
            t=t,
            shoulder_deg=None if angles is None else angles["shoulder_deg"],
            trunk_lean_deg=0.0 if angles is None else angles["trunk_lean_deg"],
            shoulder_hike_norm=0.0 if angles is None else angles["shoulder_hike_norm"],
            view_ok=bool(angles and angles["view_ok"]),
            visibility=1.0 if angles is None else angles["visibility"],
            hip_visibility=1.0 if angles is None else angles["hip_visibility"],
            shoulders_visibility=1.0 if angles is None else angles["shoulders_visibility"],
        )
        # The gate for *this* frame goes out with the frame (the snapshot lags one step).
        snap_before = self._arm.snapshot() | {"gate": gate_for(obs)}
        self._emit(
            out,
            make_event(
                "frame",
                t=t,
                frame_index=frame_index,
                calibrated=res is not None,
                missing=[],
                arm=snap_before | ({} if angles is None else {"angles": angles}),
                pose=(
                    {"present": False}
                    if res is None
                    else res.to_dict() | {"ms": round(self._pose.last_ms, 1) if self._pose else 0.0}
                ),
                overlay={
                    "skeleton_px": skeleton,
                    "shoulder_px": shoulder_px,
                    "ghost_target_px": ghost,
                },
                models={"hand": self._hand is not None, "pose": self._pose is not None},
                proc_ms=round((time.perf_counter() - t0) * 1000.0 + self._detect_ms, 1),
            ),
        )
        self._detect_ms = 0.0
        for e in self._arm.step(obs):
            self._emit(out, e)
        # pose loss bookkeeping (mirrors marker loss)
        if res is not None:
            self._pose_seen, self._pose_miss = True, 0
            if self._pose_lost:
                self._pose_lost = False
                self._emit(out, make_event("perception_regained", t=t, frame_index=frame_index))
        elif self._pose_seen:
            self._pose_miss += 1
            if self._pose_miss >= POSE_LOSS_FRAMES and not self._pose_lost:
                self._pose_lost = True
                self._emit(out, make_event("perception_lost", t=t, frame_index=frame_index, missing=["pose"]))
        return out
