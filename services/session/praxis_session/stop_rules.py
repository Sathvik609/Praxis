"""Hard-coded stop rules. They run before the coach sees any event and never consult it.

stop  -> session ends, partial report saved, therapist flagged
pause -> session paused until the patient resumes (or the condition clears)
rest  -> forced rest break
Every stop/pause/rest that a clinician should see also emits `therapist_flag`.
flag  -> post-session pain at or above the stop level (`pain_after`, 6 Oct): a flag only.

Unverified is not failed (24 Sep review). A rep with `verified: false` is either
- **unverified**: the camera could not check it (`cup_occluded`, `marker_lost`,
  `no_hand_near_hole`, anything not listed below) -> `failed_reps` pause, "check the setup"; or
- **missed**: the camera saw it clearly and it fell short (`MISS_REASONS`: `target_missed`,
  `hold_too_short`, `swing_too_small`) -> `missed_reps` gentle rest, never "check the setup".
The two streaks and thresholds are separate; a miss restarts the unverified streak (the camera
was working), a verified rep restarts both.
"""
from __future__ import annotations

from typing import Any

from praxis_session.events import Event, make_event
from praxis_session.prescription import Prescription

MISS_REASONS: frozenset[str] = frozenset({"target_missed", "hold_too_short", "swing_too_small"})


def is_miss(payload: dict[str, Any]) -> bool:
    """A `verified: false` rep the camera saw fall short (performance, not perception)."""
    return payload.get("verified") is False and payload.get("reason") in MISS_REASONS


def pain_after_detail(pain: Any, pain_max: int) -> str | None:
    """The therapist-flag text for post-session pain at or above the stop level, or None.
    Only a 0-10 integer counts (a skipped question or a bool is not a pain score). Shared by
    the end-of-session feedback (`CoachSession.on_feedback`) and Edit feedback
    (`Store.update_feedback`), so both write the same flag."""
    if isinstance(pain, bool) or not isinstance(pain, int) or pain < pain_max:
        return None
    return f"pain {pain}/10 after the session (stop level {pain_max})"


class StopRules:
    def __init__(self, prescription: Prescription) -> None:
        self.p = prescription
        self.th = prescription.stop_rules
        self.stopped = False
        self._unverified_streak = 0  # reps the camera could not verify (perception)
        self._missed_streak = 0  # reps the camera saw fall short (performance)
        self._missed_reasons: list[str] = []
        self._lean_seen = 0  # the FSM's running lean count at the last lean event
        self._lean_base = 0  # ... and at the last lean pause: the rule re-arms from there
        self._exertion_flagged = False
        self.flags: list[dict[str, Any]] = []

    def on_resume(self) -> None:
        """The patient resumed (after fixing the setup or resting): both streaks start over."""
        self._unverified_streak = 0
        self._missed_streak, self._missed_reasons = 0, []

    def _flag(self, t: float, rule: str, detail: str) -> Event:
        self.flags.append({"t": t, "rule": rule, "detail": detail})
        return make_event("therapist_flag", t=t, rule=rule, detail=detail)

    def on_pain_after(self, pain: Any, t: float) -> list[Event]:
        """Pain reported on the feedback form at or above the stop level: a therapist flag only.
        The session is already over, so nothing stops or pauses and `stopped` is untouched.
        One `pain_after` flag per session, however often the form is sent."""
        detail = pain_after_detail(pain, self.th.pain_max)
        if detail is None or any(f["rule"] == "pain_after" for f in self.flags):
            return []
        return [self._flag(t, "pain_after", detail)]

    def on_checkin(self, pain: int, new_symptoms: bool, t: float) -> list[Event]:
        if self.th.new_symptoms and new_symptoms:
            self.stopped = True
            return [
                make_event("stop", t=t, rule="symptoms", text="Something new or worse since last time: no practice today, and your therapist is flagged to review it first."),
                self._flag(t, "symptoms", "new or worse symptoms reported at check-in"),
            ]
        return self.on_pain(pain, t)

    def on_pain(self, pain: int, t: float) -> list[Event]:
        if pain >= self.th.pain_max and not self.stopped:
            self.stopped = True
            return [
                make_event("stop", t=t, rule="pain", pain=pain, text=f"Pain {pain}/10 is at your stop level. Session ended and saved; your therapist is flagged."),
                self._flag(t, "pain", f"pain {pain}/10 reported (stop level {self.th.pain_max})"),
            ]
        return []

    def on_events(self, events: list[Event]) -> list[Event]:
        out: list[Event] = []
        if self.stopped:
            return out
        for e in events:
            if e.type == "compensation_lean":
                # Counted here against the prescription's `lean_events` (not the FSM's copy of
                # it), and re-armed after each pause: another N leans pause again.
                count = int(e.payload.get("count") or self._lean_seen + 1)
                self._lean_seen = count
                if count - self._lean_base >= self.th.lean_events:
                    self._lean_base = count
                    out.append(make_event("pause", t=e.t, rule="lean", text="You're leaning to lift. Let's pause, sit tall, and lower the target a little."))
                    out.append(self._flag(e.t, "lean", f"trunk lean > {self.th.lean_deg:g}° in {count} lifts ({self.th.lean_events} since the last lean pause)"))
            elif e.type in ("rep_complete", "reach_complete"):
                if e.payload.get("verified") is not False:
                    self._unverified_streak = self._missed_streak = 0
                elif is_miss(e.payload):
                    # The camera saw the rep clearly and it fell short: performance, not setup.
                    self._unverified_streak = 0
                    self._missed_streak += 1
                    self._missed_reasons.append(str(e.payload.get("reason")))
                    if self._missed_streak >= self.th.missed_reps:
                        reasons = ", ".join(self._missed_reasons[-self.th.missed_reps:])
                        self._missed_streak, self._missed_reasons = 0, []  # re-arms after the next N
                        out.append(make_event("rest", t=e.t, rule="missed_reps", text="A few in a row fell a little short. That's fine — take a short rest, and keep the next ones smaller and slower."))
                        out.append(self._flag(e.t, "missed_reps", f"{self.th.missed_reps} consecutive missed reps ({reasons})"))
                else:
                    self._unverified_streak += 1
                    if self._unverified_streak >= self.th.failed_reps:
                        self._unverified_streak = 0  # fires again after the next N, not once per session
                        out.append(make_event("pause", t=e.t, rule="failed_reps", text="Three in a row I couldn't verify. Let's pause and check the setup."))
                        out.append(self._flag(e.t, "failed_reps", f"{self.th.failed_reps} consecutive unverified reps ({e.payload.get('reason')})"))
            elif e.type == "perception_lost":
                # Clears itself: CoachSession resumes on `perception_regained` (D-CAL-2).
                out.append(make_event("pause", t=e.t, rule="perception", text="I lost tracking. Paused until the markers or your shoulder are back in view, then we carry on.", missing=e.payload.get("missing")))
        return out

    def on_exertion(self, state: dict[str, Any], high_for_s: float, t: float) -> list[Event]:
        if state.get("level") == "high" and high_for_s >= self.th.exertion_high_s and not self._exertion_flagged:
            self._exertion_flagged = True
            return [
                make_event("rest", t=t, rule="exertion", text="You've been working hard for a while. Take a rest before the next set.", reasons=state.get("reasons", [])),
                self._flag(t, "exertion", f"behavioural exertion high for {high_for_s:.0f} s: {', '.join(state.get('reasons', []))}"),
            ]
        if state.get("level") != "high":
            self._exertion_flagged = False
        return []
