"""Regenerate the SYNTHETIC part of dataset_v0: an OpenCV-rendered NHPT clip + labels.

    uv run python ../../evaluation/scripts/make_dataset_v0.py [--out DIR] [--hold 5] [--fps 10]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2] / "services" / "session"))
from praxis_session.perception.synth import write_cup_clip, write_nhpt_clip  # noqa: E402

NHPT_ORDER = [4, 0, 8, 2, 6, 1, 7, 3, 5]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE.parents[1] / "dataset_v0"))
    ap.add_argument("--fps", type=float, default=10.0)
    ap.add_argument("--hold", type=int, default=5, help="frames per phase (5 @ 10 fps = 0.5 s)")
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    lab = write_nhpt_clip(out / "synthetic_nhpt_01.mp4", NHPT_ORDER, args.fps, args.hold, seed=1)
    (out / "synthetic_nhpt_01.labels.json").write_text(json.dumps(lab, indent=1))
    entries = [
        {
            "id": "synthetic_nhpt_01",
            "mode": "nhpt",
            "sheet": "nhpt_board",
            "video": "synthetic_nhpt_01.mp4",
            "labels": "synthetic_nhpt_01.labels.json",
            "synthetic": True,
            "participant": "render",
            "notes": "OpenCV-rendered NHPT sheet, scrambled hole order, perspective + noise, mp4v",
        }
    ]
    cup = write_cup_clip(out / "synthetic_cup_01.mp4", args.fps, args.hold, seed=3)
    (out / "synthetic_cup_01.labels.json").write_text(json.dumps(cup, indent=1))
    entries.append(
        {
            "id": "synthetic_cup_01",
            "mode": "cup",
            "sheet": "cup_targets",
            "video": "synthetic_cup_01.mp4",
            "labels": "synthetic_cup_01.labels.json",
            "synthetic": True,
            "participant": "render",
            "notes": "OpenCV-rendered cup target sheet, blue cup base, 2 slow + 2 fast arcs, mp4v",
        }
    )
    manifest_path = out / "manifest.json"
    manifest = {"version": "v0", "entries": entries}
    if manifest_path.exists():  # keep hand-added real entries
        old = json.loads(manifest_path.read_text())
        manifest["entries"] += [e for e in old.get("entries", []) if not e.get("synthetic")]
    manifest_path.write_text(json.dumps(manifest, indent=1))
    print(f"wrote synthetic clip + labels to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
