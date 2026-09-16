"""Deterministic rule coach. Labeled in every decision; ships before the LLM agent."""
from __future__ import annotations

from praxis_session.coach.base import CoachContext, Decision
from praxis_session.events import Event
from praxis_session.prescription import clamp

LABEL = "Rule-based coach · LLM agent pending"
SPEAK_GAP_S = 2.5


class RuleCoach:
    name = "rules"

    def __init__(self) -> None:
        self._rested = False
        self._regressed_hold = False
        self._proposed_progression = False

    def decide(self, ctx: CoachContext) -> list[Decision]:
        out: list[Decision] = []
        last_speak = ctx.last_speak_t
        for e in ctx.events:
            for d in self._for_event(e, ctx):
                if d.action == "instruct" and e.t - last_speak < SPEAK_GAP_S:
                    continue  # rate-limited; corrections and prompts always pass
                d.label = LABEL
                out.append(d)
                if d.action in ("instruct", "correct", "rest", "regress"):
                    last_speak = e.t
        if ctx.exertion.get("level") == "high" and not self._rested and ctx.events:
            self._rested = True
            ev = ctx.events[-1]
            out.append(
                Decision(
                    action="rest", cue_id="rest_exertion",
                    text="You've been working hard. Let's take a short rest before the next one.",
                    reason=f"behavioural exertion high: {', '.join(ctx.exertion.get('reasons', []))}",
                    evidence=[ev.id], ui={"chip": "exertion_high"}, label=LABEL,
                    tool_calls=[{"tool": "get_exertion_state", "result": ctx.exertion}],
                )
            )
        if ctx.exertion.get("level") != "high":
            self._rested = False
        return out

    # ---- per-event rules ----------------------------------------------------------------
    def _for_event(self, e: Event, ctx: CoachContext) -> list[Decision]:
        p = e.payload
        ev = [e.id]
        m = ctx.mode
        if m == "nhpt":
            if e.type == "nhpt_start":
                return [Decision("instruct", "nhpt_start", "Nice and steady. Timer is running — no need to rush.", "first peg lifted", ev, {"avatar_clip": "nhpt"})]
            if e.type == "nhpt_split" and p.get("peg") == 5:
                return [Decision("instruct", "nhpt_half", "Halfway there. Keep the same pace.", "fifth peg seated", ev)]
            if e.type == "drop":
                return [Decision("correct", "nhpt_drop", "No problem — pick it up and carry on; the timer keeps running.", "peg dropped", ev)]
            if e.type == "nhpt_complete":
                return [Decision("instruct", "nhpt_done", f"All nine seated in {p.get('total_s', 0):.1f} seconds. Nicely done.", "ninth peg seated", ev)]
        if m == "cup":
            if e.type == "reach_complete":
                dot = int(p["to_dot"]) + 1
                if p.get("verified"):
                    return [Decision("instruct", "cup_onto_dot", f"Onto dot {dot} — good. Let your hand come back to your lap before the next reach.", "verified reach", ev, {"avatar_clip": "cup"})]
                why = "keep your hand clear after you place it" if p.get("reason") == "cup_occluded" else "keep all four corner markers in view"
                return [Decision("correct", "cup_unverified", f"I couldn't verify that one — {why}.", f"unverified reach ({p.get('reason')})", ev)]
            if e.type == "wrong_dot":
                return [Decision("correct", "cup_wrong_dot", f"That's dot {int(p['dot']) + 1}; next is dot {int(p['expected']) + 1}. One dot at a time.", "wrong dot", ev)]
            if e.type == "arc_complete":
                cup = ctx.snapshot.get("cup", {})
                allowed = bool(ctx.prescription.allowed_adaptations.get("cup", {}).get("fast_arcs"))
                if p.get("awaiting_phase") and cup.get("phase", "slow") == "slow" and allowed and (p.get("unverified") or 0) <= 1 and not self._proposed_progression:
                    self._proposed_progression = True
                    mean = p.get("mean_reach_ms")
                    reason = f"two clean slow arcs{f', mean reach {mean / 1000:.1f} s' if mean else ''}, {p.get('unverified', 0)} unverified"
                    return [
                        Decision(
                            "progress", "cup_progress",
                            "Two clean slow arcs. Want to try the fast arcs? They're in your program.",
                            reason, ev,
                            {"prompt": {"id": "progression", "title": "Coach suggests: try the fast arcs", "text": reason, "options": ["Yes, go faster", "Keep pace", "Why?"], "within_prescription": True}, "avatar_clip": "cup"},
                            tool_calls=[{"tool": "get_prescription", "result": {"level": ctx.prescription.level, "fast_arcs": "allowed"}}],
                        )
                    ]
                return [Decision("instruct", "cup_arc", f"Arc {p.get('arc')} done. Rest your hand for a moment.", "arc complete", ev)]
            if e.type == "cup_complete":
                return [Decision("instruct", "cup_done", "All four arcs done. Lovely work.", "cup complete", ev)]
        if m == "arm":
            if e.type == "state_change":
                to = p.get("to")
                if to == "moving":
                    return [Decision("instruct", "arm_lift", "Lift slowly to the line — no higher than your shoulder.", "lift started", ev, {"avatar_clip": "armFront"})]
                if to == "hold":
                    return [Decision("instruct", "arm_hold", "Hold for three.", "target reached", ev)]
                if to == "return":
                    return [Decision("instruct", "arm_lower", "Lower for three.", "returning", ev)]
            if e.type == "compensation_lean":
                out = [Decision("correct", "arm_lean", "Sit tall — you're leaning back to lift. Lower the arm a little and lift from the shoulder.", f"trunk lean {p.get('lean_deg')}°", ev)]
                if p.get("flagged") and not self._regressed_hold:
                    try:
                        hold = clamp(ctx.prescription, "arm", "hold_s", 2.0)
                    except KeyError:
                        hold = None
                    if hold is not None:
                        self._regressed_hold = True
                        out.append(
                            Decision(
                                "regress", "arm_regress_hold",
                                f"Let's make it easier: hold for {hold:g} instead of 3, still no higher than the shoulder.",
                                f"three lean events; hold_s clamped to {hold:g} within the prescription",
                                ev, {"apply": {"arm": {"hold_s": hold}}},
                                tool_calls=[{"tool": "get_prescription", "result": {"arm.hold_s": ctx.prescription.allowed_adaptations["arm"]["hold_s"]}}],
                            )
                        )
                return out
            if e.type == "shoulder_hiking":
                return [Decision("correct", "arm_hike", "Let the shoulder drop; lift from the arm, not the shoulder.", "shoulder hiking", ev)]
            if e.type == "hold_too_short":
                return [Decision("correct", "arm_short_hold", "A little longer at the top next time — count to three.", "hold too short", ev)]
            if e.type == "target_missed":
                return [Decision("correct", "arm_missed", "Nearly — a touch higher, up to the line.", "target missed", ev)]
            if e.type == "rep_complete":
                if p.get("verified"):
                    return [Decision("instruct", "arm_rep", f"Good lift — {p.get('rep')} of {ctx.prescription.exercises['arm']['reps']}.", "verified lift", ev)]
                why = {"target_missed": "it stopped short of the line", "hold_too_short": "the hold was under three"}.get(str(p.get("reason")), "I couldn't verify it")
                return [Decision("correct", "arm_unverified", f"That one didn't count: {why}. Next one, up to the line and hold for three.", f"unverified lift ({p.get('reason')})", ev)]
            if e.type == "set_complete":
                return [Decision("instruct", "arm_set", f"Set {p.get('set')} done. Rest for thirty seconds.", "set complete", ev)]
            if e.type == "arm_complete":
                return [Decision("instruct", "arm_done", "Both sets done. Rest your arm — good work.", "arm complete", ev)]
        return []
