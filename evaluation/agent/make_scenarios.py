"""Regenerates evaluation/agent/scenarios/*.json (the nine agent-coach scenarios of the design, §8).

    python evaluation/agent/make_scenarios.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / "scenarios"
OUT.mkdir(parents=True, exist_ok=True)


def reach(t, verified, reason=None, arc=1, to_dot=1):
    return {"type": "reach_complete", "t": t, "to_dot": to_dot, "from_dot": to_dot - 1, "verified": verified, "reason": reason, "reach_ms": 900 + 40 * t, "arc": arc, "phase": "slow"}


RECOVERY_SCRIPT = {
    "pause": [
        {"tool": "get_set_summary"},
        {"tool": "check_setup"},
        {"tool": "speak", "if": "check_setup.first_hint", "args": {"text": "{check_setup.first_hint}", "cue": "correct", "evidence": "$evidence"}},
        {"tool": "speak", "if": "check_setup.all_pass", "args": {"text": "The camera looks fine: after placing the cup, lift your hand clear so I can see the base.", "cue": "correct", "evidence": "$evidence"}},
        {"tool": "recalibrate"},
        {"tool": "request_resume", "args": {"reason": "I re-checked the setup with the camera.", "evidence": "$evidence"}},
        # 10 Oct: request_resume runs a fresh check and offers nothing while it still fails;
        # its `hint` is the fix to say again (one repeat line is allowed after a refusal).
        {"tool": "speak", "if": "request_resume.hint", "args": {"text": "Still not quite: {request_resume.hint}", "cue": "correct", "evidence": "$evidence"}},
    ]
}

scenarios = [
    {
        "id": "covered_marker",
        "title": "Covered marker: three unverified reaches, marker 2 under the hand",
        "mode": "cup",
        "steps": [
            {"frame": {"hide_marker": 2}},
            {"checkin": {"pain": 2}},
            {"run": {}},
            {"events": [reach(6, False, "marker_lost"), reach(11, False, "marker_lost"), reach(16, False, "marker_lost")]},
            {"run": {"feed": {"hide_marker": None}}},
            {"answer": {"kind": "resume", "choice": "accept"}},
        ],
        "script": {"checkin": [{"tool": "get_prescription"}, {"tool": "speak", "args": {"text": "Slow arcs today, one dot at a time.", "cue": "instruct", "evidence": "$evidence"}}], **RECOVERY_SCRIPT},
        "expect": {"triggers": ["checkin", "pause:failed_reps"], "perceive_before": {"speak": ["check_setup"], "request_resume": ["check_setup", "recalibrate"]}, "speak_mentions": ["bottom.right"], "prompt_kinds": ["resume"], "resumed_by_patient": True, "stopped": False, "errors": []},
    },
    {
        "id": "dim_light",
        "title": "Dim light: markers found but the frame is too dark, and it stays dark",
        "mode": "cup",
        "steps": [
            {"frame": {"dim": 0.22}},
            {"events": [reach(1, False, "marker_lost"), reach(2, False, "marker_lost"), reach(3, False, "marker_lost")]},
            # the patient has not fixed the light yet: the fresh check in request_resume still
            # fails, so no resume prompt is shown and the fix is said again (10 Oct)
            {"run": {"feed": {"dim": 0.22}}},
        ],
        "script": RECOVERY_SCRIPT,
        "expect": {"triggers": ["pause:failed_reps"], "perceive_before": {"speak": ["check_setup"]}, "speak_mentions": ["dark|light"], "prompt_kinds": [], "resume_blocked": True, "paused_at_end": True, "stopped": False, "errors": []},
    },
    {
        "id": "three_unverified",
        "title": "Three unverified reaches with a clean setup (hand over the cup)",
        "mode": "cup",
        "steps": [
            {"frame": {}},
            {"events": [reach(1, False, "cup_occluded"), reach(2, False, "cup_occluded"), reach(3, False, "cup_occluded")]},
            {"run": {"feed": {}}},
            {"answer": {"kind": "resume", "choice": "accept"}},
        ],
        "script": RECOVERY_SCRIPT,
        "expect": {"triggers": ["pause:failed_reps"], "perceive_before": {"speak": ["check_setup"]}, "speak_mentions": ["hand"], "prompt_kinds": ["resume"], "resumed_by_patient": True, "stopped": False, "errors": []},
    },
    {
        "id": "falling_peaks",
        "title": "Falling peaks and moderate exertion in set 1 of Arm out to the side",
        "mode": "arm",
        "steps": [
            {"events": [{"type": "rep_complete", "t": 3.0 * i, "set": 1, "rep": i + 1, "peak_deg": pk, "hold_s": 3.1, "verified": pk >= 82, "reason": None if pk >= 82 else "target_missed", "lean": False, "hike": False, "t_start": 3.0 * i - 2.5, "t_end": 3.0 * i} for i, pk in enumerate([90, 89, 86, 84, 82, 79, 81, 78])]
             + [{"type": "set_complete", "t": 21.0, "set": 1, "reps": 8, "verified_reps": 5, "best_deg": 90.0}]},
            {"rpe": 6},
            {"run": {}},
            {"answer": {"kind": "adjustment", "choice": "accept"}},
        ],
        "script": {"set_complete": [
            {"tool": "get_set_summary"},
            {"tool": "get_exertion_state"},
            {"tool": "get_prescription"},
            {"tool": "propose_adjustment", "args": {"exercise": "abduction", "field": "target_deg", "value": 80, "reason": "Your peaks slid from 90° to about 80° over the set; an 80° line keeps set 2 countable.", "evidence": "$evidence"}},
        ]},
        "expect": {"triggers": ["set_complete"], "perceive_before": {"propose_adjustment": ["get_set_summary"]}, "prompt_kinds": ["adjustment"], "applied_only_after_accept": {"field": "target_deg", "range": [60, 90]}, "stopped": False, "errors": []},
    },
    {
        "id": "repeated_lean",
        "title": "Two leaning lifts in a set (one below the lean pause)",
        "mode": "arm",
        "steps": [
            {"events": [
                {"type": "compensation_lean", "t": 4.0, "lean_deg": 15.0, "count": 1, "flagged": False},
                {"type": "rep_complete", "t": 5.0, "set": 1, "rep": 1, "peak_deg": 88.0, "hold_s": 3.1, "verified": True, "reason": None, "lean": True, "hike": False},
                {"type": "compensation_lean", "t": 9.0, "lean_deg": 16.0, "count": 2, "flagged": False},
                {"type": "rep_complete", "t": 10.0, "set": 1, "rep": 2, "peak_deg": 87.0, "hold_s": 3.0, "verified": True, "reason": None, "lean": True, "hike": False},
                {"type": "set_complete", "t": 10.0, "set": 1, "reps": 2, "verified_reps": 2, "best_deg": 88.0},
            ]},
            {"run": {}},
            {"answer": {"kind": "adjustment", "choice": "decline"}},
        ],
        "script": {"set_complete": [
            {"tool": "get_set_summary"},
            {"tool": "speak", "if": "get_set_summary.lean_count", "args": {"text": "You leaned back on {get_set_summary.lean_count} lifts. Sit tall and lift only as high as you can without leaning.", "cue": "correct", "evidence": "$evidence"}},
            {"tool": "propose_adjustment", "args": {"exercise": "abduction", "field": "target_deg", "value": 75, "reason": "Two lifts needed a lean to reach 90°; 75° lets you lift from the shoulder.", "evidence": "$evidence"}},
        ]},
        "expect": {"triggers": ["set_complete"], "perceive_before": {"speak": ["get_set_summary"]}, "actions": ["correct", "regress"], "prompt_kinds": ["adjustment"], "applied_only_after_accept": {"field": "target_deg", "range": [60, 90]}, "stopped": False, "errors": []},
    },
    {
        "id": "pain_stop_mid_run",
        "title": "Pain 8 reported while the agent is mid-run",
        "mode": "cup",
        "steps": [
            {"frame": {}},
            {"events": [reach(1, True), reach(2, True), reach(3, True), reach(4, True), {"type": "arc_complete", "t": 4.0, "arc": 1, "reaches": 4, "unverified": 0, "mean_reach_ms": 1000}]},
            {"run": {"pain_at_s": 0.05}},
        ],
        "script": {"arc_complete": [
            {"tool": "get_set_summary"},
            {"sleep": 0.2},
            {"tool": "speak", "args": {"text": "Nice even arc.", "cue": "instruct", "evidence": "$evidence"}},
        ]},
        "expect": {"triggers": ["arc_complete"], "stopped": True, "no_agent_output_after_stop": True, "outcome": "stale", "errors": []},
    },
    {
        "id": "model_timeout",
        "title": "The model does not answer within the run budget",
        "mode": "cup",
        "timeout_s": 0.2,
        "steps": [
            {"frame": {}},
            {"events": [reach(1, True), {"type": "arc_complete", "t": 1.0, "arc": 1, "reaches": 1, "unverified": 0}]},
            {"run": {}},
            {"events": [reach(2, True, arc=2, to_dot=2)]},
        ],
        "script": {"arc_complete": [{"sleep": 2.0}]},
        "expect": {"triggers": ["arc_complete"], "errors": ["timeout"], "offline": True, "rule_coach_after_error": True, "stopped": False},
    },
    {
        "id": "mcp_down",
        "title": "MCP servers unreachable: the same tools run directly",
        "mode": "cup",
        "mcp_url": "http://127.0.0.1:9/mcp",
        "steps": [
            {"frame": {}},
            {"events": [reach(1, True), {"type": "arc_complete", "t": 1.0, "arc": 1, "reaches": 1, "unverified": 0}]},
            {"run": {}},
        ],
        "script": {"arc_complete": [{"tool": "get_set_summary"}, {"tool": "speak", "args": {"text": "Arc done, all verified.", "cue": "instruct", "evidence": "$evidence"}}]},
        "expect": {"triggers": ["arc_complete"], "transport": "direct", "errors": ["mcp"], "actions": ["instruct"], "stopped": False},
    },
    {
        "id": "clean_session",
        "title": "Clean Waiter – cup session: check-in, two arcs, feedback note",
        "mode": "cup",
        "steps": [
            {"frame": {}},
            {"checkin": {"pain": 1}},
            {"run": {}},
            {"events": [reach(1, True), reach(2, True), reach(3, True), reach(4, True), {"type": "arc_complete", "t": 4.0, "arc": 1, "reaches": 4, "unverified": 0, "mean_reach_ms": 1100}]},
            {"run": {}},
            {"feedback": {"pain_after": 1, "effort": 3}},
            {"run": {}},
        ],
        "script": {
            "checkin": [{"tool": "get_prescription"}, {"tool": "read_patient_model"}, {"tool": "speak", "args": {"text": "Pain 1 today, so the full program: slow arcs first.", "cue": "instruct", "evidence": "$evidence"}}],
            "arc_complete": [{"tool": "get_set_summary"}, {"tool": "speak", "args": {"text": "Arc {get_set_summary.boundary.arc}: {get_set_summary.verified} of {get_set_summary.reps} verified.", "cue": "instruct", "evidence": "$evidence"}}],
            "feedback": [{"tool": "get_set_summary"}, {"tool": "write_session_summary", "args": {"note": "One slow arc, {get_set_summary.session_counts.verified} verified reaches, no setup problems.", "evidence": "$evidence"}}],
        },
        "expect": {"triggers": ["checkin", "arc_complete", "feedback"], "perceive_before": {"speak": ["get_prescription"]}, "note": True, "prompt_kinds": [], "stopped": False, "errors": []},
    },
]

for s in scenarios:
    (OUT / f"{s['id']}.json").write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n")
print(len(scenarios))
