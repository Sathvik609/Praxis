from pathlib import Path

import cv2
import numpy as np

from praxis_session.perception.board_spec import CUP_TARGETS, NHPT_BOARD
from praxis_session.perception.render import marker_image, sheet_canonical
from tools.make_sheets import write_pdf


def test_marker_image_is_square_binary():
    m = marker_image(0, 200)
    assert m.shape == (200, 200) and set(np.unique(m)) <= {0, 255}


def test_canonical_sheet_markers_detectable():
    img = sheet_canonical(NHPT_BOARD, px_per_mm=3.0)
    det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50))
    _, ids, _ = det.detectMarkers(img)
    assert ids is not None and sorted(ids.ravel().tolist()) == [0, 1, 2, 3]


def test_write_pdf_creates_file(tmp_path: Path):
    out = tmp_path / "x.pdf"
    write_pdf(CUP_TARGETS, out)
    assert out.exists() and out.stat().st_size > 1000
