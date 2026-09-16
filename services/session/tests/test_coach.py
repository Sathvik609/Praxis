from praxis_session.coach.base import ACTIONS, CoachContext, Decision
from praxis_session.coach.rules import LABEL, RuleCoach
from praxis_session.events import make_event
from praxis_session.prescription import SEED_PRESCRIPTION


def ctx(mode, events, t, snapshot=None, exertion=None, last_speak_t=-10.0):
    return CoachContext(
        mode=mode, events=events, snapshot=snapshot or {}, exertion=exertion or {"level": "low", "reasons": []},
        prescription=SEED_PRESCRIPTION, t=t, last_speak_t=last_speak_t,
    )


def test_actions_and_label():
    assert ACTIONS == ("instruct", "correct", "progress", "regress", "rest", "stop")
    assert "LLM agent pending" in LABEL


def test_verified_reach_instructs_with_evidence_and_avatar_clip():
    c = RuleCoach()
    e = make_event("reach_complete", t=5.0, to_dot=3, from_dot=2, verified=True, reason=None, reach_ms=1400, arc=1, phase="slow")
    d = c.decide(ctx("cup", [e], 5.0))
    assert len(d) == 1 and isinstance(d[0], Decision)
    assert d[0].action == "instruct" and "dot 4" in d[0].text and d[0].evidence == [e.id]
    assert d[0].ui.get("avatar_clip") == "cup" and d[0].label == LABEL


def test_unverified_reach_and_wrong_dot_are_corrections():
    c = RuleCoach()
    e1 = make_event("reach_complete", t=5.0, to_dot=3, from_dot=2, verified=False, reason="cup_occluded", reach_ms=900, arc=1, phase="slow")
    e2 = make_event("wrong_dot", t=6.0, dot=4, expected=3)
    d = c.decide(ctx("cup", [e1, e2], 6.0))
    assert [x.action for x in d] == ["correct", "correct"]
    assert "dot 5" in d[1].text and "dot 4" in d[1].text


def test_progression_is_proposed_only_within_prescription():
    c = RuleCoach()
    e = make_event("arc_complete", t=30.0, arc=2, phase="slow", mean_reach_ms=1200, unverified=0, awaiting_phase=True)
    d = c.decide(ctx("cup", [e], 30.0, snapshot={"cup": {"awaiting_phase": True, "phase": "slow"}}))
    assert d[0].action == "progress" and d[0].ui["prompt"]["id"] == "progression"
    assert d[0].ui["prompt"]["options"][0] == "Yes, go faster"
    p = SEED_PRESCRIPTION.model_copy(deep=True)
    p.allowed_adaptations["cup"]["fast_arcs"] = False
    c2 = RuleCoach()
    d2 = c2.decide(CoachContext(mode="cup", events=[e], snapshot={"cup": {"awaiting_phase": True, "phase": "slow"}}, exertion={"level": "low", "reasons": []}, prescription=p, t=30.0, last_speak_t=-10))
    assert all(x.action != "progress" for x in d2)


def test_arm_lean_corrects_and_third_flag_regresses_hold_within_range():
    c = RuleCoach()
    e = make_event("compensation_lean", t=10.0, lean_deg=15.0, count=1, flagged=False)
    d = c.decide(ctx("arm", [e], 10.0))
    assert d[0].action == "correct" and "Sit tall" in d[0].text
    e3 = make_event("compensation_lean", t=40.0, lean_deg=16.0, count=3, flagged=True)
    d3 = c.decide(ctx("arm", [e3], 40.0))
    reg = [x for x in d3 if x.action == "regress"]
    assert reg and reg[0].ui["apply"] == {"arm": {"hold_s": 2.0}}


def test_rate_limit_suppresses_back_to_back_instructions_but_not_corrections():
    c = RuleCoach()
    e1 = make_event("reach_complete", t=5.0, to_dot=1, from_dot=0, verified=True, reason=None, reach_ms=1000, arc=1, phase="slow")
    e2 = make_event("reach_complete", t=6.0, to_dot=2, from_dot=1, verified=True, reason=None, reach_ms=1000, arc=1, phase="slow")
    d = c.decide(ctx("cup", [e1, e2], 6.0))
    assert [x.action for x in d] == ["instruct"]
    e3 = make_event("wrong_dot", t=6.5, dot=4, expected=3)
    assert c.decide(ctx("cup", [e3], 6.5, last_speak_t=6.0))[0].action == "correct"


def test_high_exertion_proposes_rest_once():
    c = RuleCoach()
    e = make_event("rep_complete", t=50.0, set=1, rep=6, peak_deg=80, hold_s=3.0, verified=True, reason=None)
    d = c.decide(ctx("arm", [e], 50.0, exertion={"level": "high", "reasons": ["RPE 8/10"]}))
    assert any(x.action == "rest" for x in d)
    d2 = c.decide(ctx("arm", [make_event("rep_complete", t=60.0, set=1, rep=7, peak_deg=80, hold_s=3.0, verified=True, reason=None)], 60.0, exertion={"level": "high", "reasons": ["RPE 8/10"]}))
    assert all(x.action != "rest" for x in d2)


def test_nhpt_milestones():
    c = RuleCoach()
    d = c.decide(ctx("nhpt", [make_event("nhpt_start", t=1.0)], 1.0))
    assert d[0].action == "instruct" and "Timer" in d[0].text
    d = c.decide(ctx("nhpt", [make_event("nhpt_complete", t=40.0, total_s=39.0, splits_s=[], pegs=[])], 40.0))
    assert "nine" in d[0].text.lower()
