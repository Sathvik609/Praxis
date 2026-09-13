"""Regenerate the SYNTHETIC part of dataset_v0: rendered board videos + ground-truth labels.

Synthetic clips are rendered with OpenCV 5 from the board spec (no camera). They exercise the
replay pipeline end to end and are labeled "synthetic": true everywhere. Real recordings are
added by hand to manifest.json with "synthetic": false.

    uv run python ../../evaluation/scripts/make_dataset_v0.py [--out DIR] [--hold 5] [--fps 10]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2] / "services" / "session"))
from praxis_session.perception.board_spec import BOARD, BoardSpec, render_board_image  # noqa: E402

SRC = (160.0, 148.5)
MID = (125.0, 148.5)
FRAME = (640, 480)


def perspective(spec: BoardSpec = BOARD, seed: int = 0, jitter: float = 6.0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    src = np.array([[0, 0], [spec.width_mm, 0], [spec.width_mm, spec.height_mm], [0, spec.height_mm]], np.float32)
    dst = np.array([[590, 30], [600, 455], [40, 445], [55, 40]], np.float32)
    dst += rng.uniform(-jitter, jitter, dst.shape).astype(np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def render(H: np.ndarray, pegs_mm, px_per_mm: float = 3.0, noise: float = 4.0, rng=None) -> np.ndarray:
    sheet = render_board_image(px_per_mm)
    r = int(round(4.0 * px_per_mm))
    for x, y in pegs_mm:
        cv2.circle(sheet, (int(round(x * px_per_mm)), int(round(y * px_per_mm))), r, (40, 40, 220), -1, cv2.LINE_AA)
    S = np.diag([1 / px_per_mm, 1 / px_per_mm, 1.0])
    frame = cv2.warpPerspective(sheet, H @ S, FRAME, borderMode=cv2.BORDER_CONSTANT, borderValue=(110, 110, 110))
    if noise and rng is not None:
        frame = np.clip(frame.astype(np.int16) + rng.normal(0, noise, frame.shape).astype(np.int16), 0, 255).astype(np.uint8)
    return frame


def write_clip(path: Path, order: list[int], fps: float, hold: int, seed: int, transfers: int | None = None) -> dict:
    """Peg transfers into holes in `order`. For pegboard clips with >9 transfers, pegs are
    removed again after the board fills, so the clip contains `transfers` rep_complete events."""
    rng = np.random.default_rng(seed)
    H = perspective(seed=seed)
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, FRAME)
    assert w.isOpened(), path
    i = 0
    holes = BOARD.hole_centers_mm
    seated: list[int] = []
    reps = []

    def emit(pegs, n):
        nonlocal i
        for _ in range(n):
            w.write(render(H, pegs, rng=rng))
            i += 1

    def pegs_of(seated_idx, extra=()):
        return [holes[k] for k in seated_idx] + list(extra)

    n = transfers or len(order)
    emit(pegs_of(seated, [SRC]), hold)
    for r in range(n):
        k = order[r % len(order)]
        if k in seated:  # board full: clear it in one cut (labeled as no rep)
            emit(pegs_of([], [SRC]), hold)
            seated = []
        t_lift = i / fps
        emit(pegs_of(seated), hold)
        emit(pegs_of(seated, [MID]), hold)
        t_seat = i / fps
        seated.append(k)
        emit(pegs_of(seated), hold)
        emit(pegs_of(seated, [SRC]), hold)
        reps.append({"rep": r + 1, "hole": k, "t_lift": t_lift, "t_seated": t_seat, "t_clear": i / fps})
    w.release()
    return {"fps": fps, "frames": i, "reps": reps}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE.parents[1] / "dataset_v0"))
    ap.add_argument("--fps", type=float, default=10.0)
    ap.add_argument("--hold", type=int, default=5, help="frames per phase (5 @ 10 fps = 0.5 s)")
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    entries = []
    # NHPT: nine transfers, scrambled order.
    nhpt_order = [4, 0, 8, 2, 6, 1, 7, 3, 5]
    lab = write_clip(out / "synthetic_nhpt_01.mp4", nhpt_order, args.fps, args.hold, seed=1)
    lab["nhpt"] = {
        "t_start": lab["reps"][0]["t_lift"], "t_end": lab["reps"][8]["t_seated"],
        "total_s": round(lab["reps"][8]["t_seated"] - lab["reps"][0]["t_lift"], 3),
    }
    (out / "synthetic_nhpt_01.labels.json").write_text(json.dumps(lab, indent=1))
    entries.append({"id": "synthetic_nhpt_01", "mode": "nhpt", "video": "synthetic_nhpt_01.mp4",
                    "labels": "synthetic_nhpt_01.labels.json", "synthetic": True, "participant": "render",
                    "notes": "OpenCV-rendered board, scrambled hole order, mp4v"})

    # Pegboard: 20 transfers in prescribed order 0..8, board cleared after 9 and 18.
    peg_order = list(range(9))
    lab = write_clip(out / "synthetic_pegboard_01.mp4", peg_order, args.fps, args.hold, seed=2, transfers=20)
    lab["targets"] = [peg_order[r % 9] for r in range(20)]
    (out / "synthetic_pegboard_01.labels.json").write_text(json.dumps(lab, indent=1))
    entries.append({"id": "synthetic_pegboard_01", "mode": "pegboard", "video": "synthetic_pegboard_01.mp4",
                    "labels": "synthetic_pegboard_01.labels.json", "synthetic": True, "participant": "render",
                    "targets": lab["targets"], "notes": "20 reps, holes 0-8 twice + 2, board cleared between rounds"})

    manifest_path = out / "manifest.json"
    manifest = {"version": "v0", "entries": entries}
    if manifest_path.exists():  # keep hand-added real entries
        old = json.loads(manifest_path.read_text())
        manifest["entries"] += [e for e in old.get("entries", []) if not e.get("synthetic")]
    manifest_path.write_text(json.dumps(manifest, indent=1))
    print(f"wrote {len(entries)} synthetic clips to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
