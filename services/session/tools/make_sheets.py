"""Write docs/sheets/*.pdf at true scale (print at 100 %, check marker size with a ruler)."""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from praxis_session.perception.board_spec import SHEETS, SheetSpec  # noqa: E402
from praxis_session.perception.render import sheet_canonical  # noqa: E402


def write_pdf(spec: SheetSpec, path: Path, px_per_mm: float = 8.0) -> None:
    img = sheet_canonical(spec, px_per_mm)
    png = path.with_suffix(".png")
    cv2.imwrite(str(png), img)
    c = canvas.Canvas(str(path), pagesize=(spec.width_mm * mm, spec.height_mm * mm))
    c.drawImage(str(png), 0, 0, width=spec.width_mm * mm, height=spec.height_mm * mm)
    c.setFont("Helvetica", 8)
    c.drawString(
        5 * mm,
        5 * mm,
        f"Praxis {spec.name} · print at 100% · markers {spec.marker_size_mm:.0f} mm "
        f"· check with a ruler",
    )
    c.showPage()
    c.save()
    png.unlink()


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[3] / "docs" / "sheets"
    out.mkdir(parents=True, exist_ok=True)
    for spec in SHEETS.values():
        write_pdf(spec, out / f"{spec.name}.pdf")
        print("wrote", out / f"{spec.name}.pdf")
