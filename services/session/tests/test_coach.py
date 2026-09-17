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
    assert d[0].action == "instruct" and "4" in d[0].text and d[0].evidence == [e.id]
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


def test_in_rep_cues_are_not_dropped_at_one_second_cadence():
    """Audit A8: one global 2.5 s gap dropped every second cup cue. Per-cue cooldowns keep them."""
    c = RuleCoach()
    evs = [make_event("reach_complete", t=5.0 + i, to_dot=(i + 1) % 5, from_dot=i % 5, verified=True, reason=None, reach_ms=1000, arc=1, phase="slow") for i in range(8)]
    d = c.decide(ctx("cup", evs, 13.0))
    assert [x.action for x in d] == ["instruct"] * 8
    assert d[0].text != d[1].text  # phrase pool, no immediate repeat
    assert all(len(x.text.split()) <= 6 for x in d)  # short in-rep cues


def test_arm_lift_hold_lower_rep_all_speak():
    c = RuleCoach()
    evs = [
        make_event("state_change", t=1.0, **{"from": "start_pose", "to": "moving"}),
        make_event("state_change", t=2.0, **{"from": "moving", "to": "hold"}),
        make_event("state_change", t=5.0, **{"from": "hold", "to": "return"}),
        make_event("rep_complete", t=8.0, set=1, rep=1, peak_deg=88, hold_s=3.0, verified=True, reason=None),
    ]
    d = c.decide(ctx("arm", evs, 8.0))
    assert [x.cue_id for x in d] == ["arm_lift", "arm_hold", "arm_lower", "arm_rep"]
    assert "1 of 8" in d[3].text


def test_same_cue_respects_its_cooldown_but_corrections_always_pass():
    c = RuleCoach()
    e1 = make_event("state_change", t=1.0, **{"from": "start_pose", "to": "moving"})
    e2 = make_event("state_change", t=1.3, **{"from": "start_pose", "to": "moving"})
    d = c.decide(ctx("arm", [e1, e2], 1.3))
    assert [x.cue_id for x in d] == ["arm_lift"]
    e3 = make_event("wrong_dot", t=6.5, dot=4, expected=3)
    assert c.decide(ctx("cup", [e3], 6.5, last_speak_t=6.4))[0].action == "correct"


def test_arc_summary_cites_numbers_and_trend():
    c = RuleCoach()
    e = make_event("arc_complete", t=30.0, arc=2, phase="fast", mean_reach_ms=900, unverified=1, awaiting_phase=False, reaches=4)
    d = c.decide(ctx("cup", [e], 30.0, snapshot={"cup": {"phase": "fast", "arc_means_ms": [1200.0, 900.0]}}))
    assert d[0].cue_id == "cup_arc_summary"
    assert "3 of 4 verified" in d[0].text and "0.9 s" in d[0].text and "quicker" in d[0].text


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
