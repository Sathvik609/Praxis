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


# ---- US Letter (11 Oct 2026): an A4 page printed "at 100 %" on Letter loses 17.6 mm of its long
# side; depending on the viewer that clipped two corner markers (evaluation/results/robustness_v0.md).
A4 = (210.0, 297.0)
LETTER = (215.9, 279.4)


def _mediabox_mm(pdf: Path) -> tuple[float, float]:
    import re

    m = re.search(rb"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", pdf.read_bytes())
    assert m, "no MediaBox"
    return float(m.group(1)) * 25.4 / 72, float(m.group(2)) * 25.4 / 72


def test_sheet_pages_fit_both_a4_and_us_letter(tmp_path: Path):
    from praxis_session.perception.board_spec import page_mm

    for spec in (NHPT_BOARD, CUP_TARGETS):
        out = tmp_path / f"{spec.name}.pdf"
        write_pdf(spec, out)
        w, h = _mediabox_mm(out)
        pw, ph, _, _ = page_mm(spec)
        assert abs(w - pw) < 0.2 and abs(h - ph) < 0.2
        short, long_ = sorted((w, h))
        for paper in (A4, LETTER):  # fits without clipping, whichever way the viewer aligns it
            assert short <= min(paper) + 0.01 and long_ <= max(paper) + 0.01


def test_every_marker_and_its_white_margin_is_well_inside_the_printed_page():
    from praxis_session.perception.board_spec import page_mm

    for spec in (NHPT_BOARD, CUP_TARGETS):
        pw, ph, ox, oy = page_mm(spec)
        for k in spec.marker_centres_mm:
            c = spec.marker_corners_mm(k) - np.array([ox, oy], np.float32)
            lo, hi = c.min(axis=0), c.max(axis=0)
            # >= 10 mm of white paper round every marker: clear of the non-printable margin of
            # common printers (3-6.35 mm) with the quiet zone ArUco needs still on the paper
            assert lo.min() >= 10.0 and hi[0] <= pw - 10.0 and hi[1] <= ph - 10.0, (spec.name, k)
        for x, y in spec.targets_mm:
            assert 10.0 <= x - ox <= pw - 10.0 and 10.0 <= y - oy <= ph - 10.0
