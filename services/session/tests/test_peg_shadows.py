"""Hard peg shadows (25 Oct 2026, found by the 3-D renders): low window light.

With a low light from one side every standing peg throws a long, hard shadow across the sheet.
The change against the empty board read those shadows as something on the board; three or four
seated pegs' shadows joined into one region larger than `occluder_area_mm2`, read as a hand, and
everything touching it, the next pegs included, was blanked. nhpt3d_03 and nhpt3d_07 (both lit
`window`) stopped after 4 and 5 of 9 pegs. A shadow only darkens the paper, evenly in every
channel; outside the peg footprints that is never a peg or a hand.
"""

import cv2
import numpy as np

from praxis_session.perception.board import BoardState
from praxis_session.perception.board_spec import NHPT_BOARD
from praxis_session.perception.calibration import Calibrator
from praxis_session.perception.synth import camera_frame, project, view_camera

H = NHPT_BOARD.targets_mm
SIZE = (640, 480)
GREEN = (60, 170, 50)
TILT, YAW = 30.0, 5.0


def _frame(holes):
    pegs = [(H[k][0], H[k][1], 8.0, 32.0, 7.0) for k in holes]
    frame, _ = camera_frame(NHPT_BOARD, tilt_deg=TILT, yaw_deg=YAW, focal_per_width=0.85, pegs_3d=pegs,
                            peg_bgr=GREEN, noise_sigma=2.0, seed=3)
    if not holes:
        return frame
    # each peg's shadow: a band from the peg along +x on the sheet, and the band of a window
    # frame joining them, so together they are far larger than a hand (700 mm2)
    P = view_camera(NHPT_BOARD, SIZE, TILT, YAW, 1.0, focal_per_width=0.85)
    shade = np.zeros(frame.shape[:2], np.uint8)
    x_end = max(x for x, _ in H) + 40.0
    for k in holes:
        x, y = H[k]
        quad = [(x + 5.0, y - 3.5), (x_end, y - 3.5), (x_end, y + 3.5), (x + 5.0, y + 3.5)]
        pts = project(P, np.array([(a, b, 0.0) for a, b in quad]))
        cv2.fillPoly(shade, [np.round(pts).astype(np.int32)], 255, cv2.LINE_AA)
    ys = [y for _, y in H]
    bar = [(x_end - 8.0, min(ys) - 20.0), (x_end, min(ys) - 20.0), (x_end, max(ys) + 20.0), (x_end - 8.0, max(ys) + 20.0)]
    cv2.fillPoly(shade, [np.round(project(P, np.array([(a, b, 0.0) for a, b in bar]))).astype(np.int32)], 255, cv2.LINE_AA)
    dark = (frame.astype(np.float32) * 0.72).astype(np.uint8)
    return np.where(shade[..., None] > 0, dark, frame)


def test_long_peg_shadows_do_not_hide_the_next_pegs():
    board, cal = BoardState(NHPT_BOARD), Calibrator(NHPT_BOARD)
    empty = _frame([])
    board.detect_holes(board.warp(empty, cal.run(empty, 0.0)))
    t = 0.1
    placed: list[int] = []
    for k in [8, 1, 2, 6, 4, 0, 5, 3, 7]:
        placed.append(k)
        f = _frame(placed)
        for _ in range(board.quiet_frames + 1):
            canon = board.warp(f, cal.run(f, t))
            got = {int(h.split("_")[1]) for h, v in board.occupancy(canon).items() if v == "occupied"}
            t += 0.08
        assert got == set(placed), (k, got)
