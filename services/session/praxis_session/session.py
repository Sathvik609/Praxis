"""CoachSession: stop rules -> coach -> trace, per live session. The pipeline stays pure."""
from __future__ import annotations

import re
import uuid
from collections import deque
from pathlib import Path
from typing import Any

from praxis_session.coach.base import CoachContext, Decision, speak
from praxis_session.coach.rules import LABEL, RuleCoach
from praxis_session.events import Event, make_event
from praxis_session.exertion import Exertion
from praxis_session.prescription import Prescription
from praxis_session.stop_rules import StopRules, is_miss
from praxis_session.trace import Trace

# The rule coach's label when a Claude agent is configured (PRAXIS_AGENT != off): the rule coach
# still gives the in-rep cues, the agent takes the checkpoints (29 Sep).
RULE_LABEL_WITH_AGENT = "Rule-based coach"
SESSION_RING = 400  # non-frame events kept per session: what an agent's evidence ids may cite
# Checkpoints (agent coach design §3): event type -> trigger name, and stop-rule pauses.
CHECKPOINT_EVENTS = {"set_complete": "set_complete", "arc_complete": "arc_complete", "nhpt_complete": "nhpt_complete"}
CHECKPOINT_PAUSES = ("failed_reps", "perception")

WHY_TEXT = {
    "progression": "Your program (Hospital GRASP L2) assigns 2 slow arcs then 2 fast arcs. The camera verified the slow arcs, so the fast arcs are the next step your therapist planned. Nothing goes above the prescribed level.",
}


def note_category(d: dict[str, Any]) -> str:
    """A report coach note's category (6 Oct design): rest/stop -> Safety; a correction for
    trunk lean or shoulder hiking -> Posture; a correction for a rep the camera could not
    verify -> Data quality; everything else (progress, regress, other corrections) ->
    Performance."""
    action = d.get("action")
    cue, reason = str(d.get("cue_id") or ""), str(d.get("reason") or "").lower()
    if action in ("rest", "stop"):
        return "Safety"
    if action == "correct":
        if cue in ("arm_lean", "arm_hike") or re.search(r"\b(lean|leaning|hiking)\b", reason):
            return "Posture"
        if cue.endswith("_unverified") or "unverified" in reason:
            return "Data quality"
    return "Performance"


class CoachSession:
    def __init__(self, mode: str, prescription: Prescription, trace_dir: Path | str | None = None, session_id: str | None = None, coach: Any | None = None, exercise: str | None = None, username: str | None = None, replay_clip: str | None = None, rule_label: str = LABEL) -> None:
        self.mode = mode
        # "Rule-based coach · LLM agent pending" with PRAXIS_AGENT=off, "Rule-based coach" otherwise.
        self.rule_label = rule_label
        # This session's own non-frame events (pipeline + stop rules): agent evidence must be here.
        self._ring: deque[Event] = deque(maxlen=SESSION_RING)
        # The Claude agent coach (coach/agent.py) when PRAXIS_AGENT is on; None keeps the
        # rule-coach-only behaviour of before 29 Sep exactly.
        self.agent: Any | None = None
        # Bumped whenever the session moves on (stop, resume, feedback): an agent run that
        # started under an older epoch is stale and its outputs are dropped.
        self.epoch = 0
        # Agent prompts waiting for the patient's tap: id -> {kind, prompt, reason, accept}.
        self.prompts: dict[str, dict[str, Any]] = {}
        self.coach_note: dict[str, Any] | None = None
        self._clock_t = 0.0
        # 28 Sep: a replayed clip is marked from the socket to the store, so no trend, total or
        # pain list counts it as the patient's practice.
        self.replay_clip = replay_clip
        # Sprint E: which registry exercise this arm session ran, and whose session it is.
        self.exercise = exercise
        self.username = (username or "").lower() or None
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
        # Pipeline commands a coach decision asked for (a regress's `ui.apply`), drained by
        # main after each frame and applied through `SessionPipeline.command`, which clamps.
        self.commands: list[dict[str, Any]] = []
        # posture_cues = lean_cues + hiking_cues; wrong_dot counts the cup FSM's `wrong_dot` events.
        self.counts: dict[str, Any] = {"reps_total": 0, "verified": 0, "unverified": 0, "missed": 0, "corrections": 0, "posture_cues": 0, "lean_cues": 0, "hiking_cues": 0, "wrong_dot": 0}
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
        self.trace.log("session", mode=mode, exercise=self.exercise, user=self.username, prescription=f"{prescription.program} L{prescription.level} v{prescription.version}", coach=self.rule_label)

    @property
    def stopped(self) -> bool:
        return self.stop_rules.stopped

    # ---- inputs ------------------------------------------------------------------------
    @property
    def clock(self) -> float:
        """The latest time this session has seen (wall clock live, clip time in replay)."""
        return self._clock_t

    def _tick(self, t: float) -> None:
        if isinstance(t, (int, float)) and t > self._clock_t:
            self._clock_t = float(t)

    def on_checkin(self, pain: int, energy: str, minutes: int, new_symptoms: bool, t: float, rpe: int | None = None) -> list[Event]:
        self._tick(t)
        self.checkin ={"pain_before": pain, "energy": energy, "minutes": minutes, "new_symptoms": new_symptoms}
        self.trace.log("checkin", **self.checkin)
        if rpe is not None:
            self.exertion.update([], rpe=rpe, t=t)
        out = self._log_stop(self.stop_rules.on_checkin(pain, new_symptoms, t))
        if self.agent is not None and not self.stopped:
            # The check-in is the patient's own report, kept (not emitted) so the agent's
            # opening instruction can cite it as evidence.
            e = make_event("checkin", t=t, **self.checkin)
            self._ring.append(e)
            self.trace.log("event", type="checkin", id=e.id, t=t)
            self._checkpoint("checkin", [e.id], t)
        return out

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

    def resume(self, t: float, rule: str | None = None, text: str | None = None) -> list[Event]:
        """Clear a pause. `rule` names the rule that cleared itself (perception auto-resume);
        the patient's own tap carries no rule."""
        self.paused, self.pause_rule = False, None
        self.epoch += 1
        # An agent's "resume?" prompt is moot once the session runs again.
        if any(p["kind"] == "resume" for p in self.prompts.values()):
            self.prompts = {k: p for k, p in self.prompts.items() if p["kind"] != "resume"}
            if self.pending_prompt and self.pending_prompt.get("kind") == "resume":
                self.pending_prompt = None
        self._clock_resume(t)
        self.stop_rules.on_resume()
        self.trace.log("resume", rule=rule)
        extra = {k: v for k, v in (("rule", rule), ("text", text)) if v is not None}
        return [make_event("resume", t=t, **extra)]

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
        if prompt_id in self.prompts:
            return self._answer_agent_prompt(prompt_id, choice, t)
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

    # ---- agent prompts (29 Sep) ------------------------------------------------------------
    def add_prompt(self, prompt: dict[str, Any], kind: str, reason: str, accept: dict[str, Any] | None, evidence: list[int], label: str, action: str = "instruct") -> None:
        """Register an agent prompt (`adjustment` or `resume`). Nothing it proposes happens until
        the patient taps option 0; option 1 changes nothing; "Why?" repeats the reason."""
        self.prompts[prompt["id"]] = {"kind": kind, "prompt": prompt, "reason": reason, "accept": accept, "evidence": list(evidence), "label": label, "action": action}

    def _answer_agent_prompt(self, prompt_id: str, choice: str, t: float) -> tuple[dict[str, Any] | None, list[Event]]:
        rec = self.prompts[prompt_id]
        options = [str(o) for o in rec["prompt"].get("options", [])]
        pick = choice.strip().lower()
        ev, label = rec["evidence"], rec["label"]

        def say(action: str, cue: str, text: str, reason: str) -> Event:
            return self._coach_event(Decision(action, cue, text, reason, ev, {}, label, source="agent"), t)  # type: ignore[arg-type]

        if pick.startswith("why"):
            return None, [say("instruct", "agent_why", rec["reason"], f"patient asked why ({prompt_id})")]
        self.prompts.pop(prompt_id, None)
        if self.pending_prompt and self.pending_prompt.get("id") == prompt_id:
            self.pending_prompt = None
        accepted = bool(options) and pick == options[0].strip().lower()
        if self.stopped:
            self.trace.log("agent_drop", reason="session stopped", prompt=prompt_id)
            return None, []
        if not accepted:
            text = "Okay. Tap Resume when you're ready." if rec["kind"] == "resume" else "Keeping it as it is. That's fine."
            return None, [say("instruct", "agent_declined", text, f"patient declined ({prompt_id})")]
        if rec["kind"] == "resume":
            evs: list[Event] = []
            if self.paused:
                evs += self.resume(t)
            evs.append(make_event("command", t=t, cmd="resume", source="agent", ok=True, session_id=self.session_id, prompt=prompt_id))
            evs.append(say("instruct", "agent_resume", "Thanks. Carrying on from where we stopped.", f"patient accepted resume ({prompt_id})"))
            return None, evs
        cmd = dict(rec["accept"] or {}) | {"source": "agent", "prompt": prompt_id, "evidence": list(ev)}
        proposal = rec["prompt"].get("proposal") or {}
        names = {"target_deg": "Target", "hold_s": "Hold", "reps": "Reps per set", "phase": "Arc speed"}
        unit = proposal.get("unit") or ""
        value = f"{proposal.get('value')}{unit if unit == '°' else (' ' + unit if unit else '')}"
        text = f"Done. {names.get(str(proposal.get('field')), 'Setting')} is now {value}."
        return cmd, [say(rec["action"], "agent_adjust_applied", text, f"patient accepted ({prompt_id})")]

    # ---- evidence ring and checkpoints (29 Sep) --------------------------------------------
    def has_event(self, event_id: int) -> bool:
        return any(e.id == event_id for e in self._ring)

    def recent_events(self, types: list[str] | None = None, last_n: int = 50) -> list[Event]:
        evs = [e for e in self._ring if types is None or e.type in types]
        return evs[-last_n:] if last_n > 0 else []

    def on_feedback(self, feedback: dict[str, Any], t: float) -> None:
        """Session end: the feedback form. The agent (when on) writes a coach note after it.
        Pain at or above the stop level writes a `pain_after` therapist flag (no stop: the
        session is already over)."""
        self._tick(t)
        self.feedback = feedback
        self.trace.log("feedback", **feedback)
        self._log_stop(self.stop_rules.on_pain_after(feedback.get("pain_after"), t))
        self.epoch += 1
        if self.agent is not None:
            ids = [e.id for e in self.recent_events(last_n=5)]
            self.trace.log("event", type="feedback", t=t)
            self._checkpoint("feedback", ids, t)

    def _checkpoint(self, trigger: str, evidence: list[int], t: float) -> None:
        if self.agent is not None:
            self.agent.on_checkpoint(trigger, evidence, t)

    def on_events(self, events: list[Event], snapshot: dict[str, Any], t: float) -> list[Event]:
        if not events:
            return []
        self._tick(t)
        if self.t_start is None:
            self.t_start = t
        self.t_end = t
        for e in events:
            if e.type in ("rep_complete", "reach_complete"):
                self.counts["reps_total"] += 1
                # NHPT rep_complete carries no `verified` flag: occupancy is the verification.
                # Unverified (the camera could not check it) is not missed (it saw a miss).
                if e.payload.get("verified", True):
                    self.counts["verified"] += 1
                else:
                    self.counts["missed" if is_miss(e.payload) else "unverified"] += 1
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
                self.counts["lean_cues" if e.type == "compensation_lean" else "hiking_cues"] += 1
            elif e.type == "wrong_dot":
                self.counts["wrong_dot"] += 1
            elif e.type == "perception_lost":
                self.tracking_lost_events += 1
            if e.type != "frame":
                self._ring.append(e)
                self.trace.log("event", type=e.type, id=e.id, t=e.t, **{k: v for k, v in e.payload.items() if k in ("to_dot", "hole", "verified", "reason", "peak_deg", "lean_deg", "rule", "arc", "set", "rep")})
        out: list[Event] = []
        state = self.exertion.update(events, t=t)
        if state["level"] != self._last_level:
            self._last_level = state["level"]
            out.append(make_event("exertion", t=t, **state))
        out += self._log_stop(self.stop_rules.on_events(events))
        out += self._log_stop(self.stop_rules.on_exertion(state, self.exertion.high_for_s(t), t))
        # A perception pause clears itself when tracking returns (D-CAL-2); pauses the patient
        # or another rule asked for still need a tap.
        if self.paused and self.pause_rule == "perception" and any(e.type == "perception_regained" for e in events):
            out += self.resume(t, rule="perception", text="Tracking is back. Carry on.")
        if self.agent is not None and not self.stopped:
            for e in events:
                if e.type in CHECKPOINT_EVENTS:
                    self._checkpoint(CHECKPOINT_EVENTS[e.type], [e.id], t)
        if self.stopped or self.paused:
            return out
        ctx = CoachContext(mode=self.mode, events=[e for e in events if e.type != "frame"], snapshot=snapshot, exertion=state, prescription=self.prescription, t=t, last_speak_t=self._last_speak_t, last_cue_t=self._last_cue_t)
        for d in self.coach.decide(ctx):
            out.append(self._coach_event(d, t))
        return out

    def take_commands(self) -> list[dict[str, Any]]:
        """Hand the queued pipeline commands to the caller (once)."""
        out, self.commands = self.commands, []
        return out

    # ---- internals ---------------------------------------------------------------------
    def _log_stop(self, evs: list[Event]) -> list[Event]:
        for e in evs:
            self._ring.append(e)
            if e.type == "stop":
                self.epoch += 1  # any agent run in flight is now stale
            if e.type in ("stop", "pause", "rest"):
                self.trace.log("stop_rule", action=e.type, rule=e.payload.get("rule"), text=e.payload.get("text"))
                if e.type in ("pause", "rest"):
                    self._clock_pause(e.t)  # the patient resumes both with a tap
                if e.type == "pause":
                    self.paused, self.pause_rule = True, e.payload.get("rule")
                    if e.payload.get("rule") in CHECKPOINT_PAUSES and not self.stopped and self.agent is not None:
                        # an `event` row the trace panel can pair with agent_run.trigger
                        self.trace.log("event", type="pause", id=e.id, t=e.t, rule=e.payload.get("rule"))
                        self._checkpoint(f"pause:{e.payload.get('rule')}", [e.id], e.t)
            elif e.type == "therapist_flag":
                self.trace.log("flag", rule=e.payload.get("rule"), detail=e.payload.get("detail"))
        return evs

    def _coach_event(self, d: Decision, t: float) -> Event:
        if d.source == "rule":
            d.label = (d.label or LABEL) if self.rule_label == LABEL else self.rule_label
        else:
            d.label = d.label or "Claude agent"
        self.trace.log("decide", action=d.action, cue_id=d.cue_id, reason=d.reason, evidence=d.evidence, label=d.label, source=d.source)
        for call in d.tool_calls:
            self.trace.log("tool", **call)
        spoken = speak(d.text, t, d.cue_id, d.action)
        # `kind` is the row type (Trace.log), so the action verb goes in `tool`.
        self.trace.log("action", tool="speak", text=d.text, ui=d.ui, label=d.label, source=d.source)
        if d.ui.get("prompt"):
            self.pending_prompt = d.ui["prompt"]
        for rx_key, fields in (d.ui.get("apply") or {}).items():
            if isinstance(fields, dict) and "hold_s" in fields:
                self.commands.append({"cmd": "set_hold", "hold_s": fields["hold_s"], "rx": rx_key, "evidence": list(d.evidence)})
        if d.action == "correct":
            self.counts["corrections"] += 1
        self.decisions.append(d.to_dict() | {"t": t})
        self._last_speak_t = t
        self._last_cue_t[d.cue_id] = t
        return make_event("coach", t=t, **d.to_dict(), speak_id=spoken.id)

    def _coach_summary(self, notes: list[dict[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {"label": self.rule_label, "notes": notes, "decisions": len(self.decisions)}
        if self.agent is not None:
            out["agent"] = self.agent.label
            out["agent_decisions"] = sum(1 for d in self.decisions if d.get("source") == "agent")
        if self.coach_note is not None:
            out["note"] = self.coach_note
        return out

    def summary(self, t: float | None = None) -> dict[str, Any]:
        notes = []
        for d in self.decisions:
            if d["action"] in ("progress", "regress", "rest", "correct"):
                conf = "high" if d["evidence"] else "medium"
                notes.append({"text": f"{d['action']}: {d['reason']}", "confidence": conf, "evidence": d["evidence"], "cat": note_category(d)})
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
            "exercise": self.exercise,
            "username": self.username,
            "t_start": self.t_start,
            "t_end": t_end,
            # Replay feeds clip time (seconds from 0), live sessions wall-clock epoch seconds.
            "clock": "wall" if (self.t_start or 0) >= 1e9 else "clip",
            "source": "replay" if self.replay_clip else "live",
            "replay_clip": self.replay_clip,
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
            "coach": self._coach_summary(notes),
            "flags": list(self.stop_rules.flags),
            "stopped": self.stopped,
            "delivery": "queued · not yet delivered",
        }
