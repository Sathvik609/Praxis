"""CoachSession: stop rules -> coach -> trace, per live session. The pipeline stays pure."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from praxis_session.coach.base import CoachContext, Decision, speak
from praxis_session.coach.rules import LABEL, RuleCoach
from praxis_session.events import Event, make_event
from praxis_session.exertion import Exertion
from praxis_session.prescription import Prescription
from praxis_session.stop_rules import StopRules
from praxis_session.trace import Trace

WHY_TEXT = {
    "progression": "Your program (Hospital GRASP L2) assigns 2 slow arcs then 2 fast arcs. The camera verified the slow arcs, so the fast arcs are the next step your therapist planned. Nothing goes above the prescribed level.",
}


class CoachSession:
    def __init__(self, mode: str, prescription: Prescription, trace_dir: Path | str | None = None, session_id: str | None = None, coach: Any | None = None) -> None:
        self.mode = mode
        self.prescription = prescription
        self.session_id = session_id or uuid.uuid4().hex[:12]
        self.trace = Trace(self.session_id, trace_dir)
        self.coach = coach or RuleCoach()
        self.exertion = Exertion(prescription)
        self.stop_rules = StopRules(prescription)
        self.paused = False
        self.pause_rule: str | None = None
        self.checkin: dict[str, Any] = {}
        self.feedback: dict[str, Any] = {}
        self.decisions: list[dict[str, Any]] = []
        self.pending_prompt: dict[str, Any] | None = None
        self.counts = {"reps_total": 0, "verified": 0, "unverified": 0, "corrections": 0}
        self._last_speak_t = -1e9
        self._last_level = "low"
        self.t_start: float | None = None
        self.t_end: float | None = None
        self.trace.log("session", mode=mode, prescription=f"{prescription.program} L{prescription.level} v{prescription.version}", coach=LABEL)

    @property
    def stopped(self) -> bool:
        return self.stop_rules.stopped

    # ---- inputs ------------------------------------------------------------------------
    def on_checkin(self, pain: int, energy: str, minutes: int, new_symptoms: bool, t: float, rpe: int | None = None) -> list[Event]:
        self.checkin = {"pain_before": pain, "energy": energy, "minutes": minutes, "new_symptoms": new_symptoms}
        self.trace.log("checkin", **self.checkin)
        if rpe is not None:
            self.exertion.update([], rpe=rpe, t=t)
        return self._log_stop(self.stop_rules.on_checkin(pain, new_symptoms, t))

    def on_pain(self, pain: int, t: float) -> list[Event]:
        self.trace.log("pain", pain=pain)
        return self._log_stop(self.stop_rules.on_pain(pain, t))

    def on_rpe(self, rpe: int, t: float) -> list[Event]:
        state = self.exertion.update([], rpe=rpe, t=t)
        self.trace.log("rpe", rpe=rpe, exertion=state)
        return [make_event("exertion", t=t, **state)]

    def pause(self, t: float, rule: str = "patient") -> list[Event]:
        self.paused, self.pause_rule = True, rule
        self.trace.log("pause", rule=rule)
        return [make_event("pause", t=t, rule=rule, text="Paused. Take your time.")]

    def resume(self, t: float) -> list[Event]:
        self.paused, self.pause_rule = False, None
        self.trace.log("resume")
        return [make_event("resume", t=t)]

    def on_answer(self, prompt_id: str, choice: str, t: float) -> tuple[dict[str, Any] | None, list[Event]]:
        self.trace.log("answer", prompt=prompt_id, choice=choice)
        evs: list[Event] = []
        cmd: dict[str, Any] | None = None
        if prompt_id == "progression":
            if choice.lower().startswith("yes"):
                cmd = {"cmd": "set_phase", "phase": "fast"}
                evs.append(self._coach_event(Decision("progress", "cup_fast", "Fast arcs on. Same path, quicker — still one dot at a time.", "patient accepted progression", [], {"avatar_clip": "cup"}, LABEL), t))
            elif choice.lower().startswith("why"):
                evs.append(self._coach_event(Decision("instruct", "why", WHY_TEXT["progression"], "patient asked why", [], {}, LABEL), t))
                return None, evs
            else:
                evs.append(self._coach_event(Decision("instruct", "keep_pace", "Keeping the slow pace. That's fine.", "patient declined progression", [], {}, LABEL), t))
        self.pending_prompt = None
        return cmd, evs

    def on_events(self, events: list[Event], snapshot: dict[str, Any], t: float) -> list[Event]:
        if not events:
            return []
        if self.t_start is None:
            self.t_start = t
        self.t_end = t
        for e in events:
            if e.type in ("rep_complete", "reach_complete"):
                self.counts["reps_total"] += 1
                self.counts["verified" if e.payload.get("verified") else "unverified"] += 1
            if e.type != "frame":
                self.trace.log("event", type=e.type, id=e.id, t=e.t, **{k: v for k, v in e.payload.items() if k in ("to_dot", "hole", "verified", "reason", "peak_deg", "lean_deg", "rule", "arc", "set", "rep")})
        out: list[Event] = []
        state = self.exertion.update(events, t=t)
        if state["level"] != self._last_level:
            self._last_level = state["level"]
            out.append(make_event("exertion", t=t, **state))
        out += self._log_stop(self.stop_rules.on_events(events))
        out += self._log_stop(self.stop_rules.on_exertion(state, self.exertion.high_for_s(t), t))
        if self.stopped or self.paused:
            return out
        ctx = CoachContext(mode=self.mode, events=[e for e in events if e.type != "frame"], snapshot=snapshot, exertion=state, prescription=self.prescription, t=t, last_speak_t=self._last_speak_t)
        for d in self.coach.decide(ctx):
            out.append(self._coach_event(d, t))
        return out

    # ---- internals ---------------------------------------------------------------------
    def _log_stop(self, evs: list[Event]) -> list[Event]:
        for e in evs:
            if e.type in ("stop", "pause", "rest"):
                self.trace.log("stop_rule", action=e.type, rule=e.payload.get("rule"), text=e.payload.get("text"))
                if e.type == "pause":
                    self.paused, self.pause_rule = True, e.payload.get("rule")
            elif e.type == "therapist_flag":
                self.trace.log("flag", rule=e.payload.get("rule"), detail=e.payload.get("detail"))
        return evs

    def _coach_event(self, d: Decision, t: float) -> Event:
        d.label = d.label or LABEL
        self.trace.log("decide", action=d.action, cue_id=d.cue_id, reason=d.reason, evidence=d.evidence, label=d.label)
        for call in d.tool_calls:
            self.trace.log("tool", **call)
        spoken = speak(d.text, t, d.cue_id, d.action)
        self.trace.log("action", kind="speak", text=d.text, ui=d.ui)
        if d.ui.get("prompt"):
            self.pending_prompt = d.ui["prompt"]
        if d.action == "correct":
            self.counts["corrections"] += 1
        self.decisions.append(d.to_dict() | {"t": t})
        self._last_speak_t = t
        return make_event("coach", t=t, **d.to_dict(), speak_id=spoken.id)

    def summary(self, t: float | None = None) -> dict[str, Any]:
        notes = []
        for d in self.decisions:
            if d["action"] in ("progress", "regress", "rest", "correct"):
                conf = "high" if d["evidence"] else "medium"
                notes.append({"text": f"{d['action']}: {d['reason']}", "confidence": conf, "evidence": d["evidence"]})
        seen = set()
        notes = [n for n in notes if not (n["text"] in seen or seen.add(n["text"]))][:6]
        return {
            "session_id": self.session_id,
            "mode": self.mode,
            "t_start": self.t_start,
            "t_end": t if t is not None else self.t_end,
            "camera": dict(self.counts),
            "told_us": {**self.checkin, **self.feedback},
            "exertion": self.exertion.state,
            "coach": {"label": LABEL, "notes": notes, "decisions": len(self.decisions)},
            "flags": list(self.stop_rules.flags),
            "stopped": self.stopped,
            "delivery": "queued · not yet delivered",
        }
