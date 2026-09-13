"""Replay mode: a recorded MP4 goes through the identical pipeline; timing comes from the file fps."""
from __future__ import annotations

import json
from pathlib import Path

import cv2

from praxis_session.perception.board_spec import BOARD
from praxis_session.replay import run_replay, write_events_jsonl
from tests.synth import perspective_from_mm, render_frame

H = perspective_from_mm()
SRC = (160.0, 148.5)
HOLES = BOARD.hole_centers_mm


def write_nhpt_video(path: Path, fps: float = 10.0, hold: int = 5) -> dict:
    """9 transfers; each phase held for `hold` frames. Returns the ground-truth labels."""
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (640, 480))
    assert w.isOpened()
    i = 0
    labels = {"reps": [], "nhpt": {}}
    seated: list[tuple[float, float]] = []

    def emit(frame, n):
        nonlocal i
        for _ in range(n):
            w.write(frame)
            i += 1

    emit(render_frame(H, pegs_mm=[SRC]), hold)
    for k in range(9):
        lift_t = i / fps
        emit(render_frame(H, pegs_mm=seated), hold)                          # lifted
        emit(render_frame(H, pegs_mm=seated + [(125.0, 148.5)]), hold)      # mid-air
        seat_t = i / fps
        seated.append(HOLES[k])
        emit(render_frame(H, pegs_mm=seated), hold)                          # seated
        emit(render_frame(H, pegs_mm=seated + [SRC]), hold)                  # hand clear, next peg
        labels["reps"].append({"hole": k, "t_lift": lift_t, "t_seated": seat_t})
        if k == 0:
            labels["nhpt"]["t_start"] = lift_t
        if k == 8:
            labels["nhpt"]["t_end"] = seat_t
    w.release()
    labels["nhpt"]["total_s"] = labels["nhpt"]["t_end"] - labels["nhpt"]["t_start"]
    labels["fps"] = fps
    labels["frames"] = i
    return labels


def test_replay_nhpt_total_matches_label_within_half_second(tmp_path: Path) -> None:
    video = tmp_path / "nhpt.mp4"
    labels = write_nhpt_video(video)
    result = run_replay(video, mode="nhpt", debounce_frames=1, clear_frames=1)
    assert result.frames == labels["frames"]
    assert result.nhpt_total_s is not None
    assert abs(result.nhpt_total_s - labels["nhpt"]["total_s"]) <= 0.5
    assert result.reps == 9


def test_replay_pegboard_counts_labeled_reps(tmp_path: Path) -> None:
    video = tmp_path / "peg.mp4"
    labels = write_nhpt_video(video)
    result = run_replay(video, mode="pegboard", targets=list(range(9)), debounce_frames=1, clear_frames=1)
    assert result.reps == len(labels["reps"])
    rep_times = [e.t for e in result.events if e.type == "rep_complete"]
    assert len(rep_times) == 9
    for lab, t in zip(labels["reps"], rep_times):
        assert 0 <= t - lab["t_seated"] <= 1.0  # rep_complete fires after hand clear


def test_events_jsonl_roundtrip(tmp_path: Path) -> None:
    video = tmp_path / "peg.mp4"
    write_nhpt_video(video, hold=2)
    result = run_replay(video, mode="nhpt", debounce_frames=1, clear_frames=1)
    out = tmp_path / "events.jsonl"
    write_events_jsonl(result.events, out)
    lines = out.read_text().splitlines()
    assert len(lines) == len(result.events)
    assert json.loads(lines[0])["type"] in ("calibration", "frame")


def test_replay_missing_file_raises(tmp_path: Path) -> None:
    import pytest

    with pytest.raises(FileNotFoundError):
        run_replay(tmp_path / "nope.mp4", mode="nhpt")
