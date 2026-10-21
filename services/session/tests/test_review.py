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


def test_agent_section_reads_runs_tools_errors_and_cost_from_traces():
    s = _live("a", "ravi")
    s["summary"]["coach"] |= {"agent": "Claude agent · Anthropic API", "agent_decisions": 2}
    trace = [
        {"kind": "agent_run", "phase": "start", "trigger": "checkin"},
        {"kind": "tool", "server": "perception", "name": "get_events", "ok": True},
        {"kind": "tool", "server": "coach", "name": "speak", "ok": False},
        {"kind": "tool", "tool": "get_prescription"},  # a rule-coach decision's tool line: not counted
        {"kind": "agent_run", "phase": "end", "trigger": "checkin", "outcome": "done", "transport": "mcp", "model": "m",
         "ms": 3000.0, "first_action_ms": 2000.0, "input_tokens": 1000, "output_tokens": 100, "cache_read_tokens": 9000, "cache_write_tokens": 0},
        {"kind": "agent_error", "error_kind": "timeout", "message": "run took too long"},
        {"kind": "agent_drop", "reason": "session stopped"},
    ]
    prices = {"m": {"input": 2.0, "output": 10.0, "cache_read": 0.2, "cache_write": 2.5}}
    r = build_review([s, _live("b", "sam")], {"a": trace}, prices)
    a = r["agent"]
    assert a["sessions"] == 1 and a["runs"] == 1 and a["agent_decisions"] == 2
    assert a["outcomes"] == {"done": 1} and a["tools"] == {"get_events": 1, "speak": 1} and a["tool_failures"] == {"speak": 1}
    assert a["errors"] == {"timeout": 1} and a["drops"] == {"session stopped": 1}
    assert a["first_action_ms_p50"] == 2000.0
    assert a["cost_usd"] == round((1000 * 2 + 100 * 10 + 9000 * 0.2) / 1e6, 4)
    assert any(i["exercise"] == "AI coach" and "timeout" in i["what"] for i in r["issues"])
    md = render_md(r)
    assert "## AI coach" in md and "speak 1" in md and "timeout" in md


def test_guardrail_refusals_are_counted_apart_from_tool_failures():
    """21 Oct: the hosted review listed a stale `speak`/`recalibrate` and a no_change
    `propose_adjustment` as "tool call failed". They were guardrails doing their job; older trace
    rows only carry the kind inside `result_summary`, newer ones say `refused` directly."""
    s = _live("a", "ravi")
    s["summary"]["coach"] |= {"agent": "Claude agent · Anthropic API", "agent_decisions": 1}
    trace = [
        {"kind": "tool", "server": "coach", "name": "speak", "ok": False, "result_summary": '{"error": "stale: the session moved on since this checkpoint", "kind": "stale"}'},
        {"kind": "tool", "server": "perception", "name": "recalibrate", "ok": False, "error_kind": "stale", "refused": True},
        {"kind": "tool", "server": "coach", "name": "propose_adjustment", "ok": False, "result_summary": '{"error": "no change: hold_s is already 2", "kind": "no_change"}'},
        {"kind": "tool", "server": "coach", "name": "write_session_summary", "ok": False, "error_kind": "evidence", "refused": False},
    ]
    r = build_review([s], {"a": trace})
    a = r["agent"]
    assert a["tool_failures"] == {"write_session_summary": 1}
    assert a["tool_refusals"] == {"speak": {"stale": 1}, "recalibrate": {"stale": 1}, "propose_adjustment": {"no_change": 1}}
    whats = [i["what"] for i in r["issues"] if i["exercise"] == "AI coach"]
    assert whats == ["tool call failed: write_session_summary"]
    md = render_md(r)
    assert "refused by a guardrail: speak 1 (stale)" in md and "propose_adjustment 1 (no_change)" in md


def test_agent_section_says_when_the_agent_was_off():
    assert "rule coach only" in render_md(build_review([_live("a", "ravi")]))


def _arm(sid, events):
    s = _live(sid, "ravi", mode="arm", events=events)
    s["title"], s["exercise"] = "Arm out to the side", "abduction"
    return s


def test_setup_blocked_label_is_exercise_aware_and_counts_the_pauses_the_patient_saw():
    """21 Oct: the arm has no sheet. Its setup_blocked is the camera view check, and it can
    re-fire while the set is already paused for it, so the count is the pauses the patient saw;
    the failing checks are listed with how often each held."""
    arm_events = [
        {"type": "setup_blocked", "reason": "hips_out_of_view"},
        {"type": "pause", "rule": "setup"},
        {"type": "setup_blocked", "reason": "hips_out_of_view"},  # while already paused
        {"type": "setup_blocked", "reason": "hips_out_of_view"},
    ]
    r = build_review([_arm("a", arm_events), _live("c", "ravi", events=[{"type": "setup_blocked"}])])
    whats = {(i["exercise"], i["what"]): i["count"] for i in r["issues"]}
    assert whats[("Arm out to the side", "camera view check paused the set — hips_out_of_view ×3")] == 1
    assert whats[("Waiter – cup", "setup could not see the sheet")] == 1
    assert not any("sheet" in w for (ex, w) in whats if ex == "Arm out to the side")


def test_shoulder_hiking_is_reported_as_a_flag_not_a_cue():
    r = build_review([_arm("a", [{"type": "shoulder_hiking"}, {"type": "shoulder_hiking"}])])
    assert any(i["what"] == "shoulder hiking flagged" and i["count"] == 2 for i in r["issues"])
