from praxis_session.events import make_event
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.stop_rules import StopRules


def types(evs):
    return [e.type for e in evs]


def test_pain_at_threshold_stops_and_flags():
    sr = StopRules(SEED_PRESCRIPTION)
    evs = sr.on_pain(7, t=1.0)  # seed stop level = the rest tier (23 Sep)
    assert types(evs) == ["stop", "therapist_flag"]
    assert evs[0].payload["rule"] == "pain" and sr.stopped
    assert sr.on_pain(2, t=2.0) == [] or sr.stopped


def test_pain_below_threshold_does_nothing():
    sr = StopRules(SEED_PRESCRIPTION)
    assert sr.on_pain(6, t=1.0) == [] and not sr.stopped  # 4-6 is the gentle tier, not a stop


def test_new_symptoms_block_before_session():
    sr = StopRules(SEED_PRESCRIPTION)
    evs = sr.on_checkin(pain=2, new_symptoms=True, t=0.0)
    assert types(evs) == ["stop", "therapist_flag"] and evs[0].payload["rule"] == "symptoms"


def test_lean_flag_pauses_once():
    sr = StopRules(SEED_PRESCRIPTION)
    evs = sr.on_events([make_event("compensation_lean", t=5.0, lean_deg=15, count=3, flagged=True)])
    assert types(evs) == ["pause", "therapist_flag"] and evs[0].payload["rule"] == "lean"
    assert sr.on_events([make_event("compensation_lean", t=6.0, lean_deg=15, count=4, flagged=True)]) == []


def lean(t, count):
    return make_event("compensation_lean", t=t, lean_deg=15.0, count=count, flagged=count >= 3)


def test_lean_rule_does_not_pause_on_the_second_lean():
    """The coach regresses on the second lean; the stop rule must leave it that event."""
    sr = StopRules(SEED_PRESCRIPTION)
    assert sr.on_events([lean(1, 1)]) == [] and sr.on_events([lean(2, 2)]) == []


def test_lean_rule_re_arms_after_n_more_leans():
    """24 Sep review: the lean flag never reset, so after one pause the patient could lean
    for the rest of the session. It now pauses again after another `lean_events` leans."""
    sr = StopRules(SEED_PRESCRIPTION)
    assert types(sr.on_events([lean(1, 1), lean(2, 2), lean(3, 3)])) == ["pause", "therapist_flag"]
    assert sr.on_events([lean(4, 4), lean(5, 5)]) == []
    assert types(sr.on_events([lean(6, 6)])) == ["pause", "therapist_flag"]


def test_lean_thresholds_come_from_the_prescription():
    rx = SEED_PRESCRIPTION.model_copy(deep=True)
    rx.stop_rules.lean_events, rx.stop_rules.lean_deg = 2, 20.0
    sr = StopRules(rx)
    evs = sr.on_events([lean(1, 1), lean(2, 2)])
    assert types(evs) == ["pause", "therapist_flag"] and "20" in evs[1].payload["detail"]


def test_three_consecutive_unverified_reps_pause():
    sr = StopRules(SEED_PRESCRIPTION)
    bad = [make_event("reach_complete", t=i, verified=False, reason="cup_occluded", to_dot=i) for i in range(3)]
    evs = sr.on_events(bad[:2])
    assert evs == []
    evs = sr.on_events(bad[2:])
    assert types(evs) == ["pause", "therapist_flag"] and evs[0].payload["rule"] == "failed_reps"
    assert sr.on_events([make_event("reach_complete", t=9, verified=True, to_dot=1)]) == []


def test_failed_reps_fires_again_after_three_more_and_resets_on_resume():
    sr = StopRules(SEED_PRESCRIPTION)
    bad = lambda t: make_event("reach_complete", t=t, verified=False, reason="cup_occluded", to_dot=1)  # noqa: E731
    assert types(sr.on_events([bad(1), bad(2), bad(3)])) == ["pause", "therapist_flag"]
    assert types(sr.on_events([bad(4), bad(5), bad(6)])) == ["pause", "therapist_flag"]  # not once-only
    sr.on_events([bad(7), bad(8)])
    sr.on_resume()  # the patient fixed the setup: the streak starts over
    assert sr.on_events([bad(9)]) == []
    assert types(sr.on_events([bad(10), bad(11)])) == ["pause", "therapist_flag"]


def test_perception_loss_pauses_and_exertion_forces_rest():
    sr = StopRules(SEED_PRESCRIPTION)
    evs = sr.on_events([make_event("perception_lost", t=3.0, missing=[1])])
    assert types(evs) == ["pause"] and evs[0].payload["rule"] == "perception"
    evs = sr.on_exertion({"level": "high", "reasons": ["RPE 8/10"]}, high_for_s=61.0, t=100.0)
    assert types(evs) == ["rest", "therapist_flag"] and evs[0].payload["rule"] == "exertion"
    assert sr.on_exertion({"level": "high", "reasons": []}, high_for_s=70.0, t=101.0) == []  # once per episode


def test_perception_pause_says_it_will_carry_on_and_fires_again_after_regain():
    """D-CAL-2: the pause copy promises auto-resume; a second loss after a regain pauses again."""
    sr = StopRules(SEED_PRESCRIPTION)
    evs = sr.on_events([make_event("perception_lost", t=3.0, missing=[1, 2])])
    assert types(evs) == ["pause"] and evs[0].payload["missing"] == [1, 2]
    assert "carry on" in evs[0].payload["text"].lower()
    assert sr.on_events([make_event("perception_regained", t=4.0)]) == []
    assert types(sr.on_events([make_event("perception_lost", t=9.0, missing=[0])])) == ["pause"]
