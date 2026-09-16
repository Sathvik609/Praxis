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
