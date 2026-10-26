"""Guided shoulder exercise finite-state machine (no OpenCV call here; the landmarks it scores
come from `perception/pose.py`, which runs `cv2.dnn` on OpenCV cv2.__version__ == 5.0.0).

One FSM for every arm entry in `perception/exercises.py` (pipeline "arm"; demo-only and sheet
entries are refused with ValueError). A registry entry supplies the metric,
the required camera view, the target, the in-code ceiling, the dose and the tier overrides, so
adding an exercise never edits this file. `ArmFSM()` with no argument is still "Arm to the
front" (`flexion`) with its original behaviour.

Two rep shapes:
- `kind="hold"` (Arm to the front, Arm out to the side): `start_pose -> moving -> target_reached -> hold ->
  return (-> start_pose)`, one rep per return. A rep is verified when it reached
  target - tolerance and held for `hold_s`; `target_missed` / `hold_too_short` reps are
  counted but unverified.
- `kind="oscillation"` (pendulum): no hold and no target to reach. The signed swing angle is
  band-passed with hysteresis and one rep is a full to-and-fro; the rep is verified when its
  peak-to-peak amplitude reached `target_deg - tolerance_deg` (15 deg), otherwise it is
  counted with reason `swing_too_small`. **Approximation, validated on synthetic landmark
  streams only** (report §10).

Events: exercise_start, state_change, rep_complete{verified, reason, above_ceiling},
target_missed, hold_too_short, compensation_lean, shoulder_hiking,
above_ceiling{set, rep, angle_deg, ceiling_deg}, set_complete{verified_reps, best_deg,
above_ceiling_count}, arm_complete. Angles are camera-relative progress, never clinical goniometry; the target is
clamped to the exercise's ceiling in code (a guardrail in code).

Gating: the image-plane metric only means something from
the view the exercise needs, so the FSM freezes (no transitions, no compensation events; the
angle is still reported for display) while the view is wrong (`gate = "turn_side"` for
side-view exercises, `"turn_front"` for front-view ones) or the practising-side
shoulder/elbow/hip visibility is below `MIN_VISIBILITY` (`gate = "hips_out_of_view"`).
Compensation checks run for `kind="hold"` only: the pendulum is done leaning forward on purpose,
so it never raises `compensation_lean` or `shoulder_hiking` (24 Sep review).
`compensation_lean` needs the lean to persist for `lean_persist_s` with both hips visible;
`shoulder_hiking` needs both shoulders and both hips visible (the hike is in trunk lengths). A
seated patient with the hips behind a desk or below a laptop's frame therefore gets no lean or
hike flags. Front-view exercises gate on the practising shoulder and elbow only (the pipeline
passes that visibility; 25 Oct): BlazePose still places hips just below the frame well enough
for the angle (REHAB24-6 cropped to laptop framing, `docs/TECHNICAL_REPORT.md`), so a missing
hip no longer freezes Arm out to the side. A dip under the start line within `MIN_LIFT_S` of
leaving it is not a rep.

Shoulder hike is angle-aware (12 Oct): healthy abduction raises the shoulder with the arm
(scapulohumeral rhythm), so the fixed limit used until 11 Oct (0.08 trunk lengths over the rest
baseline) fired on most correct REHAB24-6 lifts near 90 deg. The default limit is now
`hike_allowance(angle)` = the healthy curve (p95 of the product's own hike number per 10 deg bin
of the scored angle, correct repetitions of held-in REHAB24-6 subjects, made monotone) plus
`HIKE_MARGIN`, and the excess must persist for `HIKE_PERSIST_FRAMES` consecutive scored frames.
Fitted and tested on held-out subjects by `evaluation/scripts/rehab24_thresholds.py`
(`evaluation/results/rehab24_thresholds_v0.md`). The subjects are healthy adults standing in a
lab, so the allowance is a population p95, not a patient norm, and shrug sensitivity is checked
on synthetic streams only (no labelled real shrugs). An explicit `hike_limit` keeps the old
fixed, single-frame behaviour (tests, comparisons).

`above_ceiling` (10 Oct, `kind="hold"` only): the smoothed metric (One-Euro in the pipeline) above
`ceiling_deg + ABOVE_CEILING_TOL_DEG` (90 + 5 for Arm out to the side) for
`ABOVE_CEILING_FRAMES` consecutive scored frames while lifting or holding; at most once per rep.
It is a coaching event, not a stop rule: the rep is still counted and verified by the usual
target/hold logic, and carries `above_ceiling: true`. The tolerance absorbs landmark jitter around
the line; both numbers are tuned on synthetic landmark streams only (report §10).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from praxis_session.events import Event, make_event
from praxis_session.perception.exercises import Exercise, resolve
from praxis_session.prescription import SEED_PRESCRIPTION, Prescription

STATES = ("start_pose", "moving", "target_reached", "hold", "return")
MIN_VISIBILITY = 0.5
GATES = ("turn_side", "turn_front", "hips_out_of_view")
# Lifting past the in-code ceiling: how far over (camera-relative degrees) and for how many
# consecutive scored frames (~0.2-0.3 s at 10-15 fps) before `above_ceiling` fires.
ABOVE_CEILING_TOL_DEG = 5.0
ABOVE_CEILING_FRAMES = 3
# Healthy shoulder elevation by arm angle: (scored angle deg, p95 hike over the rest baseline in
# trunk lengths), copied from evaluation/results/rehab24_thresholds_v0.json ("shipped_curve");
# tests/test_arm_fsm.py checks the two agree. Linear between knots, flat outside them.
HEALTHY_HIKE_CURVE: tuple[tuple[float, float], ...] = (
    (5.0, 0.028), (15.0, 0.028), (25.0, 0.028), (35.0, 0.028), (45.0, 0.042), (55.0, 0.058),
    (65.0, 0.083), (75.0, 0.098), (85.0, 0.112), (95.0, 0.12), (105.0, 0.137), (115.0, 0.166),
    (125.0, 0.178), (135.0, 0.189), (145.0, 0.205), (155.0, 0.21), (165.0, 0.21),
)
HIKE_MARGIN = 0.05  # trunk lengths (~2.5 cm on a 50 cm trunk) above the healthy p95
HIKE_PERSIST_FRAMES = 3  # consecutive scored frames over the allowance (~0.2-0.3 s)
# A lift that drops back under the start line sooner than this, without reaching the target, is
# not a rep (25 Oct, team test 23 Oct: with the hips guessed below a laptop's frame, landmark
# jitter at rest crossed the start line for 0.3-0.6 s and was counted as a missed rep with a
# 32-46 deg peak). No labelled REHAB24-6 lift is shorter than 1 s.
MIN_LIFT_S = 0.8


def hike_allowance(
    angle_deg: float,
    curve: tuple[tuple[float, float], ...] = HEALTHY_HIKE_CURVE,
    margin: float = HIKE_MARGIN,
) -> float:
    """Shoulder elevation (trunk lengths over the rest baseline) allowed at this arm angle."""
    xs, ys = [k[0] for k in curve], [k[1] for k in curve]
    a = float(angle_deg)
    if a <= xs[0]:
        y = ys[0]
    elif a >= xs[-1]:
        y = ys[-1]
    else:
        i = next(k for k in range(1, len(xs)) if a <= xs[k])
        y = ys[i - 1] + (a - xs[i - 1]) / (xs[i] - xs[i - 1]) * (ys[i] - ys[i - 1])
    return round(y + margin, 4)


# FSM state -> the phase the avatar and the big count follow.
PHASES = {
    "start_pose": "start",
    "moving": "lift",
    "target_reached": "hold",
    "hold": "hold",
    "return": "lower",
}


@dataclass(frozen=True)
class ArmObservation:
    t: float
    shoulder_deg: float | None  # the exercise's metric in degrees, camera-relative
    trunk_lean_deg: float
    shoulder_hike_norm: float
    view_ok: bool  # True = side view (shoulders stacked); front-view exercises want False
    visibility: float = 1.0  # min over the practising-side shoulder, elbow, hip
    hip_visibility: float = 1.0  # min over both hips (lean)
    shoulders_visibility: float = 1.0  # min over both shoulders (hike)
    # Front-view exercises: shoulders far enough apart (pose.FRONT_SEP_MIN). None = derive it
    # from `view_ok` (not side-on), as before 12 Oct.
    front_view_ok: bool | None = None


def gate_for(obs: ArmObservation, view: str = "side") -> str | None:
    """Why the FSM is frozen for this observation, or None. No pose at all is not a gate
    (pose loss is reported separately as perception_lost)."""
    if obs.shoulder_deg is None:
        return None
    if view == "front":
        front_ok = (not obs.view_ok) if obs.front_view_ok is None else obs.front_view_ok
        if not front_ok:  # shoulders (nearly) stacked: the patient is turned from the camera
            return "turn_front"
    elif not obs.view_ok:
        return "turn_side"
    if obs.visibility < MIN_VISIBILITY:
        return "hips_out_of_view"
    return None


class ArmFSM:
    def __init__(
        self,
        exercise: str | Exercise | None = None,
        tier: str = "full",
        target_deg: float | None = None,
        ceiling_deg: float | None = None,
        hold_s: float | None = None,
        sets: int | None = None,
        reps_per_set: int | None = None,
        start_below_deg: float | None = None,
        tolerance_deg: float | None = None,
        lean_limit_deg: float | None = None,
        lean_events_to_flag: int | None = None,
        hike_limit: float | None = None,
        hike_persist_frames: int | None = None,
        hike_curve: tuple[tuple[float, float], ...] = HEALTHY_HIKE_CURVE,
        hike_margin: float = HIKE_MARGIN,
        baseline_frames: int = 10,
        lean_persist_s: float = 0.5,
        prescription: Prescription | None = None,
    ) -> None:
        # The lean limits are the prescription's stop-rule thresholds (the same numbers the
        # stop rule and its therapist-flag text use), not constants copied here.
        rx = SEED_PRESCRIPTION if prescription is None else prescription
        lean_limit_deg = rx.stop_rules.lean_deg if lean_limit_deg is None else lean_limit_deg
        if lean_events_to_flag is None:
            lean_events_to_flag = rx.stop_rules.lean_events
        ex = resolve(exercise, tier, rx)
        if ex.pipeline != "arm" or ex.metric is None:
            # Demo-only entries (the rotations) and the sheet activities have no pose metric:
            # the arm FSM must never produce a camera-verified rep for them.
            raise ValueError(f"{ex.id} is not scored by the arm FSM (mode={ex.mode}, pipeline={ex.pipeline})")
        self.exercise, self.tier = ex, tier
        self.view, self.kind = ex.view, ex.kind
        self.ceiling_deg = ex.ceiling_deg if ceiling_deg is None else ceiling_deg
        wanted = ex.target_deg if target_deg is None else target_deg
        self.clamped = wanted > self.ceiling_deg
        self.target_deg = min(wanted, self.ceiling_deg)
        self.hold_s = ex.hold_s if hold_s is None else hold_s
        self.sets = ex.sets if sets is None else sets
        self.reps_per_set = ex.reps if reps_per_set is None else reps_per_set
        self.start_below_deg = ex.start_below_deg if start_below_deg is None else start_below_deg
        self.tolerance_deg = ex.tolerance_deg if tolerance_deg is None else tolerance_deg
        self.lean_limit_deg, self.lean_events_to_flag = lean_limit_deg, lean_events_to_flag
        # hike_limit None = angle-aware (`hike_allowance`); a number = the old fixed limit
        self.hike_limit, self.baseline_frames = hike_limit, baseline_frames
        if hike_persist_frames is None:
            hike_persist_frames = 1 if hike_limit is not None else HIKE_PERSIST_FRAMES
        self.hike_persist_frames = max(1, int(hike_persist_frames))
        self.hike_curve, self.hike_margin = tuple(hike_curve), float(hike_margin)
        self._hike_frames = 0
        self.lean_persist_s = lean_persist_s
        self.gate: str | None = None
        self._lean_since: float | None = None
        self.state = "start_pose"
        self.set, self.rep = 1, 0
        self.finished = False
        self.started = False
        self.reps: list[dict[str, Any]] = []
        self.lean_count = 0
        self.hike_count = 0
        self.above_ceiling_count = 0
        self._above_frames = 0
        self._above_this_rep = False
        self._above_this_set = 0
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
        self._verified_this_set = 0
        # oscillation bookkeeping (pendulum)
        self._swing_sign = 0
        self._halves = 0
        self._swing_lo = 0.0
        self._swing_hi = 0.0

    # ---- public --------------------------------------------------------------------------
    def set_hold(self, hold_s: float) -> None:
        """Change the hold the next check needs (the coach's regress, via the pipeline's
        `set_hold` command, which clamps it to the prescription first)."""
        self.hold_s = float(hold_s)

    def set_target(self, target_deg: float) -> None:
        """An accepted agent adjustment (`set_target`, clamped to the prescription by the
        pipeline first). The in-code ceiling still applies here."""
        wanted = float(target_deg)
        self.clamped = wanted > self.ceiling_deg
        self.target_deg = min(wanted, self.ceiling_deg)

    def set_reps(self, reps: int) -> None:
        """An accepted agent adjustment (`set_reps`, clamped to the prescription first); a set
        already past the new count closes on its next rep."""
        self.reps_per_set = max(1, int(reps))

    @property
    def swing_band_deg(self) -> float:
        """Hysteresis band for the oscillation counter: a quarter of the peak-to-peak amplitude
        a swing must reach to be verified, so noise around vertical never counts as a reversal
        while a small, real swing is still counted (and reported unverified)."""
        return max(2.0, (self.target_deg - self.tolerance_deg) / 4.0)

    def phase(self) -> str:
        """The step the avatar follows: start | lift | hold | lower."""
        if self.kind == "oscillation":
            if self.state == "start_pose":
                return "start"
            return "lift" if self._swing_sign >= 0 else "lower"
        return PHASES.get(self.state, "start")

    def rep_progress(self) -> float:
        """0..1 through the current rep, for the avatar and the on-screen count."""
        if self.kind == "oscillation":
            return round(min(1.0, self._halves / 2.0), 3)
        a, lo = self._angle or 0.0, self.start_below_deg
        span = max(1.0, self.target_deg - lo)
        if self.state == "moving":
            return round(0.4 * max(0.0, min(1.0, (a - lo) / span)), 3)
        if self.state in ("target_reached", "hold"):
            held = min(1.0, self._held / self.hold_s) if self.hold_s > 0 else 1.0
            return round(0.4 + 0.4 * held, 3)
        if self.state == "return":
            return round(0.8 + 0.2 * (1.0 - max(0.0, min(1.0, (a - lo) / span))), 3)
        return 0.0

    def snapshot(self) -> dict[str, Any]:
        return {
            "mode": "arm",
            "exercise": self.exercise.id,
            "exercise_name": self.exercise.name,
            "tier": self.tier,
            "kind": self.kind,
            "dose": self.exercise.dose,
            "view_required": self.view,
            "phase": self.phase(),
            "rep_progress": self.rep_progress(),
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
            if self.state == "hold" and self.hold_s > 0
            else 0.0,
            "angle_now": self._angle,
            "peak_this_rep": round(self._peak, 1),
            "best_this_set": round(self._best_this_set, 1),
            "trunk_lean_deg": self._lean,
            "gate": self.gate,
            "reps_total": len(self.reps),
            "unverified_total": sum(1 for r in self.reps if not r["verified"]),
            "flags": {
                "lean": self.lean_count >= self.lean_events_to_flag,
                "lean_count": self.lean_count,
                "hike_count": self.hike_count,
                "above_ceiling_count": self.above_ceiling_count,
            },
            "finished": self.finished,
        }

    def step(self, obs: ArmObservation) -> list[Event]:
        self.gate = gate_for(obs, self.view)
        if self.finished or obs.shoulder_deg is None:
            self._angle = None if obs.shoulder_deg is None else self._angle
            return []
        self._angle, self._lean = obs.shoulder_deg, obs.trunk_lean_deg
        if self.gate is not None:
            self._lean_since = None  # frozen: the angle is shown but nothing is scored
            return []
        evs: list[Event] = []
        if not self.started:
            self.started = True
            evs.append(
                make_event(
                    "exercise_start",
                    t=obs.t,
                    exercise=self.exercise.id,
                    name=self.exercise.name,
                    view=self.view,
                    kind=self.kind,
                    tier=self.tier,
                    dose=self.exercise.dose,
                    target_deg=self.target_deg,
                    ceiling_deg=self.ceiling_deg,
                    hold_s=self.hold_s,
                    sets=self.sets,
                    reps=self.reps_per_set,
                )
            )
        if self.kind == "oscillation":
            return evs + self._swing(obs)
        if self.state in ("moving", "target_reached", "hold"):
            self._peak = max(self._peak, obs.shoulder_deg)
            evs += self._compensation(obs)
            evs += self._above_ceiling(obs)
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
        leaning = (
            abs(obs.trunk_lean_deg) > self.lean_limit_deg
            and obs.hip_visibility >= MIN_VISIBILITY
        )
        if not leaning:
            self._lean_since = None
        elif self._lean_since is None:
            self._lean_since = obs.t
        persisted = leaning and obs.t - (self._lean_since or obs.t) >= self.lean_persist_s
        if persisted and not self._lean_this_rep:
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
        # The hike is in trunk lengths (shoulder to hip), so it needs the hips as well as both
        # shoulders: with the hips guessed below the frame the number is noise (25 Oct).
        shoulders_seen = (
            obs.shoulders_visibility >= MIN_VISIBILITY and obs.hip_visibility >= MIN_VISIBILITY
        )
        angle = float(obs.shoulder_deg or 0.0)
        limit = (
            self.hike_limit
            if self.hike_limit is not None
            else hike_allowance(angle, self.hike_curve, self.hike_margin)
        )
        self._hike_frames = self._hike_frames + 1 if hike > limit and shoulders_seen else 0
        if self._hike_frames >= self.hike_persist_frames and not self._hike_this_rep:
            self._hike_this_rep = True
            self.hike_count += 1
            evs.append(
                make_event(
                    "shoulder_hiking",
                    t=obs.t,
                    hike=round(hike, 3),
                    limit=round(limit, 3),
                    angle_deg=round(angle, 1),
                    count=self.hike_count,
                )
            )
        return evs

    def _above_ceiling(self, obs: ArmObservation) -> list[Event]:
        """`above_ceiling` once per rep after `ABOVE_CEILING_FRAMES` consecutive frames over
        `ceiling_deg + ABOVE_CEILING_TOL_DEG` (hold reps only; the caller runs it while lifting
        or holding, never while the FSM is gated)."""
        if obs.shoulder_deg is None or obs.shoulder_deg <= self.ceiling_deg + ABOVE_CEILING_TOL_DEG:
            self._above_frames = 0
            return []
        self._above_frames += 1
        if self._above_this_rep or self._above_frames < ABOVE_CEILING_FRAMES:
            return []
        self._above_this_rep = True
        self._above_this_set += 1
        self.above_ceiling_count += 1
        return [
            make_event(
                "above_ceiling",
                t=obs.t,
                set=self.set,
                rep=self.rep + 1,
                angle_deg=round(obs.shoulder_deg, 1),
                ceiling_deg=self.ceiling_deg,
            )
        ]

    def _complete_rep(self, rep: dict[str, Any], t: float, best: float) -> list[Event]:
        """Shared tail for both rep shapes: record it, close the set, finish the exercise."""
        self.reps.append(rep)
        if rep["verified"]:
            self._best_this_set = max(self._best_this_set, best)
            self._verified_this_set += 1
        evs = [make_event("rep_complete", t=t, **rep)]
        if self.rep >= self.reps_per_set:
            evs.append(
                make_event(
                    "set_complete",
                    t=t,
                    set=self.set,
                    reps=self.rep,
                    verified_reps=self._verified_this_set,
                    best_deg=round(self._best_this_set, 1),
                    above_ceiling_count=self._above_this_set,
                )
            )
            if self.set >= self.sets:
                self.finished = True
                evs.append(make_event("arm_complete", t=t, sets=self.set, reps=len(self.reps)))
                return evs
            self.set += 1
            self.rep = 0
            self._best_this_set = 0.0
            self._verified_this_set = 0
            self._above_this_set = 0
        self._held = 0.0
        evs.append(self._go("start_pose", t))
        return evs

    # ---- oscillation (pendulum) ----------------------------------------------------------
    def _swing(self, obs: ArmObservation) -> list[Event]:
        a = obs.shoulder_deg or 0.0
        evs: list[Event] = []
        if self.state == "start_pose":
            if len(self._hike_samples) < self.baseline_frames:
                self._hike_samples.append(obs.shoulder_hike_norm)
                self._hike_baseline = sum(self._hike_samples) / len(self._hike_samples)
            if abs(a) < self.swing_band_deg:
                return evs
            self._t_move = obs.t
            self._swing_lo = self._swing_hi = a
            self._lean_this_rep = self._hike_this_rep = False
            evs.append(self._go("moving", obs.t))
        self._swing_lo, self._swing_hi = min(self._swing_lo, a), max(self._swing_hi, a)
        self._peak = round(self._swing_hi - self._swing_lo, 1)
        # No lean or shoulder-hike check here: the pendulum is *done* leaning forward on a table
        # with the arm hanging (exercises.py steps), so a forward trunk is the instruction, not
        # a compensation (24 Sep review, P0).
        sign = 1 if a > self.swing_band_deg else (-1 if a < -self.swing_band_deg else 0)
        if sign == 0 or sign == self._swing_sign:
            return evs
        if self._swing_sign != 0:
            self._halves += 1
        self._swing_sign = sign
        if self._halves < 2:  # two reversals = one full to-and-fro
            return evs
        p2p = round(self._swing_hi - self._swing_lo, 1)
        verified = p2p >= self.target_deg - self.tolerance_deg
        self.rep += 1
        rep = {
            "set": self.set,
            "rep": self.rep,
            "peak_deg": p2p,
            "swing_deg": p2p,
            "hold_s": 0.0,
            "verified": verified,
            "reason": None if verified else "swing_too_small",
            "lean": self._lean_this_rep,
            "hike": self._hike_this_rep,
            "above_ceiling": False,  # a swing has no lift to take past the ceiling
            "t_start": self._t_move,
            "t_end": obs.t,
        }
        self._halves = 0
        self._swing_lo = self._swing_hi = a
        self._t_move = obs.t
        self._lean_this_rep = self._hike_this_rep = False
        out = self._complete_rep(rep, obs.t, p2p)
        if not self.finished:
            # `_complete_rep` parks a hold exercise back in start_pose; a swinging arm just
            # carries on into the next oscillation.
            self.state = "moving"
            out = [
                e
                for e in out
                if not (e.type == "state_change" and e.payload["to"] == "start_pose")
            ]
        return evs + out

    # ---- states (hold) -------------------------------------------------------------------
    def _in_start_pose(self, obs: ArmObservation) -> list[Event]:
        if len(self._hike_samples) < self.baseline_frames:
            self._hike_samples.append(obs.shoulder_hike_norm)
            self._hike_baseline = sum(self._hike_samples) / len(self._hike_samples)
        if obs.shoulder_deg > self.start_below_deg + 5:
            self._peak, self._t_move, self._held, self._reason = obs.shoulder_deg, obs.t, 0.0, None
            self._lean_this_rep = self._hike_this_rep = False
            self._above_this_rep, self._above_frames = False, 0
            self._lean_since, self._hike_frames = None, 0
            return [self._go("moving", obs.t)]
        return []

    def _in_moving(self, obs: ArmObservation) -> list[Event]:
        if obs.shoulder_deg >= self.target_deg - self.tolerance_deg:
            evs = [self._go("target_reached", obs.t)]
            self._t_hold = obs.t
            evs.append(self._go("hold", obs.t))
            return evs
        if obs.shoulder_deg < self.start_below_deg and obs.t - self._t_move < MIN_LIFT_S:
            return [self._go("start_pose", obs.t)]  # a flicker over the start line, not a lift
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
            "above_ceiling": self._above_this_rep,
            "t_start": self._t_move,
            "t_end": obs.t,
        }
        return self._complete_rep(rep, obs.t, self._peak)
