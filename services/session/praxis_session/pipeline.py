"""Per-frame composition of perception stages into events (OpenCV cv2.__version__ == 5.0.0).

Modes: "calibrate" (Phase 1: calibration + setup checks) and "nhpt" (Phase 2: board state ->
peg FSM -> NHPT timer). Later phases add "cup" and "arm". One pipeline per WebSocket
connection or replay; frames are processed and dropped, events go to the ring and the socket.

Agent coach support (29 Sep): `latest_frame` holds a *reference* to the frame being processed,
overwritten by the next one and never written anywhere, so `check_setup()` can run the setup
checks (`perception.quality`) and a fresh ArUco detection (`cv2.aruco.ArucoDetector`,
`cv2.findHomography`, `cv2.solvePnP`) on demand. `recalibrate` resets the calibrator (sheet
tasks) or the pose gate (arm) on the next frame; `set_target` / `set_reps` are clamped to the
prescription in code like `set_hold`. Only numbers and short text come back, never pixels.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any, Literal

import numpy as np

from praxis_session.events import Event, EventRing, make_event
from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import SHEETS
from praxis_session.perception.calibration import CalibrationResult, Calibrator
from praxis_session.perception.cup import CupFSM, CupObservation, CupSheetState
from praxis_session.perception.arm_fsm import ArmFSM, ArmObservation, gate_for
from praxis_session.perception.exercises import resolve
from praxis_session.perception.hand import HandMetrics, HandTracker
from praxis_session.perception.pose import (
    SKELETON,
    OneEuro,
    PoseResult,
    PoseTracker,
    arm_angles,
    shoulder_elevation_deg,
)
from praxis_session.perception.nhpt import NHPT
from praxis_session.prescription import SEED_PRESCRIPTION, Prescription, clamp
from praxis_session.perception.peg_fsm import Observation
from praxis_session.perception.quality import (
    MarkerSteadiness,
    Presence,
    build_checks,
    camera_angle,
    lighting,
    task_area_in_view,
)

Mode = Literal["calibrate", "nhpt", "cup", "arm"]
MODES: tuple[str, ...] = ("calibrate", "nhpt", "cup", "arm")
POSE_LOSS_FRAMES = 15
# Uncalibrated frames (after the 1.5 s hold in Calibrator) before `perception_lost` (D-CAL-1).
LOSS_FRAMES = 20
DEBOUNCE_S = 0.25  # NHPT occupancy debounce in seconds (D-SEG-1); frame counts are a floor
TIER_RANK: dict[str, int] = {"full": 0, "gentle": 1, "rest": 2}  # same order as plan.TIER_RANK
# `angle` (camera tilt from the ArUco pose, <= 25°) joined the sheet tasks' gate in D-CAL-3.
REQUIRED_CHECKS = ("camera", "task_area", "markers", "angle", "lighting")
REQUIRED_BY_MODE: dict[str, tuple[str, ...]] = {
    "default": REQUIRED_CHECKS,
    "arm": ("camera", "lighting"),  # no sheet; side-view/pose gating lands with the pose checks
}


def _row(id_: str, label: str, ok: bool | None, hint: str | None) -> dict[str, Any]:
    """One setup-check row, the same shape `quality.build_checks` returns."""
    status = "pending" if ok is None else ("pass" if ok else "check")
    return {"id": id_, "label": label, "status": status, "hint": None if ok else hint}


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
        target_deg: float | None = None,
        hold_s: float | None = None,
        sets: int | None = None,
        reps: int | None = None,
        for_mode: str | None = None,
        exercise: str | None = None,
        tier: str = "full",
        prescription: Prescription | None = None,
    ) -> None:
        """`exercise` picks the `perception/exercises.py` entry that drives arm mode (default
        `flexion`, i.e. Arm to the front exactly as before) and `tier` applies its gentle
        overrides; `target_deg`/`hold_s`/`sets`/`reps` still override both when given.
        `prescription` (default: the seed) supplies the tier clamps, the lean thresholds and
        the range `set_hold` is clamped to."""
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
        self._metric_filter = OneEuro(min_cutoff=1.5, beta=0.05)  # the exercise's own metric
        self._pose_miss = 0
        self._pose_lost = False
        self._pose_seen = False
        # Agent tools (29 Sep): the frame being processed, by reference only; the last
        # calibration / pose summaries (numbers only); recent marker corners for steadiness.
        self.latest_frame: np.ndarray | None = None
        self._latest_frame_mono = 0.0
        self.last_calibration: dict[str, Any] | None = None
        self.last_pose: dict[str, Any] | None = None
        self._recent_markers: deque[dict[int, np.ndarray]] = deque(maxlen=10)
        self._recal_pending = False
        self.frames_since_recalibrate: int | None = None
        self.tier = tier
        self.prescription = SEED_PRESCRIPTION if prescription is None else prescription
        self._arm_args: dict[str, Any] = {"target_deg": target_deg, "hold_s": hold_s, "sets": sets, "reps_per_set": reps, "prescription": self.prescription}
        if mode == "arm":
            self._arm = ArmFSM(exercise, tier, **self._arm_args)
            if use_pose:
                tracker = PoseTracker()
                self._pose = tracker if tracker.available else None
        if mode == "nhpt":
            self._board = BoardState(self.spec)
            self._nhpt = NHPT(
                spec=self.spec,
                debounce_frames=debounce_frames,
                clear_frames=clear_frames,
                debounce_s=DEBOUNCE_S,
            )
        elif mode == "cup":
            self._cup_sheet = CupSheetState(self.spec)
            dose = resolve("cup", tier, self.prescription)  # gentle: slow arcs only, if allowed
            self._cup = CupFSM(spec=self.spec, clear_frames=clear_frames, slow_arcs=dose.slow_arcs, fast_arcs=dose.fast_arcs)

    # ---- public -------------------------------------------------------------------------
    def process(self, frame_bgr: np.ndarray, t: float, frame_index: int) -> list[Event]:
        # A reference, not a copy: the next frame replaces it; nothing is ever written out.
        self.latest_frame = frame_bgr
        self._latest_frame_mono = time.monotonic()
        if self._recal_pending:
            self._apply_recalibrate()
        evs = self._process_mode(frame_bgr, t, frame_index)
        if self.frames_since_recalibrate is not None:
            self.frames_since_recalibrate += 1  # counted once the frame is fully processed
        return evs

    def _process_mode(self, frame_bgr: np.ndarray, t: float, frame_index: int) -> list[Event]:
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

    def apply_tier(self, tier: str) -> dict[str, Any]:
        """Tighten the running dose to `tier` (the pain tier from the check-in). Never loosens,
        and never changes a dose the patient has already started: once a rep or a reach exists
        the session keeps its tier. `rest` changes nothing here; the pain stop rule ends the
        session. Returns the tier now running and whether it changed."""
        if tier not in TIER_RANK or TIER_RANK[tier] <= TIER_RANK.get(self.tier, 0) or tier == "rest":
            return {"tier": self.tier, "changed": False}
        if self._arm is None and self._cup is None:
            return {"tier": self.tier, "changed": False}  # the peg test is standardized: no tier
        if self._arm is not None:
            if self._arm.started or self._arm.reps:
                return {"tier": self.tier, "changed": False}
            self._arm = ArmFSM(self._arm.exercise.id, tier, **self._arm_args)
        if self._cup is not None:
            if self._cup.reaches:
                return {"tier": self.tier, "changed": False}
            dose = resolve("cup", tier, self.prescription)
            self._cup.slow_arcs, self._cup.fast_arcs = dose.slow_arcs, dose.fast_arcs
        self.tier = tier
        return {"tier": tier, "changed": True}

    def command(self, cmd: dict[str, Any]) -> dict[str, Any]:
        """Text commands from the client (progression prompt answers etc.)."""
        name = cmd.get("cmd")
        if name == "set_hold":
            return self._set_hold(cmd)
        if name == "set_target":
            return self._set_arm_field(cmd, "target_deg")
        if name == "set_reps":
            return self._set_arm_field(cmd, "reps")
        if name == "recalibrate" and self.mode != "calibrate":
            self._recal_pending = True
            self.frames_since_recalibrate = 0
            return {"ok": True, "mode": self.mode, "reset": "pose_gate" if self.mode == "arm" else "calibrator"}
        if name == "set_phase" and self._cup is not None:
            try:
                self._cup.set_phase(str(cmd.get("phase")))
            except ValueError as e:
                return {"ok": False, "error": str(e)}
            return {"ok": True, "phase": self._cup.phase}
        if name == "sample_colour" and self.mode in ("nhpt", "cup"):
            # Tap-to-sample: {"x_mm", "y_mm"} on the sheet, or {"hole": k} for a peg seated in
            # hole k. Samples the last calibrated canonical view (D-SEG-1 / D-SEG-3).
            if self._last_canon is None:
                return {"ok": False, "error": "no calibrated frame seen yet"}
            if "hole" in cmd:
                try:
                    xy = self.spec.targets_mm[int(cmd["hole"])]
                except (ValueError, TypeError, IndexError):
                    return {"ok": False, "error": f"bad hole {cmd.get('hole')!r}"}
            elif "x_mm" in cmd and "y_mm" in cmd:
                xy = (float(cmd["x_mm"]), float(cmd["y_mm"]))
            else:
                return {"ok": False, "error": "sample_colour needs x_mm/y_mm or hole"}
            try:
                if self._board is not None:
                    rng = self._board.sample_peg_colour(self._last_canon, xy)
                else:
                    assert self._cup_sheet is not None
                    rng = self._cup_sheet.sample_cup_colour(self._last_canon, xy)
            except ValueError as e:
                return {"ok": False, "error": str(e)}
            return {"ok": True, "mode": self.mode, "colour": rng, "at_mm": [xy[0], xy[1]]}
        return {"ok": False, "error": f"unknown command {name!r} for mode {self.mode}"}

    def _set_hold(self, cmd: dict[str, Any]) -> dict[str, Any]:
        """The coach's regress, applied: change the hold the arm FSM needs, clamped **in code**
        to the prescription's `allowed_adaptations[<rx key>].hold_s` (never above it, never
        below it). Refused for the pendulum (no hold), the sheet tasks and any exercise whose
        prescription does not list the hold as adaptable."""
        if self._arm is None or self._arm.kind != "hold":
            return {"ok": False, "error": "set_hold needs a hold exercise (Arm to the front / Arm out to the side)"}
        ex = self._arm.exercise
        try:
            wanted = float(cmd["hold_s"])
        except (KeyError, TypeError, ValueError):
            return {"ok": False, "error": "set_hold needs a numeric hold_s"}
        try:
            hold = clamp(self.prescription, ex.rx, "hold_s", wanted)
        except KeyError:
            return {"ok": False, "error": f"{ex.rx}.hold_s is not an allowed adaptation"}
        self._arm.set_hold(hold)
        self._arm_args["hold_s"] = hold
        return {"ok": True, "exercise": ex.id, "rx": ex.rx, "hold_s": hold, "requested_hold_s": wanted, "clamped": hold != wanted}

    def _set_arm_field(self, cmd: dict[str, Any], field: str) -> dict[str, Any]:
        """`set_target` / `set_reps`: an accepted agent adjustment, clamped **in code** to the
        prescription's `allowed_adaptations[<rx key>]` (target also to the ceiling)."""
        key = "target_deg" if field == "target_deg" else "reps"
        if self._arm is None or self._arm.kind != "hold":
            return {"ok": False, "error": f"set_{'target' if key == 'target_deg' else 'reps'} needs a hold exercise (Arm out to the side)"}
        ex = self._arm.exercise
        try:
            wanted = float(cmd[key])
        except (KeyError, TypeError, ValueError):
            return {"ok": False, "error": f"needs a numeric {key}"}
        try:
            value = clamp(self.prescription, ex.rx, key, wanted)
        except KeyError:
            return {"ok": False, "error": f"{ex.rx}.{key} is not an allowed adaptation"}
        if key == "target_deg":
            self._arm.set_target(value)
            value = self._arm.target_deg
            self._arm_args["target_deg"] = value
        else:
            value = int(round(value))
            self._arm.set_reps(value)
            self._arm_args["reps_per_set"] = value
        return {"ok": True, "exercise": ex.id, "rx": ex.rx, key: value, f"requested_{key}": wanted, "clamped": value != wanted}

    def _apply_recalibrate(self) -> None:
        """Reset on the frame thread (never from the tool's thread): sheet tasks get a fresh
        calibrator (all four markers needed again), arm gets a fresh pose gate."""
        self._recal_pending = False
        if self.mode == "arm":
            self._angle_filter.reset()
            self._metric_filter.reset()
            self._pose_miss = 0
            if self._arm is not None:
                self._arm.gate = None
        else:
            self._cal = Calibrator(self.spec)
            self._steady = MarkerSteadiness()
            self._recent_markers.clear()

    def check_setup(self) -> dict[str, Any]:
        """The setup checks, run now on the latest in-memory frame (agent tool `check_setup`).

        Sheet tasks: a fresh `Calibrator` (no held homography) detects the ArUco markers and
        fits the homography; task area, camera tilt (solvePnP), lighting/sharpness and marker
        steadiness come from `perception.quality`. Arm: the last pose summary (person, joint
        visibility, view gate) plus lighting. Returns rows `{id, label, status, hint}`, the
        failing ids and the numbers behind them; never pixels."""
        frame = self.latest_frame
        if frame is None:
            return {"ok": False, "error": "no camera frame has arrived yet", "checks": [], "failing": []}
        age = round(time.monotonic() - self._latest_frame_mono, 2)
        light = lighting(frame)
        measures: dict[str, Any] = {"mean_luma": light["mean_luma"], "sharpness": light["sharpness"]}
        if self.mode == "arm" or self.for_mode == "arm":
            pose = self.last_pose or {"present": False}
            present = bool(pose.get("present"))
            vis = pose.get("visibility")
            gate = pose.get("gate")
            view_hint = {"turn_front": "Face the camera with both shoulders in view.", "turn_side": "Turn side-on so your practising shoulder faces the camera."}.get(str(gate))
            checks = [
                _row("person", "Person in view", present, "Sit so your upper body is in the picture."),
                _row("pose", "Shoulder, elbow and hip visible", None if not present else (vis is not None and vis >= 0.5), "Move back a little so your shoulder, elbow and hip are all in view."),
                _row("view", "Facing the camera the right way", None if not present else gate not in ("turn_front", "turn_side"), view_hint),
                _row("hips", "Hips in view", None if not present else gate != "hips_out_of_view", "Move the camera back or down so your hips are in view."),
                _row("lighting", "Lighting", bool(light["ok"]), light.get("hint")),
            ]
            measures |= {"pose_present": present, "visibility": vis, "gate": gate}
        else:
            cal = Calibrator(self.spec).run(frame, 0.0)
            steady = MarkerSteadiness()
            for m in list(self._recent_markers):
                steady.update(m)
            steady_d = steady.update(cal.marker_corners_px)
            area = task_area_in_view(cal, self.spec, frame.shape)
            rows = build_checks(cal, light, steady_d, area, {"present": None}, needs_sheet=True)
            # Root cause first: without the markers, task area and tilt cannot be judged.
            order = {"markers": 0, "angle": 1, "task_area": 2, "lighting": 3}
            checks = sorted((r for r in rows if r["id"] not in ("camera", "person")), key=lambda r: order.get(r["id"], 9))
            angle = camera_angle(cal)
            measures |= {
                "markers_found": sorted(int(k) for k in cal.marker_corners_px),
                "markers_missing": list(cal.missing),
                "rms_mm": None if cal.rms_mm is None else round(float(cal.rms_mm), 3),
                "tilt_deg": angle["tilt_deg"],
                "jitter_px": steady_d["jitter_px"],
            }
        failing = [c["id"] for c in checks if c["status"] != "pass"]
        first_hint = next((c["hint"] for c in checks if c["status"] == "check" and c["hint"]), None)
        return {"ok": True, "mode": self.mode, "frame_age_s": age, "checks": checks, "failing": failing, "all_pass": not failing, "first_hint": first_hint, "measures": measures}

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
    _last_canon: np.ndarray | None = None  # last calibrated canonical view (sample_colour)

    def _note_calibration(self, cal: CalibrationResult) -> None:
        """Numbers-only summary of this frame's calibration for the agent's tools."""
        self.last_calibration = {
            "calibrated": cal.calibrated,
            "source": cal.source,
            "missing": list(cal.missing),
            "markers_found": sorted(int(k) for k in cal.marker_corners_px),
            "rms_mm": None if cal.rms_mm is None else round(float(cal.rms_mm), 3),
            "tilt_deg": None if cal.tilt_deg is None else round(float(cal.tilt_deg), 1),
        }
        if cal.marker_corners_px:
            self._recent_markers.append(dict(cal.marker_corners_px))

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
        cal = self._cal.run(frame_bgr, t)
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
                "quality",
                t=t,
                frame_index=i,
                lighting=light,
                steadiness=steady,
                presence=pres,
                angle=camera_angle(cal),
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
    ) -> tuple[dict, tuple[float, float] | None, tuple[float, float, float, float] | None]:
        """Run the hand tracker (if available) and return (event block, thumb/index midpoint in
        mm, hand bounding box in sheet mm as x0 y0 x1 y1). Both mm values are sheet-plane
        projections of a hand above the sheet: relative, not calibrated to the hand's height."""
        if self._hand is None:
            return {"present": False}, None, None
        res = self._hand.detect(frame_bgr)
        metrics = self._hand_metrics.update(t, res, cal)
        if res is None:
            return {"present": False}, None, None
        block = res.to_dict() | {k: v for k, v in metrics.items() if k != "present"}
        block["ms"] = round(self._hand.last_ms, 1)
        hand_mm = None
        rect_mm = None
        if cal.calibrated:
            tips = cal.to_mm(res.landmarks_px[[4, 8]])
            mid = tips.mean(axis=0)
            hand_mm = (float(mid[0]), float(mid[1]))
            lm_mm = cal.to_mm(res.landmarks_px)
            lo, hi = lm_mm.min(axis=0), lm_mm.max(axis=0)
            rect_mm = (float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1]))
        return block, hand_mm, rect_mm

    def _process_nhpt(self, frame_bgr: np.ndarray, t: float, i: int) -> list[Event]:
        assert self._board is not None and self._nhpt is not None
        out: list[Event] = []
        self._last_t = t
        t0 = time.perf_counter()
        cal = self._cal.run(frame_bgr, t)  # t: the 1.5 s hold is measured in clip/stream time
        self._note_calibration(cal)
        board_d: dict[str, Any] | None = None
        holes_px: list[list[float]] = []
        # The hand runs first so its box can be excluded from the free-peg blobs (D-SEG-1).
        hand_block, hand_mm, hand_rect = self._hand_block(frame_bgr, t, cal)
        if cal.calibrated:
            canon = self._board.warp(frame_bgr, cal)
            self._last_canon = canon
            board_d = self._board.to_event_payload(
                canon, exclude_mm=[hand_rect] if hand_rect is not None else None
            )
            holes_px = self._board.holes_frame_px(cal)
        occ = board_d["occupancy"] if board_d else {}
        # Any-hole mode: no suggested hole, so the UI draws no amber ring (D-SEG-2).
        next_hole = None
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
                        "colour": board_d["colour"],
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
            free = [(float(x), float(y)) for x, y in board_d["free_pegs_mm"]]
            in_zone = hand_mm is not None and (
                self._board.in_source_zone(hand_mm)
                or any(float(np.hypot(hand_mm[0] - x, hand_mm[1] - y)) <= 40.0 for x, y in free)
            )
            obs = Observation(
                t=t,
                occupancy=board_d["occupancy"],
                free_pegs_mm=free,
                hand_mm=hand_mm,
                pinch_mm=hand_block.get("pinch_rel_mm"),
                hand_in_source_zone=in_zone,
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
        cal = self._cal.run(frame_bgr, t)  # t: the 1.5 s hold is measured in clip/stream time
        self._note_calibration(cal)
        cup_mm = None
        dots_px: list[list[float]] = []
        cup_px = None
        if cal.calibrated:
            canon = self._cup_sheet.warp(frame_bgr, cal)
            self._last_canon = canon
            cup_mm = self._cup_sheet.cup_mm(canon)
            dots_px = self._cup_sheet.dots_frame_px(cal)
            if cup_mm is not None:
                cup_px = np.round(cal.to_px(np.array([cup_mm[:2]], np.float32))[0], 1).tolist()
        hand_block, hand_mm, _ = self._hand_block(frame_bgr, t, cal)
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
                    "colour": self._cup_sheet.colour_range,
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
        ex = self._arm.exercise
        if res is not None:
            angles = arm_angles(res, self.side)
            angles["shoulder_deg"] = round(self._angle_filter.filter(t, angles["shoulder_deg"]), 1)
            # The FSM scores the exercise's own metric (the shoulder angle for the lifts, the
            # rotation or the pendulum swing otherwise), One-Euro smoothed like the angle.
            angles["metric"] = ex.id
            angles["metric_deg"] = round(
                self._metric_filter.filter(t, float(ex.metric(res, self.side))), 1
            )
            lm = res.landmarks_px
            skeleton = [
                [np.round(lm[a], 1).tolist(), np.round(lm[b], 1).tolist()] for a, b in SKELETON
            ]
            si = 11 if self.side == "left" else 12
            ei, hi = si + 2, si + 12
            sh, el, hp = lm[si], lm[ei], lm[hi]
            shoulder_px = np.round(sh, 1).tolist()
            trunk = hp - sh
            # The ghost arm only means anything for the lifts, whose metric is the image-plane
            # shoulder angle; a rotation or a pendulum swing has no such target pose.
            if ex.metric is shoulder_elevation_deg and np.linalg.norm(trunk) > 1e-6:
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
            self._metric_filter.reset()
        obs = ArmObservation(
            t=t,
            shoulder_deg=None if angles is None else angles["metric_deg"],
            trunk_lean_deg=0.0 if angles is None else angles["trunk_lean_deg"],
            shoulder_hike_norm=0.0 if angles is None else angles["shoulder_hike_norm"],
            view_ok=bool(angles and angles["view_ok"]),
            visibility=1.0 if angles is None else angles["visibility"],
            hip_visibility=1.0 if angles is None else angles["hip_visibility"],
            shoulders_visibility=1.0 if angles is None else angles["shoulders_visibility"],
        )
        # The gate for *this* frame goes out with the frame (the snapshot lags one step).
        snap_before = self._arm.snapshot() | {"gate": gate_for(obs, self._arm.view)}
        self.last_pose = {
            "present": res is not None,
            "visibility": None if angles is None else round(float(angles["visibility"]), 2),
            "hip_visibility": None if angles is None else round(float(angles["hip_visibility"]), 2),
            "gate": snap_before["gate"] if res is not None else None,
            "angle_deg": None if angles is None else angles["metric_deg"],
        }
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
