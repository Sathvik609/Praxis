import numpy as np
import pytest

from praxis_session.perception.board_spec import CUP_TARGETS, NHPT_BOARD
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.synth import camera_frame


@pytest.mark.parametrize("spec", [NHPT_BOARD, CUP_TARGETS])
def test_calibrates_on_synthetic_frame_with_submm_error(spec):
    frame, _ = camera_frame(spec, tilt_deg=20, yaw_deg=8, noise_sigma=3.0)
    res = Calibrator(spec).run(frame)
    assert res.calibrated and res.missing == []
    assert res.rms_mm is not None and res.rms_mm < 1.0
    targets = np.array(spec.targets_mm, np.float32)
    px = res.to_px(targets)
    back = res.to_mm(px)
    assert np.allclose(back, targets, atol=0.5)


def test_synthetic_targets_land_where_the_true_homography_says():
    frame, H_true = camera_frame(NHPT_BOARD, tilt_deg=20, yaw_deg=8)
    res = Calibrator(NHPT_BOARD).run(frame)
    targets = np.array(NHPT_BOARD.targets_mm, np.float32).reshape(-1, 1, 2)
    import cv2

    truth = cv2.perspectiveTransform(targets, H_true.astype(np.float32)).reshape(-1, 2)
    assert np.allclose(res.to_px(targets.reshape(-1, 2)), truth, atol=1.5)


def test_refuses_when_a_marker_is_hidden():
    frame, _ = camera_frame(NHPT_BOARD, hide_marker=2)
    res = Calibrator(NHPT_BOARD).run(frame)
    assert not res.calibrated and res.missing == [2] and res.H_px_to_mm is None


def test_blank_frame_reports_all_missing():
    res = Calibrator(NHPT_BOARD).run(np.zeros((480, 640, 3), np.uint8))
    assert res.missing == [0, 1, 2, 3]
    d = res.to_dict()
    assert d["calibrated"] is False and d["sheet"] == "nhpt_board"


# ---- Hold through brief marker loss, three-marker fallback ----------------


def hide_markers(frame, H_true, spec, ids):
    """Paint the given markers white in a rendered frame (occlusion without touching synth)."""
    import cv2

    out = frame.copy()
    for k in ids:
        corners = spec.marker_corners_mm(k).reshape(-1, 1, 2).astype(np.float32)
        px = cv2.perspectiveTransform(corners, H_true.astype(np.float32)).reshape(-1, 2)
        centre = px.mean(axis=0)
        px = centre + (px - centre) * 1.3  # cover the quiet zone too
        cv2.fillPoly(out, [np.round(px).astype(np.int32)], (255, 255, 255))
    return out


def test_fresh_result_reports_source_and_age():
    frame, _ = camera_frame(NHPT_BOARD)
    res = Calibrator(NHPT_BOARD).run(frame, t=10.0)
    assert res.calibrated and res.source == "fresh" and res.age_s == 0.0
    d = res.to_dict()
    assert d["source"] == "fresh" and d["age_s"] == 0.0


def test_three_markers_give_a_partial_homography_after_a_fresh_one():
    frame, H = camera_frame(NHPT_BOARD, tilt_deg=20, yaw_deg=8)
    cal = Calibrator(NHPT_BOARD)
    assert cal.run(frame, t=0.0).source == "fresh"
    partial = hide_markers(frame, H, NHPT_BOARD, [1])
    for i in range(1, 40):  # well past the hold window: partial does not expire
        res = cal.run(partial, t=i * 0.1)
        assert res.calibrated and res.source == "partial" and res.missing == [1]
    targets = np.array(NHPT_BOARD.targets_mm, np.float32)
    assert np.allclose(res.to_mm(res.to_px(targets)), targets, atol=0.5)
    assert res.rms_mm is not None and res.rms_mm < 1.5


def test_three_markers_never_calibrate_without_a_prior_four_marker_frame():
    frame, H = camera_frame(NHPT_BOARD)
    partial = hide_markers(frame, H, NHPT_BOARD, [1])
    cal = Calibrator(NHPT_BOARD)
    for i in range(10):
        res = cal.run(partial, t=i * 0.1)
        assert not res.calibrated and res.missing == [1] and res.source is None


def test_markers_that_have_not_moved_keep_the_fix_through_a_long_occlusion():
    """24 Oct (team test: 19 tracking-lost pauses in one NHPT session, the cup on dot 1 or 5 hiding
    a top corner): one or two markers still in view, where the last fix says they are, prove the
    sheet has not moved, so the fix holds however long the hand or cup covers the others."""
    frame, H = camera_frame(NHPT_BOARD)
    cal = Calibrator(NHPT_BOARD)
    fresh = cal.run(frame, t=0.0)
    for hidden in ([1, 2], [0, 1, 2]):
        bad = hide_markers(frame, H, NHPT_BOARD, hidden)
        for i in range(1, 60):
            res = cal.run(bad, t=i * 0.1)
            assert res.calibrated and res.source == "held", (hidden, i)
            assert res.missing == hidden
            assert np.allclose(res.H_px_to_mm, fresh.H_px_to_mm)


def test_with_every_marker_covered_the_fix_holds_1_5_s_then_is_lost():
    frame, H = camera_frame(NHPT_BOARD)
    cal = Calibrator(NHPT_BOARD)
    fresh = cal.run(frame, t=0.0)
    bad = hide_markers(frame, H, NHPT_BOARD, [0, 1, 2, 3])
    held_ages = []
    for i in range(1, 30):
        t = i * 0.1
        res = cal.run(bad, t=t)
        if t <= 1.5 + 1e-9:
            assert res.calibrated and res.source == "held", t
            assert np.allclose(res.H_px_to_mm, fresh.H_px_to_mm)
            held_ages.append(res.age_s)
        else:
            assert not res.calibrated and res.source is None, t
    assert held_ages and abs(held_ages[-1] - 1.5) < 1e-6
    # a fresh frame resets the hold
    assert cal.run(frame, t=5.0).source == "fresh"
    assert cal.run(bad, t=5.5).source == "held"


def test_two_markers_refit_the_sheet_after_it_moved():
    frame, _ = camera_frame(NHPT_BOARD)
    cal = Calibrator(NHPT_BOARD)
    cal.run(frame, t=0.0)
    moved, H2 = camera_frame(NHPT_BOARD, tilt_deg=22.0, yaw_deg=-4.0, scale=0.92)
    res = cal.run(hide_markers(moved, H2, NHPT_BOARD, [1, 2]), t=3.0)
    assert res.calibrated and res.source == "partial" and res.missing == [1, 2]
    pts = np.array(NHPT_BOARD.targets_mm, np.float32)
    import cv2

    truth = cv2.perspectiveTransform(pts.reshape(-1, 1, 2), H2.astype(np.float64)).reshape(-1, 2)
    assert np.abs(res.to_px(pts) - truth).max() < 2.5  # the new pose (old one is far off), ~0.6 mm


def test_one_marker_that_moved_does_not_hold_the_old_fix():
    frame, _ = camera_frame(NHPT_BOARD)
    cal = Calibrator(NHPT_BOARD)
    cal.run(frame, t=0.0)
    moved, H2 = camera_frame(NHPT_BOARD, tilt_deg=25.0, yaw_deg=-6.0, scale=0.9)
    res = cal.run(hide_markers(moved, H2, NHPT_BOARD, [1, 2, 3]), t=3.0)
    assert not res.calibrated


# ---- Camera tilt from ArUco pose (cv2.solvePnP) -------------------------


@pytest.mark.parametrize("spec", [NHPT_BOARD, CUP_TARGETS])
@pytest.mark.parametrize("tilt,yaw", [(0, 0), (15, 5), (20, 8), (40, 5), (50, 0)])
def test_tilt_deg_matches_the_rendered_camera_angle(spec, tilt, yaw):
    import math

    frame, _ = camera_frame(spec, tilt_deg=tilt, yaw_deg=yaw, noise_sigma=3.0)
    res = Calibrator(spec).run(frame, t=0.0)
    # angle between the optical axis and the sheet normal for R = Ry(yaw) @ Rx(tilt)
    truth = math.degrees(math.acos(math.cos(math.radians(tilt)) * math.cos(math.radians(yaw))))
    assert res.tilt_deg is not None and abs(res.tilt_deg - truth) < 2.0
    assert res.to_dict()["tilt_deg"] == round(res.tilt_deg, 1)


def test_tilt_is_none_when_uncalibrated_and_carried_while_held():
    assert Calibrator(NHPT_BOARD).run(np.zeros((480, 640, 3), np.uint8)).tilt_deg is None
    frame, H = camera_frame(NHPT_BOARD, tilt_deg=20, yaw_deg=8)
    cal = Calibrator(NHPT_BOARD)
    fresh = cal.run(frame, t=0.0)
    held = cal.run(hide_markers(frame, H, NHPT_BOARD, [0, 3]), t=0.5)
    assert held.source == "held" and held.tilt_deg == fresh.tilt_deg
    partial = cal.run(hide_markers(frame, H, NHPT_BOARD, [3]), t=1.0)
    assert partial.source == "partial" and abs(partial.tilt_deg - fresh.tilt_deg) < 2.0


def test_held_result_validates_against_the_event_schema():
    from praxis_session.events import make_event
    from praxis_session.schema import validate_event

    frame, H = camera_frame(NHPT_BOARD)
    cal = Calibrator(NHPT_BOARD)
    cal.run(frame, t=0.0)
    res = cal.run(hide_markers(frame, H, NHPT_BOARD, [0, 3]), t=0.5)
    validate_event(make_event("calibration", t=0.5, **res.to_dict()).to_dict())
