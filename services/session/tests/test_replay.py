import json
from pathlib import Path

from praxis_session.perception.synth import write_nhpt_clip
from praxis_session.replay import main, run_replay, write_events_jsonl

ORDER = [4, 0, 8, 2, 6, 1, 7, 3, 5]


def test_write_clip_returns_labels(tmp_path: Path):
    lab = write_nhpt_clip(tmp_path / "c.mp4", ORDER, fps=10, hold=3, seed=1)
    assert (tmp_path / "c.mp4").stat().st_size > 1000
    assert len(lab["reps"]) == 9 and [r["hole"] for r in lab["reps"]] == ORDER
    assert lab["nhpt"]["total_s"] > 0 and lab["fps"] == 10


def test_replay_matches_labels_within_half_second(tmp_path: Path):
    lab = write_nhpt_clip(tmp_path / "c.mp4", ORDER, fps=10, hold=3, seed=1)
    res = run_replay(tmp_path / "c.mp4", mode="nhpt", debounce_frames=1, clear_frames=1)
    assert res.frames == lab["frames"] and res.fps == 10
    assert res.reps == 9 and res.nhpt_total_s is not None
    assert abs(res.nhpt_total_s - lab["nhpt"]["total_s"]) < 0.5
    assert res.summary()["event_counts"]["rep_complete"] == 9


def test_cli_writes_events_jsonl(tmp_path: Path, capsys):
    write_nhpt_clip(tmp_path / "c.mp4", ORDER, fps=10, hold=3, seed=2)
    out = tmp_path / "ev.jsonl"
    rc = main([str(tmp_path / "c.mp4"), "--mode", "nhpt", "--events-out", str(out), "--quiet"])
    assert rc == 0
    lines = out.read_text().splitlines()
    assert any(json.loads(line)["type"] == "nhpt_complete" for line in lines)
    assert "nhpt_total_s" in capsys.readouterr().out


def test_missing_file_raises(tmp_path: Path):
    import pytest

    with pytest.raises(FileNotFoundError):
        run_replay(tmp_path / "nope.mp4")
    write_events_jsonl([], tmp_path / "x" / "e.jsonl")
    assert (tmp_path / "x" / "e.jsonl").exists()


def test_cup_clip_replays_four_arcs(tmp_path: Path):
    from praxis_session.perception.synth import write_cup_clip

    lab = write_cup_clip(tmp_path / "cup.mp4", fps=10, hold=2, seed=3)
    assert len(lab["reaches"]) == 32 and lab["phases"] == ["slow", "slow", "fast", "fast"]
    res = run_replay(tmp_path / "cup.mp4", mode="cup", sheet="cup_targets", clear_frames=1)
    counts = res.summary()["event_counts"]
    assert counts["reach_complete"] == 32 and counts["arc_complete"] == 4
    assert res.snapshot["cup"]["finished"]


def test_arm_landmark_replay(tmp_path: Path):
    from praxis_session.perception.synth import write_arm_landmarks
    from praxis_session.replay import run_landmark_replay

    lab = write_arm_landmarks(tmp_path / "arm.jsonl", sets=1, reps=3, hold_s=1.2, fps=15, seed=1)
    assert len(lab["reps"]) == 3
    res = run_landmark_replay(tmp_path / "arm.jsonl", side="left", hold_s=1.0, sets=1, reps=3)
    counts = res.summary()["event_counts"]
    assert counts["rep_complete"] == 3 and res.snapshot["arm"]["finished"]
