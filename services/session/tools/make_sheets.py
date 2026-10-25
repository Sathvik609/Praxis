"""Write docs/sheets/*.pdf at true scale (print at 100 %, check the scale bar with a ruler).

Each page is the A4 artwork cut to what A4 and US Letter share (`board_spec.page_mm`, 11 Oct
2026), so one PDF prints on either paper without clipping a marker. The page carries the corner
names the setup hint uses ("top-left (0)") and an 80 mm scale bar: a page printed with "fit to
page" is uniformly scaled, which the camera cannot tell from distance, so the patient checks it.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import cv2
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from praxis_session.perception.board_spec import SHEETS, SheetSpec, page_mm  # noqa: E402
from praxis_session.perception.quality import corner_name  # noqa: E402
from praxis_session.perception.render import sheet_canonical  # noqa: E402

TITLES = {"nhpt_board": "Nine-Hole Peg Test board", "cup_targets": "Waiter – cup target sheet"}
GREY = 0.45
BAR_MM = 80.0


def write_pdf(spec: SheetSpec, path: Path, px_per_mm: float = 8.0) -> None:
    img = sheet_canonical(spec, px_per_mm)
    png = path.with_suffix(".png")
    cv2.imwrite(str(png), img)
    pw, ph, ox, oy = page_mm(spec)

    def at(x: float, y: float) -> tuple[float, float]:
        """sheet mm (origin top-left, y down) -> PDF points on the cut page (origin bottom-left)."""
        return (x - ox) * mm, (ph - (y - oy)) * mm

    c = canvas.Canvas(str(path), pagesize=(pw * mm, ph * mm))
    c.setTitle(f"Praxis · {TITLES.get(spec.name, spec.name)}")
    c.drawImage(str(png), -ox * mm, -oy * mm, width=spec.width_mm * mm, height=spec.height_mm * mm)
    c.setFillGray(GREY)
    c.setStrokeGray(GREY)
    half = spec.marker_size_mm / 2
    for k, (mx, my) in spec.marker_centres_mm.items():
        top = my < spec.height_mm / 2
        c.setFont("Helvetica", 8)
        c.drawCentredString(*at(mx, my + half + 4.5 if top else my - half - 2.0), f"{corner_name(spec, k)} ({k})")
    # Title and scale bar between the two top markers, clear of the targets.
    xs = sorted(x for x, y in spec.marker_centres_mm.values() if y < spec.height_mm / 2)
    y_top = min(y for _, y in spec.marker_centres_mm.values())
    cx = (xs[0] + xs[-1]) / 2
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(*at(cx, y_top - 8.0), f"Praxis · {TITLES.get(spec.name, spec.name)}")
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(*at(cx, y_top - 3.0), "Print at 100 % (actual size) on A4 or US Letter. Lay it flat.")
    x0, yb = cx - BAR_MM / 2, y_top + 6.0
    c.setLineWidth(0.8)
    c.line(*at(x0, yb), *at(x0 + BAR_MM, yb))
    for i in range(int(BAR_MM / 10) + 1):
        tick = 2.5 if i % 4 else 4.0
        c.line(*at(x0 + 10 * i, yb - tick / 2), *at(x0 + 10 * i, yb + tick / 2))
    c.drawCentredString(*at(cx, yb + 6.0), f"This bar must measure {BAR_MM:.0f} mm; each marker {spec.marker_size_mm:.0f} mm.")
    c.showPage()
    c.save()
    png.unlink()


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[3] / "docs" / "sheets"
    out.mkdir(parents=True, exist_ok=True)
    # The web app serves a copy so a judge can print a sheet from the exercise card.
    web = Path(__file__).resolve().parents[3] / "web" / "public" / "sheets"
    web.mkdir(parents=True, exist_ok=True)
    for spec in SHEETS.values():
        write_pdf(spec, out / f"{spec.name}.pdf")
        shutil.copyfile(out / f"{spec.name}.pdf", web / f"{spec.name}.pdf")
        print("wrote", out / f"{spec.name}.pdf", "and the web copy")
