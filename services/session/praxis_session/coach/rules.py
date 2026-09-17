"""Deterministic rule coach. Labeled in every decision; ships before the LLM agent."""
from __future__ import annotations

from praxis_session.coach.base import CoachContext, Decision
from praxis_session.events import Event
from praxis_session.perception.exercises import get as get_exercise
from praxis_session.prescription import clamp

LABEL = "Rule-based coach · LLM agent pending"

# Cadence (audit 17 Sep, A8). One global gap dropped every second cup cue and every arm
# "hold"/"good lift". Now: a short minimum spacing between any two instruct cues, plus a
# per-cue cooldown so the same cue is not repeated back to back. Corrections, prompts,
# rest and regress always pass.
INSTRUCT_GAP_S = 0.6
COOLDOWN_S: dict[str, float] = {"arm_lift": 0.8, "arm_hold": 0.8, "arm_lower": 0.8, "arm_swing": 1.5}

# Sprint E: one intro and one done line per exercise, in our own words (GRASP text is UBC /
# Heart & Stroke material; see docs/LICENSES.md). Everything else reuses the arm pools.
INTRO: dict[str, str] = {
    "pendulum": "Pendulum: lean forward on the table, let the arm hang heavy, and swing it gently forward and back.",
    "flexion": "Arm to the front: sit side-on to me, lift to shoulder height and hold while I count three.",
    "abduction": "Arm out to the side: face me, lift out to shoulder height, and keep the shoulder down.",
    "scaption": "Arm out at an angle: face me and lift half-way between front and side, thumb up.",
    "extension": "Arm to the back: sit side-on and draw the arm gently behind you. Small range here.",
    "external_rotation": "Rotate out: elbow tucked against your side, swing the forearm out away from your tummy.",
    "internal_rotation": "Rotate in: elbow tucked against your side, bring the forearm across toward your tummy.",
}
DONE: dict[str, str] = {
    "pendulum": "That's your swings done — loose and easy, exactly the idea.",
    "flexion": "Both sets done. Rest your arm — good work.",
    "abduction": "Both sets done. That's the side lifts finished — rest the shoulder.",
    "scaption": "Both sets done. That's the angled lifts finished. Nicely controlled.",
    "extension": "Both sets done. Small range, and you kept it steady — good.",
    "external_rotation": "Both sets done. The elbow stayed put the whole way — well done.",
    "internal_rotation": "Both sets done. Rest the arm — that's the rotations finished.",
}

# Short in-rep cues (spoken while the patient moves); milestones keep full sentences.
PHRASES: dict[str, list[str]] = {
    "cup_onto_dot": ["Dot {n}. Good.", "Onto {n}.", "{n}, nice and level.", "Dot {n}, steady."],
    "arm_lift": ["Lift slowly to the line.", "Up to the line, slowly.", "Lift, no higher than your shoulder."],
    "arm_swing": ["Let it swing, loose and easy.", "Gentle swings — let the weight do it.", "Swing it, don't lift it."],
    "arm_hold": ["Hold… three.", "Hold it there. Three."],
    "arm_lower": ["Lower for three.", "Down slowly, three."],
    "arm_rep": ["Good, {rep} of {reps}.", "{rep} of {reps}. Nice.", "That's {rep} of {reps}."],
}


class RuleCoach:
    name = "rules"

    def __init__(self) -> None:
        self._rested = False
        self._regressed_hold = False
        self._proposed_progression = False
        self._pool_idx: dict[str, int] = {}

    def _phrase(self, cue_id: str, **kw: object) -> str:
        pool = PHRASES[cue_id]
        i = self._pool_idx.get(cue_id, -1) + 1
        self._pool_idx[cue_id] = i
        return pool[i % len(pool)].format(**kw)

    def decide(self, ctx: CoachContext) -> list[Decision]:
        out: list[Decision] = []
        last_speak = ctx.last_speak_t
        last_cue = dict(ctx.last_cue_t)
        for e in ctx.events:
            for d in self._for_event(e, ctx):
                if d.action == "instruct":
                    if e.t - last_cue.get(d.cue_id, -1e9) < COOLDOWN_S.get(d.cue_id, 0.0):
                        continue  # same cue too soon
                    if e.t - last_speak < INSTRUCT_GAP_S:
                        continue  # instruct cues need a little air between them
                d.label = LABEL
                out.append(d)
                last_cue[d.cue_id] = e.t
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
                    return [Decision("instruct", "cup_onto_dot", self._phrase("cup_onto_dot", n=dot), "verified reach", ev, {"avatar_clip": "cup"})]
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
                return [self._arc_summary(p, cup, ev)]
            if e.type == "cup_complete":
                return [Decision("instruct", "cup_done", "All four arcs done. Lovely work.", "cup complete", ev)]
        if m == "arm":
            ex = self._exercise(ctx, p)
            if e.type == "exercise_start":
                return [
                    Decision(
                        "instruct", "arm_intro",
                        INTRO.get(ex.id, f"{ex.name}: {ex.steps[0] if ex.steps else 'follow the figure.'}"),
                        f"{ex.name} started, {p.get('dose') or ex.dose}", ev,
                        {"avatar_clip": ex.clip},
                    )
                ]
            if e.type == "state_change":
                to = p.get("to")
                if to == "moving" and ex.kind == "oscillation":
                    return [Decision("instruct", "arm_swing", self._phrase("arm_swing"), "swinging started", ev, {"avatar_clip": ex.clip})]
                if to == "moving":
                    return [Decision("instruct", "arm_lift", self._phrase("arm_lift"), "lift started", ev, {"avatar_clip": ex.clip})]
                if to == "hold":
                    return [Decision("instruct", "arm_hold", self._phrase("arm_hold"), "target reached", ev)]
                if to == "return":
                    return [Decision("instruct", "arm_lower", self._phrase("arm_lower"), "returning", ev)]
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
                reps = self._reps_per_set(ctx, ex)
                if p.get("verified"):
                    return [Decision("instruct", "arm_rep", self._phrase("arm_rep", rep=p.get("rep"), reps=reps), "verified rep", ev)]
                why = {
                    "target_missed": "it stopped short of the line",
                    "hold_too_short": f"the hold was under {ex.hold_s:g}",
                    "swing_too_small": "the swing was very small",
                }.get(str(p.get("reason")), "I couldn't verify it")
                nudge = "Next one, a little more swing — still loose." if ex.kind == "oscillation" else f"Next one, up to the line and hold for {ex.hold_s:g}."
                return [Decision("correct", "arm_unverified", f"That one didn't count: {why}. {nudge}", f"unverified rep ({p.get('reason')})", ev)]
            if e.type == "set_complete":
                return [self._set_summary(p, ev)]
            if e.type == "arm_complete":
                return [Decision("instruct", "arm_done", DONE.get(ex.id, "Both sets done. Rest your arm — good work."), "exercise complete", ev)]
        return []

    # ---- Sprint E helpers ----------------------------------------------------------------
    @staticmethod
    def _exercise(ctx: CoachContext, payload: dict):
        """Which registry entry this arm session is running: the event says so at the start,
        the frame snapshot says so from then on."""
        return get_exercise(payload.get("exercise") or ctx.snapshot.get("arm", {}).get("exercise"))

    @staticmethod
    def _reps_per_set(ctx: CoachContext, ex) -> int:
        """The dose actually running (tier overrides included), not the seed prescription."""
        reps = ctx.snapshot.get("arm", {}).get("reps_per_set")
        if isinstance(reps, int) and reps > 0:
            return reps
        if ex.id == "flexion":
            return int(ctx.prescription.exercises.get("arm", {}).get("reps", ex.reps))
        return ex.reps

    def _set_summary(self, p: dict, ev: list[int]) -> Decision:
        """Milestone with the numbers the camera verified (the same numbers a judge reads in
        the trace): reps verified in the set and the best angle of those reps."""
        total = int(p.get("reps") or 0)
        verified = p.get("verified_reps")
        best = p.get("best_deg")
        parts = [f"Set {p.get('set')} done."]
        if total and verified is not None:
            parts.append(f"{verified} of {total} verified.")
        if best:
            parts.append(f"Best {float(best):.0f}°.")
        parts.append("Rest for thirty seconds.")
        reason = f"set {p.get('set')} complete: {verified if verified is not None else '?'}/{total} verified"
        if best:
            reason += f", best {float(best):.0f}°"
        return Decision(
            "instruct", "arm_set", " ".join(parts), reason, ev,
            tool_calls=[{"tool": "get_events", "result": {"set": p.get("set"), "reps": total, "verified_reps": verified, "best_deg": best}}],
        )

    def _arc_summary(self, p: dict, cup: dict, ev: list[int]) -> Decision:
        """Milestone with the numbers the decision used (also what a judge reads in the trace)."""
        arc = int(p.get("arc") or 0)
        unverified = int(p.get("unverified") or 0)
        total = int(p.get("reaches") or 0)
        mean = p.get("mean_reach_ms")
        means = [m for m in (cup.get("arc_means_ms") or []) if m is not None]
        trend = ""
        if mean and len(means) >= 2 and means[-2]:
            ratio = float(mean) / float(means[-2])
            if ratio < 0.92:
                trend = f", quicker than arc {arc - 1}"
            elif ratio > 1.08:
                trend = f", a touch slower than arc {arc - 1}"
        parts = [f"Arc {arc}:"]
        if total:
            parts.append(f"{total - unverified} of {total} verified")
        if mean:
            parts.append(f"mean reach {float(mean) / 1000:.1f} s{trend}")
        text = " ".join(parts[:1]) + " " + ", ".join(parts[1:]) + ". Rest your hand for a moment."
        reason = f"arc {arc} complete: {total - unverified}/{total} verified" + (f", mean {float(mean):.0f} ms" if mean else "") + (f", previous {means[-2]:.0f} ms" if len(means) >= 2 else "")
        return Decision("instruct", "cup_arc_summary", text, reason, ev, tool_calls=[{"tool": "get_events", "result": {"arc": arc, "reaches": total, "unverified": unverified}}])
