"""Generate docs/board.pdf: printable A4 calibration sheet with four ArUco markers and the 3x3
nine-hole grid, at true scale. Reproducible: geometry comes from perception/board_spec.py.

Usage: uv run python tools/make_board.py [--out ../../docs/board.pdf]
Print at 100% (no "fit to page"). Verify the 40 mm markers with a ruler.
"""
from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

import cv2
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from praxis_session.perception.board_spec import BOARD, marker_bitmap  # noqa: E402


def build(out: Path) -> None:
    spec = BOARD
    c = canvas.Canvas(str(out), pagesize=A4)
    page_h = spec.height_mm

    def y_pdf(y_mm: float) -> float:  # reportlab origin is bottom-left
        return (page_h - y_mm) * mm

    # Markers: rasterise crisply (no interpolation) and place at exact mm positions.
    for mid in spec.marker_centers_mm:
        bmp = marker_bitmap(mid, 800)
        ok, png = cv2.imencode(".png", bmp)
        assert ok
        x0, y0 = spec.marker_corners_mm(mid)[0]
        c.drawImage(
            ImageReader(io.BytesIO(png.tobytes())),
            x0 * mm, y_pdf(y0 + spec.marker_size_mm),
            spec.marker_size_mm * mm, spec.marker_size_mm * mm,
        )
        c.setFont("Helvetica", 8)
        c.drawString(x0 * mm, y_pdf(y0 - 2), f"id {mid}")

    # Hole marks.
    c.setFillColorRGB(0, 0, 0)
    for k, (hx, hy) in enumerate(spec.hole_centers_mm):
        c.circle(hx * mm, y_pdf(hy), spec.hole_diameter_mm / 2 * mm, stroke=0, fill=1)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(hx * mm, y_pdf(hy) - 2.5, str(k))
        c.setFillColorRGB(0, 0, 0)

    # Scale bar + instructions.
    c.setLineWidth(1)
    c.line(20 * mm, y_pdf(285), 120 * mm, y_pdf(285))
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, y_pdf(289), "100 mm scale bar — print at 100%, do not fit to page")
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(105 * mm, y_pdf(85), "Praxis calibration sheet + nine-hole board")
    c.setFont("Helvetica", 9)
    c.drawCentredString(105 * mm, y_pdf(91), "Markers DICT_4X4_50 ids 0–3, 40 mm. Holes 32 mm apart. Keep all four markers in view.")
    c.showPage()
    c.save()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[3] / "docs" / "board.pdf"))
    args = ap.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    build(out)
    print(f"wrote {out}")
