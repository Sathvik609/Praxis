from praxis_session.review import build_review, clean_tester, render_md


def _live(sid, who, mode="cup", events=(), **cam):
    camera = {"reps_total": 4, "verified": 3, "unverified": 1, "missed": 0, "paused_s": 2.0} | cam
    return {
        "id": sid, "mode": mode, "exercise": None, "title": "Waiter – cup", "username": who, "source": "live",
        "status": "complete", "feedback": {"difficulty": "hard", "detail": "marker kept dropping"},
        "summary": {"camera": camera, "tracking_lost_events": 1, "flags": [], "latency": {"event_to_cue_p50": 0.8},
                    "coach": {"notes": [{"text": "correct: unverified rep (hand_occludes_cup)"}]}},
        "events": list(events),
    }


def test_clean_tester_keeps_a_short_lowercase_name():
    assert clean_tester("  Ravi K! ") == "ravi k"
    assert clean_tester("x" * 40) == "x" * 24
    assert clean_tester("") is None and clean_tester(None) is None and clean_tester("!!!") is None


def test_review_counts_live_sessions_per_tester_and_skips_samples_and_replays():
    events = [
        {"type": "perception_lost", "missing": [2]},
        {"type": "reach_complete", "verified": False, "reason": "hand_occludes_cup"},
        {"type": "reach_complete", "verified": True, "reason": None},
    ]
    rows = [
        _live("a", "ravi", events=events),
        _live("b", None, events=[]),
        {"id": "s", "mode": "cup", "source": "sample", "summary": {}, "events": []},
        {"id": "r", "mode": "cup", "source": "replay", "summary": {}, "events": []},
    ]
    r = build_review(rows)
    assert r["live_sessions"] == 2 and r["replay_sessions"] == 1
    assert r["testers"] == {"ravi": 1, "(no name)": 1}
    (cup,) = r["exercises"]
    assert cup["exercise"] == "Waiter – cup" and cup["reps"] == 8 and cup["verified"] == 6
    assert cup["unverified_reasons"] == {"hand_occludes_cup": 1}
    assert cup["lost_what"] == {"marker 2": 1}
    assert [t["tester"] for t in cup["per_tester"]] == ["(no name)", "ravi"]
    lost = next(i for i in r["issues"] if i["what"].startswith("camera lost tracking"))
    assert "marker 2" in lost["what"] and lost["sessions_hit"] == 1 and lost["of"] == 2
    # Widest first: "said it was hard" hit both sessions, tracking loss one.
    assert r["issues"][0]["share"] >= r["issues"][-1]["share"]
    md = render_md(r)
    assert "ravi" in md and "marker 2" in md and "“marker kept dropping”" in md


def test_review_with_no_live_sessions_says_so():
    md = render_md(build_review([{"id": "r", "mode": "nhpt", "source": "replay", "summary": {}, "events": []}]))
    assert "No live sessions yet" in md and "1 replay" in md
