"""evaluation/scripts/team_test_report.py: the committed team-test report regenerates byte-identically
from the pseudonymised snapshot, and the snapshot carries no names or pixels."""

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "evaluation" / "scripts" / "team_test_report.py"
DATA = ROOT / "evaluation" / "data" / "team_test_2026-10-21"


def _load():
    spec = importlib.util.spec_from_file_location("team_test_report", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["team_test_report"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_report_regenerates_identically():
    assert _load().main(["--check"]) == 0


def test_headline_numbers_split_human_and_automated():
    r = _load().build()
    arm = r["by_exercise"]["Arm out to the side"]
    assert r["groups"]["human"]["sessions"] + r["groups"]["automated"]["sessions"] == 15
    assert (arm["all"]["setup_blocked_events"], arm["all"]["sessions_with_setup_blocked"]) == (14, 9)
    assert (arm["all"]["hike_events"], arm["all"]["sessions_with_hike"]) == (31, 5)
    assert arm["all"]["hike_cues_21oct"] == 14  # 3dd3c56: 31 -> 14 on the same events
    assert (arm["human"]["verified"], arm["human"]["reps"]) == (23, 37)
    tr = r["agent"]["traces"]
    assert len(tr["refused_by_guardrail"]) == 3 and tr["failed"] == []


def test_snapshot_is_pseudonymised_and_has_no_pixels():
    testers = set()
    for p in sorted(DATA.rglob("*.json")):
        text = p.read_text()
        assert "data:image" not in text and "/9j/" not in text
        if p.parent.name == "sessions":
            testers.add(json.loads(text)["username"])
    assert testers <= {"T1", "T2", "T3", "test-claude"}
