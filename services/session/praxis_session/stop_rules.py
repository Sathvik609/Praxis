"""Hard-coded stop rules. They run before the coach sees any event and never consult it.

stop  -> session ends, partial report saved, therapist flagged
pause -> session paused until the patient resumes (or the condition clears)
rest  -> forced rest break
Every stop/pause/rest that a clinician should see also emits `therapist_flag`.
"""
from __future__ import annotations

from typing import Any

from praxis_session.events import Event, make_event
from praxis_session.prescription import Prescription


class StopRules:
    def __init__(self, prescription: Prescription) -> None:
        self.p = prescription
        self.th = prescription.stop_rules
        self.stopped = False
        self._unverified_streak = 0
        self._lean_flagged = False
        self._exertion_flagged = False
        self.flags: list[dict[str, Any]] = []

    def _flag(self, t: float, rule: str, detail: str) -> Event:
        self.flags.append({"t": t, "rule": rule, "detail": detail})
        return make_event("therapist_flag", t=t, rule=rule, detail=detail)

    def on_checkin(self, pain: int, new_symptoms: bool, t: float) -> list[Event]:
        if self.th.new_symptoms and new_symptoms:
            self.stopped = True
            return [
                make_event("stop", t=t, rule="symptoms", text="Something new or worse since last time: review with your therapist before practising."),
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
            if e.type == "compensation_lean" and e.payload.get("flagged") and not self._lean_flagged:
                self._lean_flagged = True
                out.append(make_event("pause", t=e.t, rule="lean", text="You're leaning to lift. Let's pause, sit tall, and lower the target a little."))
                out.append(self._flag(e.t, "lean", f"trunk lean > {self.th.lean_deg}° in {e.payload.get('count')} lifts"))
            elif e.type in ("rep_complete", "reach_complete"):
                if e.payload.get("verified") is False:
                    self._unverified_streak += 1
                    if self._unverified_streak == self.th.failed_reps:
                        out.append(make_event("pause", t=e.t, rule="failed_reps", text="Three in a row I couldn't verify. Let's pause and check the setup."))
                        out.append(self._flag(e.t, "failed_reps", f"{self.th.failed_reps} consecutive unverified reps ({e.payload.get('reason')})"))
                else:
                    self._unverified_streak = 0
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
