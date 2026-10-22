"""The synthetic agent-eval harness (evaluation/scripts/agent_eval.py), 21 Oct.

1. A live browser keeps sending frames while an agent run is in flight, also while the session
   is paused, so `check_setup` and `recalibrate` see a frame well under a second old. The
   harness used to feed nothing during a run, so a pause run re-perceived a frame that was
   ~8-10 s old and `recalibrate` reported "no new frames yet" (judge review, green_cup trace).
   The harness now re-sends the current scene at 15 fps during every agent run.
2. `mixed_signals`: a set where peaks slid and the patient then leaned to get back to the line.
   Only weighing both signals passes (lean corrected and a lower target offered); the scripted
   planner runs a fixed one-signal policy and the rule coach its own, so both fail it.
"""
import asyncio
import copy
import importlib.util
import json
import sys
from pathlib import Path

from praxis_session.agent import tools as T

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "evaluation" / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _run(ag, sc, planner, tmp_path):
    return asyncio.run(ag.run_scenario(sc, planner, tmp_path, T.Registry(), None))


def _tool_rows(res, name):
    return [r for r in res["session"].trace.tail(5000) if r["kind"] == "tool" and r.get("name") == name]


def test_pause_run_perceives_a_fresh_frame_and_recalibrate_sees_new_frames(tmp_path: Path):
    ag = _load("agent_eval")
    sc = copy.deepcopy(ag.load_scenarios(["green_cup"])[0])
    # the scripted pause run, plus a recalibrate after the re-sample (what Claude did in the trace)
    pause = sc["script"]["pause"]
    pause.insert(next(i for i, st in enumerate(pause) if st["tool"] == "request_resume"), {"tool": "recalibrate"})
    res = _run(ag, sc, "scripted", tmp_path)
    checks = _tool_rows(res, "check_setup")
    assert checks and all(r["ok"] for r in checks)
    assert all(r["opencv"]["frame_age_s"] is not None and r["opencv"]["frame_age_s"] < 1.0 for r in checks), [r["opencv"]["frame_age_s"] for r in checks]
    recal = _tool_rows(res, "recalibrate")
    assert recal and recal[0]["opencv"]["frames_seen"] > 0 and "note" not in recal[0]["opencv"]
    # the scenario still passes: re-sample applied, resume prompt, verified reaches after
    assert ag.evaluate(sc, res)["success"]


def test_mixed_signals_needs_both_signals_weighed(tmp_path: Path):
    ag = _load("agent_eval")
    sc = ag.load_scenarios(["mixed_signals"])[0]
    assert sc["expect"].get("weigh_lean_and_peaks") and sc.get("judgement")
    scripted = ag.evaluate(sc, _run(ag, sc, "scripted", tmp_path / "s"))
    # a fixed one-signal policy (lean -> shorter hold) corrects the lean but keeps the 90 deg line
    assert scripted["checks"]["weigh_lean_and_peaks"] is False and not scripted["success"]
    assert scripted["capability"]["evidence_weighed"] is False and scripted["violations"] == []
    rule = ag.evaluate(sc, _run(ag, sc, "rule", tmp_path / "r"))
    assert rule["capability"]["evidence_weighed"] is False and rule["violations"] == []


def test_weigh_check_passes_lean_correction_plus_lower_target(tmp_path: Path):
    """The check itself: the same scenario with a script that weighs both signals passes."""
    ag = _load("agent_eval")
    sc = copy.deepcopy(ag.load_scenarios(["mixed_signals"])[0])
    sc["script"]["set_complete"] = [
        {"tool": "get_set_summary"},
        {"tool": "speak", "args": {"text": "Your last two lifts reached the line by leaning. Stand tall and lift from the shoulder.", "cue": "correct", "evidence": "$evidence"}},
        {"tool": "propose_adjustment", "args": {"exercise": "abduction", "field": "target_deg", "value": 80, "reason": "Peaks slid to about 80 degrees, then you leaned to reach 90.", "evidence": "$evidence"}},
    ]
    row = ag.evaluate(sc, _run(ag, sc, "scripted", tmp_path))
    assert row["checks"]["weigh_lean_and_peaks"] is True and row["success"], row["checks"]
    assert row["capability"]["evidence_weighed"] is True


def test_ablation_has_the_real_video_block(tmp_path: Path):
    """agent_ablation_v0.md carries the real-video precision rows, computed from the committed
    agent_video_v0*.json (not typed in)."""
    ag = _load("agent_eval")
    lines = ag.video_ablation_lines(ROOT / "evaluation" / "results")
    text = "\n".join(lines)
    claude = json.loads((ROOT / "evaluation" / "results" / "agent_video_v0.json").read_text())
    cp = claude["claim_precision"]
    assert f"{cp['total'] - cp['supported']}/{cp['total']}" in text
    assert "Unsupported claims" in text and "Smaller dose offered" in text
