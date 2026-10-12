"""evaluation/scripts/agent_video_eval.py: the scoring rules on tiny inputs (no dataset, no
model). The real-video run itself needs REHAB24-6 (git-ignored) and is not part of CI."""
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


def _load():
    spec = importlib.util.spec_from_file_location("agent_video_eval", ROOT / "evaluation" / "scripts" / "agent_video_eval.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["agent_video_eval"] = mod
    spec.loader.exec_module(mod)
    return mod


V = _load()


def test_claim_classes_read_what_the_coach_said():
    assert V.claims_in("Keep the arm at shoulder height and hold for three seconds.") == {"overshoot", "hold"}
    assert V.claims_in("Let the shoulder drop; lift from the arm, not the shoulder.") == {"hike"}
    assert V.claims_in("Nearly, a touch higher, up to the line.") == {"short"}
    # "no higher" is the overshoot fix, not a short-of-target claim
    assert V.claims_in("Go no higher than shoulder level.") == {"overshoot"}
    assert V.claims_in("Keep your elbow straight and the arm out to the side, not forward.") == {"elbow", "forward"}
    assert V.claims_in("You leaned to the left.") == {"lean"}
    assert V.claims_in("") == set()
    # 12 Oct, read off the first real run: these are not "fell short of the target" claims
    assert "short" not in V.claims_in("Your holds came up a little short of 3 seconds.")
    assert "short" not in V.claims_in("Stop at shoulder height. No need to go higher.")
    assert "short" not in V.claims_in("Don't go higher than the line, and hold steady.")
    assert "short" not in V.claims_in("You're lifting higher than needed.")
    assert "short" in V.claims_in("Your arm stopped short of the line; reach a little higher next time.")


def _rep(**kw):
    base = {"correct": True, "peak_deg": 120.0, "hold_s": 0.5, "rise": 0.12, "lean_change_deg": 2.0, "elbow_deg": 170.0, "plane_deg": 10.0}
    return base | kw


def test_set_truth_is_a_majority_over_the_matched_reps():
    t = V.set_truth([_rep(), _rep(), _rep(peak_deg=80.0, correct=False)])
    assert t["labelled_reps"] == 3 and t["physio_incorrect"] == 1
    assert t["overshoot"] and t["hold"] and t["hike"] and not t["short"] and not t["lean"]
    assert not t["elbow"] and not t["forward"]
    t = V.set_truth([_rep(peak_deg=80.0, hold_s=4.0, rise=0.01, elbow_deg=120.0, plane_deg=40.0)] * 2)
    assert t["short"] and not t["overshoot"] and not t["hold"] and not t["hike"] and t["elbow"] and t["forward"]
    assert V.set_truth([])["labelled_reps"] == 0


def test_eval_prescription_is_the_seed_with_five_rep_sets_for_the_right_arm():
    rx = V.EVAL_RX
    assert rx.side == "right" and rx.exercises["abduction"]["reps"] == 5 and rx.exercises["abduction"]["sets"] == 2
    assert rx.exercises["abduction"]["target_deg"] == 90.0 and rx.exercises["abduction"]["ceiling_deg"] == 90.0
    assert rx.allowed_adaptations["abduction"]["target_deg"] == [60.0, 90.0]
    from praxis_session.prescription import SEED_PRESCRIPTION

    assert SEED_PRESCRIPTION.exercises["abduction"]["reps"] == 8  # the shipped prescription is untouched


def test_result_stems_and_action_summary():
    from praxis_session.agent.model import DEFAULT_MODEL

    assert V.stem_for("anthropic", DEFAULT_MODEL) == "agent_video_v0"
    assert V.stem_for("anthropic", "claude-haiku-5-5") == "agent_video_v0_haiku-5-5"
    assert V.stem_for("rule", None) == "agent_video_v0_rule"
    assert V._acts(["correct", "regress"]) == "correct, regress"
    assert V._acts(["correct"] * 4 + ["instruct"] * 2) == "correct ×4, instruct ×2"


@pytest.mark.skipif(not (V.R.DATA_DIR / "Segmentation.csv").exists(), reason="REHAB24-6 not downloaded (tools/fetch_rehab24.py)")
def test_cases_cover_review_real_setup_and_induced():
    cases = V.build_cases()
    kinds = [c["kind"] for c in cases]
    assert kinds.count("review") == 9 and kinds.count("setup_real") == 8 and kinds.count("setup_induced") == 3
    turns = [c for c in cases if c["kind"] == "review" and c["turn_at_s"]]
    assert len(turns) == 5  # five recordings turn to half-profile after the front block
