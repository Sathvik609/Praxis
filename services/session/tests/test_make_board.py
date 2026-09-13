from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_make_board_writes_pdf(tmp_path: Path) -> None:
    out = tmp_path / "board.pdf"
    subprocess.run(
        [sys.executable, "tools/make_board.py", "--out", str(out)],
        check=True, cwd=Path(__file__).resolve().parents[1],
    )
    data = out.read_bytes()
    assert data[:5] == b"%PDF-"
    assert len(data) > 5_000
