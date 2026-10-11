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


def test_every_stop_text_says_once_that_the_therapist_is_flagged():
    """10 Oct: the stop overlay shows only the service's text (no fixed web line), and every stop
    writes its therapist flag in the same batch, so the text must say so, once."""
    for evs in (StopRules(SEED_PRESCRIPTION).on_pain(8, t=1.0), StopRules(SEED_PRESCRIPTION).on_checkin(pain=2, new_symptoms=True, t=0.0)):
        stop, flag = evs
        assert flag.type == "therapist_flag"
        text = stop.payload["text"].lower()
        assert text.count("therapist is flagged") == 1 and text.count("therapist") == 1


def test_lean_flag_pauses_once():
    sr = StopRules(SEED_PRESCRIPTION)
    evs = sr.on_events([make_event("compensation_lean", t=5.0, lean_deg=15, count=3, flagged=True)])
    assert types(evs) == ["pause", "therapist_flag"] and evs[0].payload["rule"] == "lean"
    assert sr.on_events([make_event("compensation_lean", t=6.0, lean_deg=15, count=4, flagged=True)]) == []


def lean(t, count):
    return make_event("compensation_lean", t=t, lean_deg=15.0, count=count, flagged=count >= 3)


def rep(t, reason):
    return make_event("rep_complete", t=t, set=1, rep=int(t), peak_deg=70.0, hold_s=1.0, verified=reason is None, reason=reason)


def test_performance_misses_are_not_setup_failures():
    """24 Sep review: target_missed / hold_too_short / swing_too_small are the patient's
    performance, not perception. They never say "check the setup"; three in a row is a gentle
    rest (and a therapist flag), counted apart from reps the camera could not verify."""
    sr = StopRules(SEED_PRESCRIPTION)
    evs = sr.on_events([rep(1, "target_missed"), rep(2, "hold_too_short"), rep(3, "target_missed")])
    assert types(evs) == ["rest", "therapist_flag"]
    assert evs[0].payload["rule"] == "missed_reps"
    text = evs[0].payload["text"].lower()
    assert "setup" not in text and "verify" not in text and "rest" in text
    assert "missed" in evs[1].payload["detail"] and "target_missed" in evs[1].payload["detail"]


def test_perception_and_performance_streaks_are_counted_separately():
    sr = StopRules(SEED_PRESCRIPTION)
    occl = lambda t: make_event("reach_complete", t=t, verified=False, reason="cup_occluded", to_dot=1)  # noqa: E731
    assert sr.on_events([occl(1), occl(2), rep(3, "target_missed"), rep(4, "swing_too_small")]) == []
    # a miss means the camera saw the rep clearly: the perception streak starts over
    assert sr.on_events([occl(5), occl(6)]) == []
    evs = sr.on_events([occl(7)])
    assert types(evs) == ["pause", "therapist_flag"] and evs[0].payload["rule"] == "failed_reps"
    assert "setup" in evs[0].payload["text"]
    evs = sr.on_events([rep(8, "hold_too_short")])
    assert types(evs) == ["rest", "therapist_flag"] and evs[0].payload["rule"] == "missed_reps"


def test_missed_reps_threshold_comes_from_the_prescription_and_re_arms():
    rx = SEED_PRESCRIPTION.model_copy(deep=True)
    rx.stop_rules.missed_reps = 2
    sr = StopRules(rx)
    assert types(sr.on_events([rep(1, "target_missed"), rep(2, "target_missed")])) == ["rest", "therapist_flag"]
    assert sr.on_events([rep(3, "target_missed")]) == []
    assert sr.on_events([rep(4, None), rep(5, "target_missed")]) == []  # a verified rep resets it


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


def test_perception_pause_names_what_was_lost():
    """e2e 11 Oct: the peg test's pause said "the markers or your shoulder"; a sheet task names
    the corner markers, the arm task the shoulder."""
    sheet = StopRules(SEED_PRESCRIPTION).on_events([make_event("perception_lost", t=3.0, missing=[0, 1, 2, 3])])[0]
    assert "corner markers" in sheet.payload["text"] and "shoulder" not in sheet.payload["text"]
    arm = StopRules(SEED_PRESCRIPTION).on_events([make_event("perception_lost", t=3.0, missing=["pose"])])[0]
    assert "shoulder" in arm.payload["text"] and "marker" not in arm.payload["text"]
    assert all("carry on" in e.payload["text"] for e in (sheet, arm))


def test_tracking_loss_after_the_exercise_is_complete_does_not_pause():
    """Fake-camera e2e (11 Oct): once the cup / peg test / arm sets are done the camera keeps
    streaming; the patient tidying the sheet away must not post 'I lost tracking. Paused' on
    the done screen (or start an agent setup-recovery run)."""
    for done in ("cup_complete", "nhpt_complete", "arm_complete"):
        sr = StopRules(SEED_PRESCRIPTION)
        assert types(sr.on_events([make_event(done, t=1.0)])) == []
        assert sr.on_events([make_event("perception_lost", t=3.0, missing=[0, 1, 2, 3])]) == [], done
    # In the same batch, completion first, then the loss: still no pause.
    sr = StopRules(SEED_PRESCRIPTION)
    assert sr.on_events([make_event("cup_complete", t=1.0), make_event("perception_lost", t=1.5, missing=[0])]) == []
