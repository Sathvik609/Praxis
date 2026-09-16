import numpy as np

from praxis_session.perception.board_spec import CUP_TARGETS, NHPT_BOARD, SHEETS


def test_nhpt_has_four_markers_and_nine_holes_at_32mm_pitch():
    assert set(NHPT_BOARD.marker_centres_mm) == {0, 1, 2, 3}
    assert len(NHPT_BOARD.targets_mm) == 9
    xs = sorted({round(x, 3) for x, _ in NHPT_BOARD.targets_mm})
    ys = sorted({round(y, 3) for _, y in NHPT_BOARD.targets_mm})
    assert np.allclose(np.diff(xs), 32) and np.allclose(np.diff(ys), 32)
    assert NHPT_BOARD.target_kind == "hole"


def test_cup_targets_five_dots_on_an_arc_inside_sheet():
    assert len(CUP_TARGETS.targets_mm) == 5
    w, h = CUP_TARGETS.width_mm, CUP_TARGETS.height_mm
    for x, y in CUP_TARGETS.targets_mm:
        assert 20 < x < w - 20 and 20 < y < h - 20
    xs = [x for x, _ in CUP_TARGETS.targets_mm]
    assert xs == sorted(xs)
    ys = [y for _, y in CUP_TARGETS.targets_mm]
    assert ys[0] > ys[2] and ys[4] > ys[2]  # arc bows toward the top


def test_marker_corners_are_tl_tr_br_bl():
    c = NHPT_BOARD.marker_corners_mm(0)
    cx, cy = NHPT_BOARD.marker_centres_mm[0]
    s = NHPT_BOARD.marker_size_mm / 2
    assert np.allclose(c, [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]])


def test_markers_do_not_overlap_targets():
    for spec in SHEETS.values():
        for mid in spec.marker_centres_mm:
            mc = np.array(spec.marker_centres_mm[mid])
            for t in spec.targets_mm:
                assert np.linalg.norm(mc - t) > spec.marker_size_mm / 2 + spec.target_radius_mm + 5
