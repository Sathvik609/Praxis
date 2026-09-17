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
        self.counts: dict[str, Any] = {"reps_total": 0, "verified": 0, "unverified": 0, "corrections": 0, "posture_cues": 0}
        self.measures: dict[str, Any] = {}
        self._last_speak_t = -1e9
        self._last_cue_t: dict[str, float] = {}
        self._last_level = "low"
        self.t_start: float | None = None
        self.t_end: float | None = None
        # Honest active time: the clock stops on every pause/rest and restarts on resume.
        self.paused_s = 0.0
        self._paused_at: float | None = None
        self.tracking_lost_events = 0
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
        self._clock_pause(t)
        self.trace.log("pause", rule=rule)
        return [make_event("pause", t=t, rule=rule, text="Paused. Take your time.")]

    def resume(self, t: float) -> list[Event]:
        self.paused, self.pause_rule = False, None
        self._clock_resume(t)
        self.stop_rules.on_resume()
        self.trace.log("resume")
        return [make_event("resume", t=t)]

    # ---- active-time clock ---------------------------------------------------------------
    def _clock_pause(self, t: float) -> None:
        if self._paused_at is None:
            self._paused_at = t

    def _clock_resume(self, t: float) -> None:
        if self._paused_at is not None:
            self.paused_s += max(0.0, t - self._paused_at)
            self._paused_at = None

    def _paused_total(self, t: float | None) -> float:
        open_pause = 0.0 if self._paused_at is None or t is None else max(0.0, t - self._paused_at)
        return self.paused_s + open_pause

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
                # NHPT rep_complete carries no `verified` flag: occupancy is the verification.
                self.counts["verified" if e.payload.get("verified", True) else "unverified"] += 1
            if e.type == "reach_complete":
                self.measures.setdefault("reach_ms", []).append(e.payload.get("reach_ms"))
                self.measures.setdefault("reach_verified", []).append(bool(e.payload.get("verified")))
            elif e.type == "rep_complete" and "peak_deg" in e.payload:
                self.measures.setdefault("peak_deg", []).append(e.payload.get("peak_deg"))
                self.measures.setdefault("peak_verified", []).append(bool(e.payload.get("verified")))
            elif e.type == "nhpt_complete":
                self.measures["nhpt_total_s"] = e.payload.get("total_s")
                self.measures["splits_s"] = list(e.payload.get("splits_s") or [])
            elif e.type in ("compensation_lean", "shoulder_hiking"):
                self.counts["posture_cues"] += 1
            elif e.type == "perception_lost":
                self.tracking_lost_events += 1
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
        ctx = CoachContext(mode=self.mode, events=[e for e in events if e.type != "frame"], snapshot=snapshot, exertion=state, prescription=self.prescription, t=t, last_speak_t=self._last_speak_t, last_cue_t=self._last_cue_t)
        for d in self.coach.decide(ctx):
            out.append(self._coach_event(d, t))
        return out

    # ---- internals ---------------------------------------------------------------------
    def _log_stop(self, evs: list[Event]) -> list[Event]:
        for e in evs:
            if e.type in ("stop", "pause", "rest"):
                self.trace.log("stop_rule", action=e.type, rule=e.payload.get("rule"), text=e.payload.get("text"))
                if e.type in ("pause", "rest"):
                    self._clock_pause(e.t)  # the patient resumes both with a tap
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
        self._last_cue_t[d.cue_id] = t
        return make_event("coach", t=t, **d.to_dict(), speak_id=spoken.id)

    def summary(self, t: float | None = None) -> dict[str, Any]:
        notes = []
        for d in self.decisions:
            if d["action"] in ("progress", "regress", "rest", "correct"):
                conf = "high" if d["evidence"] else "medium"
                notes.append({"text": f"{d['action']}: {d['reason']}", "confidence": conf, "evidence": d["evidence"]})
        seen = set()
        notes = [n for n in notes if not (n["text"] in seen or seen.add(n["text"]))][:6]
        t_end = t if t is not None else self.t_end
        # Active time runs to the last perception event, not to when the report was asked for.
        paused_s = self._paused_total(self.t_end)
        active_s = 0.0
        if self.t_start is not None and self.t_end is not None:
            active_s = max(0.0, (self.t_end - self.t_start) - paused_s)
        total = self.counts["reps_total"]
        # NHPT has no per-rep verified flag (occupancy is the verification), so any tracking
        # loss makes the whole assessment "limited"; the other tasks use the unverified share.
        if self.mode == "nhpt":
            limited = self.tracking_lost_events > 0
        else:
            limited = total > 0 and self.counts["unverified"] / total > 0.3
        return {
            "session_id": self.session_id,
            "mode": self.mode,
            "t_start": self.t_start,
            "t_end": t_end,
            # Replay feeds clip time (seconds from 0), live sessions wall-clock epoch seconds.
            "clock": "wall" if (self.t_start or 0) >= 1e9 else "clip",
            "tracking": "limited" if limited else "usable",
            "tracking_lost_events": self.tracking_lost_events,
            "camera": {
                **self.counts,
                **self.measures,
                "coverage_pct": round(100 * self.counts["verified"] / total) if total else None,
                "active_s": round(active_s, 1),
                "paused_s": round(paused_s, 1),
                "tracking_lost_events": self.tracking_lost_events,
            },
            "told_us": {**self.checkin, **self.feedback},
            "exertion": self.exertion.state,
            "coach": {"label": LABEL, "notes": notes, "decisions": len(self.decisions)},
            "flags": list(self.stop_rules.flags),
            "stopped": self.stopped,
            "delivery": "queued · not yet delivered",
        }
