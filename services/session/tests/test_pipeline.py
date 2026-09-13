"""Per-frame pipeline: calibration -> board state -> FSM/NHPT -> timestamped events + overlay."""
from __future__ import annotations

import numpy as np

from praxis_session.events import EventRing
from praxis_session.perception.board_spec import BOARD
from praxis_session.pipeline import SessionPipeline
from tests.synth import perspective_from_mm, render_frame

H = perspective_from_mm()
SRC = (160.0, 148.5)
HOLES = BOARD.hole_centers_mm


def frames_for_transfer(hole: int, seated: list[int]):
    """Synthetic frame script: peg at source -> lifted (invisible) -> mid-air -> seated -> clear."""
    done = [HOLES[k] for k in seated]
    yield render_frame(H, pegs_mm=done + [SRC])
    yield render_frame(H, pegs_mm=done)
    yield render_frame(H, pegs_mm=done + [(125.0, 148.5)])
    yield render_frame(H, pegs_mm=done + [HOLES[hole]])
    yield render_frame(H, pegs_mm=done + [HOLES[hole]])
    yield render_frame(H, pegs_mm=done + [HOLES[hole], SRC])


def test_pegboard_pipeline_counts_a_rep_from_rendered_frames() -> None:
    ring = EventRing()
    p = SessionPipeline(mode="pegboard", targets=[4, 0], ring=ring, debounce_frames=1, clear_frames=1)
    t = 0.0
    events = []
    for f in frames_for_transfer(4, []):
        events += p.process(f, t)
        t += 0.1
    types = [e.type for e in events]
    assert "calibration" in types
    assert "rep_complete" in types
    assert p.snapshot()["reps"] == 1
    assert p.snapshot()["target"] == 0
    assert len(ring) == len(events)


def test_frame_event_carries_overlay_geometry_in_frame_pixels() -> None:
    p = SessionPipeline(mode="pegboard", targets=[4], debounce_frames=1, clear_frames=1)
    ev = p.process(render_frame(H, pegs_mm=[SRC]), 0.0)
    frame_ev = next(e for e in ev if e.type == "frame")
    ov = frame_ev.payload["overlay"]
    assert len(ov["holes_px"]) == 9
    assert ov["target"] == 4
    assert all(0 <= x < 640 and 0 <= y < 480 for x, y, _r in ov["holes_px"])
    assert len(ov["markers_px"]) == 4
    assert frame_ev.payload["calibrated"] is True
    assert frame_ev.payload["fsm"]["state"] == "at_source"
    assert frame_ev.payload["occupancy"]["hole_4"] == "empty"


def test_perception_loss_pauses_and_regains() -> None:
    p = SessionPipeline(mode="pegboard", targets=[4], lost_after_frames=2, debounce_frames=1, clear_frames=1)
    p.process(render_frame(H, pegs_mm=[SRC]), 0.0)
    blank = np.full((480, 640, 3), 110, np.uint8)
    ev = p.process(blank, 0.1) + p.process(blank, 0.2)
    assert [e.type for e in ev if e.type == "perception_lost"] == ["perception_lost"]
    lost = next(e for e in ev if e.type == "perception_lost")
    assert lost.payload["missing_ids"] == [0, 1, 2, 3]
    assert p.snapshot()["paused"] is True
    # While paused the FSM must not advance even if occupancy looks like a seat.
    ev = p.process(blank, 0.3)
    assert not any(e.type == "state_change" for e in ev)
    ev = p.process(render_frame(H, pegs_mm=[SRC]), 0.4)
    assert any(e.type == "perception_regained" for e in ev)
    assert p.snapshot()["paused"] is False


def test_nhpt_pipeline_reports_total_time() -> None:
    p = SessionPipeline(mode="nhpt", debounce_frames=1, clear_frames=1)
    t = 0.0
    events = []
    seated: list[int] = []
    for k in range(9):
        for f in frames_for_transfer(k, seated):
            events += p.process(f, t)
            t += 0.1
        seated.append(k)
    done = next(e for e in events if e.type == "nhpt_complete")
    # Lift of peg 1 at t=0.1; ninth seat at frame index 8*6+3 -> t=5.1. Total 5.0 s.
    assert abs(done.payload["total_s"] - 5.0) < 1e-6
    assert p.snapshot()["nhpt"]["completed"] is True


def test_calibrate_mode_only_reports_calibration() -> None:
    p = SessionPipeline(mode="calibrate")
    ev = p.process(render_frame(H), 0.0)
    assert {e.type for e in ev} == {"calibration", "frame"}
    assert p.snapshot()["fsm"] is None
