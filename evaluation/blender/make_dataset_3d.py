"""Build evaluation/dataset_3d_v0: physically based 3-D renders of the NHPT and Waiter – cup.

**Synthetic 3-D renders, not real-camera evidence.**

    cd services/session
    uv run python ../../evaluation/blender/make_dataset_3d.py            # all clips (~15-25 min)
    uv run python ../../evaluation/blender/make_dataset_3d.py --only nhpt3d_01 --still 120
    uv run python ../../evaluation/scripts/eval_3d.py                     # score them

Per clip (`scenario.default_conditions`): `scenario` scripts the run and its ground truth;
Blender (`render_tasks.py`, Eevee, 640x480, motion blur) renders it from the sheet texture made
by the product's own `perception/render.sheet_canonical`, cut to the printed page exactly like
`tools/make_sheets.py` (corner names and title in the same places); this script then adds sensor
noise and writes every frame as a **JPEG at quality 70** (what the browser sends) into an MJPG
.avi, which `praxis_session.replay.run_replay` reads like any clip.

Outputs in evaluation/dataset_3d_v0/: manifest.json, <id>.labels.json (praxis.labels/1),
<id>.truth.json (condition, splits, marker visibility) — committed; <id>.avi and work/ —
git-ignored (regenerable, deterministic per seed). OpenCV 5 (cv2.__version__ noted in the manifest).
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "services" / "session"))
sys.path.insert(0, str(HERE.parent))

from praxis_session.perception.board_spec import SHEETS, SheetSpec, page_mm  # noqa: E402
from praxis_session.perception.quality import corner_name  # noqa: E402
from praxis_session.perception.render import sheet_canonical  # noqa: E402

import scenario  # noqa: E402

BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
DEFAULT_OUT = ROOT / "evaluation" / "dataset_3d_v0"
TEX_PX_PER_MM = 6.0
SHEET_OF = {"nhpt": "nhpt_board", "cup": "cup_targets"}
TITLES = {"nhpt_board": "Nine-Hole Peg Test board", "cup_targets": "Waiter – cup target sheet"}


def sheet_geom(spec: SheetSpec) -> dict:
    return {
        "name": spec.name, "width_mm": spec.width_mm, "height_mm": spec.height_mm, "page": list(page_mm(spec)),
        "markers": {str(k): list(v) for k, v in spec.marker_centres_mm.items()}, "marker_size_mm": spec.marker_size_mm,
        "targets": [list(t) for t in spec.targets_mm], "target_radius_mm": spec.target_radius_mm,
    }


def sheet_texture(spec: SheetSpec, px_per_mm: float = TEX_PX_PER_MM) -> np.ndarray:
    """The printed page as the patient has it: `sheet_canonical` (markers + targets, the PDF's
    artwork) cut to `page_mm`, with the PDF's grey corner names and title (tools/make_sheets.py)."""
    img = sheet_canonical(spec, px_per_mm)
    pw, ph, ox, oy = page_mm(spec)
    x0, y0 = int(round(ox * px_per_mm)), int(round(oy * px_per_mm))
    page = img[y0 : y0 + int(round(ph * px_per_mm)), x0 : x0 + int(round(pw * px_per_mm))].copy()
    grey = int(255 * 0.45)

    def at(x: float, y: float) -> tuple[int, int]:
        return int(round((x - ox) * px_per_mm)), int(round((y - oy) * px_per_mm))

    def text(s: str, x: float, y: float, scale: float, thick: int = 1) -> None:
        (w, _), _ = cv2.getTextSize(s, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
        px, py = at(x, y)
        cv2.putText(page, s, (px - w // 2, py), cv2.FONT_HERSHEY_SIMPLEX, scale, grey, thick, cv2.LINE_AA)

    half = spec.marker_size_mm / 2
    for k, (mx, my) in spec.marker_centres_mm.items():
        top = my < spec.height_mm / 2
        text(f"{corner_name(spec, k)} ({k})", mx, my + half + 6.5 if top else my - half - 2.0, 0.55 * px_per_mm / 6)
    xs = sorted(x for x, y in spec.marker_centres_mm.values() if y < spec.height_mm / 2)
    y_top = min(y for _, y in spec.marker_centres_mm.values())
    cx = (xs[0] + xs[-1]) / 2
    text(f"Praxis - {TITLES[spec.name]}", cx, y_top - 8.0, 0.62 * px_per_mm / 6, 2)
    text("Print at 100 % (actual size) on A4 or US Letter. Lay it flat.", cx, y_top - 3.0, 0.42 * px_per_mm / 6)
    x0b, yb = cx - 40.0, y_top + 6.0
    cv2.line(page, at(x0b, yb), at(x0b + 80.0, yb), grey, 2, cv2.LINE_AA)
    for i in range(9):
        tick = 2.5 if i % 4 else 4.0
        cv2.line(page, at(x0b + 10 * i, yb - tick / 2), at(x0b + 10 * i, yb + tick / 2), grey, 2, cv2.LINE_AA)
    return page


def post_process(frames_dir: Path, n: int, out_avi: Path, fps: float, sigma: float, seed: int) -> int:
    """Sensor noise (Gaussian, per channel, plus a little luma-correlated shot noise) and a mild
    lens softness, then each frame JPEG-encoded at q70 into an MJPG .avi (the browser's q70)."""
    rng = np.random.default_rng(seed)
    w = cv2.VideoWriter(str(out_avi), cv2.VideoWriter_fourcc(*"MJPG"), fps, (640, 480))
    if not w.isOpened():
        raise RuntimeError(f"cannot write {out_avi}")
    w.set(cv2.VIDEOWRITER_PROP_QUALITY, 70)
    written = 0
    for i in range(n):
        img = cv2.imread(str(frames_dir / f"f_{i:04d}.png"))
        if img is None:
            raise FileNotFoundError(frames_dir / f"f_{i:04d}.png")
        f = img.astype(np.float32)
        f = cv2.GaussianBlur(f, (0, 0), 0.6)
        shot = rng.normal(0, 1, f.shape).astype(np.float32) * np.sqrt(np.maximum(f, 1.0)) * (sigma / 12.0)
        f = f + rng.normal(0, sigma, f.shape).astype(np.float32) + shot
        w.write(np.clip(f, 0, 255).astype(np.uint8))
        written += 1
    w.release()
    return written


def run_clip(cond: scenario.Condition, out: Path, samples: int, still: int | None, keep: bool) -> dict:
    spec = SHEETS[SHEET_OF[cond.exercise]]
    work = out / "work" / cond.id
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    tex = out / "work" / f"{spec.name}_page.png"
    if not tex.exists():
        cv2.imwrite(str(tex), sheet_texture(spec))
    sheet = scenario.SheetGeom.from_dict(sheet_geom(spec))
    cond = scenario.framed(cond, sheet)  # as camera setup (screen 05) leaves it: all markers in view
    script = scenario.build_script(cond, sheet)
    job = scenario.job(script, str(tex), str(work / "frames"))
    job["samples"] = samples
    if still is not None:
        job["still_only"] = still
    job_path = work / "job.json"
    job_path.write_text(json.dumps(job))
    t0 = time.time()
    log = work / "blender.log"
    with log.open("w") as fh:
        r = subprocess.run([BLENDER, "-b", "--factory-startup", "--python", str(HERE.parent / "render_tasks.py"), "--", str(job_path)],
                           stdout=fh, stderr=subprocess.STDOUT)
    if r.returncode != 0 or "Traceback" in log.read_text():
        raise RuntimeError(f"Blender failed for {cond.id}; see {log}")
    render_s = time.time() - t0
    vis = json.loads((work / "frames" / "visibility.json").read_text())
    counts = [len(v["markers"]) for v in vis]
    if still is not None:
        return {"id": cond.id, "still": str(work / "frames" / "still.png"), "render_s": round(render_s, 1), "markers_at_still": vis[still]["markers"]}
    n = len(job["frames"])
    avi = out / f"{cond.id}.avi"
    post_process(work / "frames", n, avi, cond.fps, cond.noise_sigma, cond.seed)
    lab = scenario.labels(script, counts)
    tru = scenario.truth(script, counts)
    tru["hand_in_view_frames"] = sum(1 for v in vis if v["hand_in_view"])
    tru["render_s"] = round(render_s, 1)
    (out / f"{cond.id}.labels.json").write_text(json.dumps(lab, indent=1) + "\n")
    (out / f"{cond.id}.truth.json").write_text(json.dumps(tru, indent=1) + "\n")
    if not keep:
        shutil.rmtree(work / "frames")
    return {"id": cond.id, "mode": cond.exercise, "sheet": spec.name, "video": avi.name, "labels": f"{cond.id}.labels.json",
            "truth": f"{cond.id}.truth.json", "synthetic": True, "participant": "render3d", "frames": n, "fps": cond.fps,
            "render_s": round(render_s, 1), "condition": cond.to_dict()}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="make_dataset_3d.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--only", nargs="*", help="clip ids (default: all of scenario.default_conditions)")
    ap.add_argument("--samples", type=int, default=12, help="Eevee samples per frame (default %(default)s)")
    ap.add_argument("--still", type=int, default=None, help="render only this frame index (debug), no clip")
    ap.add_argument("--keep-frames", action="store_true")
    ap.add_argument("--rebuild-manifest", action="store_true", help="only rewrite manifest.json from the <id>.truth.json files in --out")
    args = ap.parse_args(argv)
    out = Path(args.out)
    if args.rebuild_manifest:
        write_manifest(out, {e["id"]: e for e in (entry_from_files(p) for p in sorted(out.glob("*.truth.json")))})
        return 0
    if not Path(BLENDER).exists():
        print(f"Blender not found at {BLENDER}")
        return 2
    out.mkdir(parents=True, exist_ok=True)
    conds = [c for c in scenario.default_conditions() if not args.only or c.id in args.only]
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"version": "3d_v0", "entries": []}
    entries = {e["id"]: e for e in manifest.get("entries", [])}
    for c in conds:
        t0 = time.time()
        res = run_clip(c, out, args.samples, args.still, args.keep_frames)
        print(json.dumps(res), f"({time.time() - t0:.0f} s)", flush=True)
        if args.still is None:
            entries[c.id] = res
    if args.still is None:
        write_manifest(out, entries)
    return 0


def entry_from_files(truth_path: Path) -> dict:
    """A manifest entry rebuilt from a clip's committed truth file (same fields as run_clip)."""
    t = json.loads(truth_path.read_text())
    c = t["condition"]
    cid = t["clip_id"]
    return {"id": cid, "mode": c["exercise"], "sheet": SHEET_OF[c["exercise"]], "video": f"{cid}.avi", "labels": f"{cid}.labels.json",
            "truth": f"{cid}.truth.json", "synthetic": True, "participant": "render3d", "frames": t["frames"], "fps": c["fps"],
            "render_s": t.get("render_s"), "condition": c}


def write_manifest(out: Path, entries: dict) -> None:
    order = [c.id for c in scenario.default_conditions()]
    manifest = {
        "version": "3d_v0", "cv2_version": cv2.__version__, "blender": "5.2.2 LTS (Eevee)",
        "notes": "Synthetic 3-D renders (evaluation/blender), not real-camera evidence. Clips (.avi, JPEG q70 frames) are git-ignored; "
                 "regenerate with evaluation/blender/make_dataset_3d.py.",
        "entries": sorted(entries.values(), key=lambda e: order.index(e["id"]) if e["id"] in order else 999),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    sys.exit(main())
