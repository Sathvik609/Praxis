"""Keyboard labeller for one recorded clip (OpenCV cv2.__version__ == 5.0.0: VideoCapture +
imshow). Writes <clip>.labels.json next to the clip in the praxis.labels/1 schema
(evaluation/labels.schema.json).

    cd services/session
    uv run python tools/label_clip.py ../../evaluation/dataset_v1/raw/p01/abduction/20261012T101500.mp4 \
        --labeller ST [--gonio 88,91,86,-,90,...]
    uv run python tools/label_clip.py <clip.mp4> --labeller ST --validate-only

Opens a window on the clip (step-by-step guide: evaluation/PROTOCOL.md §7). Keys, also drawn on
the frame:
  space  play / pause          , .  one frame back / forward      [ ]  one second back / forward
  s      rep starts here       e    rep ends here (creates the rep; the rep becomes "current")
  u      current rep: toggle expected verified / unverified (reason "other")
  o      current rep: occluded (unverified, reason occluded)
  r      current rep: cycle the unverified reason (occluded, marker_lost, hold_too_short,
         target_missed, other)
  l / h  Arm out to the side: toggle trunk lean / shoulder hike on the current rep
  1-9    NHPT: hole 1-9 (stored 0-8) · Waiter – cup: dot 1-5 the cup was set on (stored 0-4)
  g      Arm out to the side: type the goniometer angle, then Enter (Backspace edits, Esc cancels)
  d      deliberate error on the current rep: cycles lean, hike, past_ceiling, low_lift,
         short_hold, occluded_cup, covered_marker, dim_light, dropped_peg, other, none
  p      NHPT: a peg was dropped here
  x      delete the current rep          c    mark the file complete (every rep labelled)
  w      write                          q    write and quit          Esc  quit without writing

Rep boundaries (what s and e mean per exercise):
  Arm out to the side  s = the arm starts to lift · e = the arm is back down at the side
  Waiter – cup         s = the cup leaves its dot · e = the cup is set down on the next dot
  NHPT                 s = the peg leaves the dish · e = the peg is seated in its hole

Times are frame_index / fps (the file's own fps), the same clock replay and eval.py use. Rep
times are when the labeller pressed the key on the paused or playing frame: pause and step
with , . for accuracy. `--gonio` takes the paper goniometer readings in rep order ('-' = not
measured) and fills them in as the reps are created.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import dataset_v1 as ds  # noqa: E402

ERRORS = [None, "lean", "hike", "past_ceiling", "low_lift", "short_hold", "occluded_cup", "covered_marker", "dim_light", "dropped_peg", "other"]
REASONS = ["occluded", "marker_lost", "hold_too_short", "target_missed", "other"]
WINDOW = "Praxis labeller"


class LabelState:
    """Pure labelling logic, driven by keys; the window loop only draws and forwards keys."""

    def __init__(self, clip_id: str, exercise: str, labeller: str, fps: float, existing: dict[str, Any] | None = None) -> None:
        self.clip_id, self.exercise, self.labeller, self.fps = clip_id, exercise, labeller, fps
        self.reps: list[dict[str, Any]] = [dict(r) for r in (existing or {}).get("reps", [])]
        self.drops: list[float] = list((existing or {}).get("drops", []))
        self.complete = bool((existing or {}).get("complete", False))
        self.notes = str((existing or {}).get("notes", ""))
        self.pending_start: float | None = None
        self.current: int | None = len(self.reps) - 1 if self.reps else None
        self.typing: str | None = None  # goniometer entry buffer
        self.gonio: list[float | None] = []  # paper readings, rep order
        self.dirty = False
        self.message = ""

    @property
    def arm(self) -> bool:
        return self.exercise in ds.ARM_IDS

    def rep(self) -> dict[str, Any] | None:
        return None if self.current is None else self.reps[self.current]

    def _new_rep(self, t0: float, t1: float) -> dict[str, Any]:
        r: dict[str, Any] = {"rep": 0, "t_start": round(t0, 3), "t_end": round(t1, 3), "expected": "verified", "reason": None, "deliberate_error": None}
        if self.arm:
            r["compensation"] = {"lean": False, "hike": False}
            r["peak_deg_goniometer"] = None
        elif self.exercise == "nhpt":
            r["hole"] = 0
        elif self.exercise == "cup":
            r["to_dot"] = 0
        return r

    def _renumber(self) -> None:
        cur = self.rep()
        self.reps.sort(key=lambda r: r["t_start"])
        for i, r in enumerate(self.reps, 1):
            r["rep"] = i
        self.current = None if cur is None else self.reps.index(cur)

    def key(self, k: str, t: float) -> str | None:
        """Apply one key at clip time `t`. Returns "write", "quit", "abort" or None."""
        self.message = ""
        if self.typing is not None:
            return self._typing_key(k)
        r = self.rep()
        if k == "s":
            self.pending_start = t
            self.message = f"start {t:.2f}s"
        elif k == "e":
            t0 = self.pending_start if self.pending_start is not None else (self.reps[-1]["t_end"] if self.reps else 0.0)
            if t < t0:
                self.message = "end before start: ignored"
                return None
            nr = self._new_rep(t0, t)
            self.reps.append(nr)
            self.current = len(self.reps) - 1
            self._renumber()
            self.pending_start = None
            self.dirty = True
            self.message = f"rep {nr['rep']} {nr['t_start']:.2f}-{nr['t_end']:.2f}s"
        elif r is not None and k == "u":
            if r["expected"] == "verified":
                r["expected"], r["reason"] = "unverified", r.get("reason") or "other"
            else:
                r["expected"], r["reason"] = "verified", None
            self.dirty = True
        elif r is not None and k == "o":
            r["expected"], r["reason"] = "unverified", "occluded"
            self.dirty = True
        elif r is not None and k == "r":
            i = REASONS.index(r["reason"]) if r.get("reason") in REASONS else -1
            r["expected"], r["reason"] = "unverified", REASONS[(i + 1) % len(REASONS)]
            self.dirty = True
        elif r is not None and self.arm and k in ("l", "h"):
            f = "lean" if k == "l" else "hike"
            r["compensation"][f] = not r["compensation"][f]
            self.dirty = True
        elif r is not None and k.isdigit() and k != "0":
            n = int(k)
            if self.exercise == "nhpt":
                r["hole"] = n - 1
                self.dirty = True
            elif self.exercise == "cup" and n <= 5:
                r["to_dot"] = n - 1
                self.dirty = True
        elif r is not None and self.arm and k == "g":
            self.typing = ""
        elif r is not None and k == "d":
            i = ERRORS.index(r.get("deliberate_error"))
            r["deliberate_error"] = ERRORS[(i + 1) % len(ERRORS)]
            self.dirty = True
        elif k == "p" and self.exercise == "nhpt":
            self.drops.append(round(t, 3))
            self.dirty = True
        elif r is not None and k == "x":
            self.reps.pop(self.current)  # type: ignore[arg-type]
            self.current = len(self.reps) - 1 if self.reps else None
            self._renumber()
            self.dirty = True
        elif k == "c":
            self.complete = not self.complete
            self.dirty = True
        elif k == "w":
            return "write"
        elif k == "q":
            return "quit"
        elif k == "esc":
            return "abort"
        return None

    def _typing_key(self, k: str) -> None:
        r = self.rep()
        assert r is not None and self.typing is not None
        if k == "enter":
            try:
                r["peak_deg_goniometer"] = float(self.typing) if self.typing else None
                self.dirty = True
            except ValueError:
                self.message = f"not a number: {self.typing!r}"
            self.typing = None
        elif k == "esc":
            self.typing = None
        elif k == "backspace":
            self.typing = self.typing[:-1]
        elif k.isdigit() or (k == "." and "." not in self.typing):
            self.typing += k
        return None

    def apply_gonio(self, values: list[float | None]) -> None:
        """Paper goniometer readings in rep order (PROTOCOL.md). Reps already labelled get them
        now; reps labelled later pick theirs up (by order) when the file is written."""
        self.gonio = list(values)
        for r, v in zip(sorted(self.reps, key=lambda r: r["t_start"]), values):
            r["peak_deg_goniometer"] = v
        self.dirty = True

    def _fill_gonio(self) -> None:
        if not self.arm:
            return
        for r, v in zip(sorted(self.reps, key=lambda r: r["t_start"]), self.gonio):
            if r.get("peak_deg_goniometer") is None:
                r["peak_deg_goniometer"] = v

    def to_json(self) -> dict[str, Any]:
        self._fill_gonio()
        d: dict[str, Any] = {
            "schema": ds.LABEL_SCHEMA,
            "clip_id": self.clip_id,
            "exercise": self.exercise,
            "labeller": self.labeller,
            "labelled_at": dt.datetime.now().isoformat(timespec="seconds"),
            "fps": self.fps,
            "complete": self.complete,
            "notes": self.notes,
            "reps": sorted(self.reps, key=lambda r: r["t_start"]),
        }
        if self.exercise == "nhpt":
            d["nhpt"] = ds.nhpt_block(self.reps) or {"t_start": 0.0, "t_end": 0.0, "total_s": 0.0}
            d["drops"] = sorted(self.drops)
        return d

    def help_lines(self) -> list[str]:
        common = "space play  ,. frame  [] 1s  s start  e end  u verified?  o occluded  r reason  d error  x del  c complete  w write  q quit"
        extra = {"nhpt": "1-9 hole  p drop", "cup": "1-5 dot"}.get(self.exercise, "l lean  h hike  g gonio")
        return [common, extra]

    def status_lines(self, t: float, frame: int, playing: bool) -> list[str]:
        r = self.rep()
        head = f"{self.clip_id}  {t:7.2f}s  f{frame}  {'PLAY' if playing else 'PAUSE'}  reps {len(self.reps)}{'  COMPLETE' if self.complete else ''}"
        lines = [head]
        if self.pending_start is not None:
            lines.append(f"start marked at {self.pending_start:.2f}s - press e at the end")
        if r is not None:
            desc = f"rep {r['rep']}: {r['t_start']:.2f}-{r['t_end']:.2f}s {r['expected']}"
            if r.get("reason"):
                desc += f" ({r['reason']})"
            if "hole" in r:
                desc += f"  hole {r['hole'] + 1}"
            if "to_dot" in r:
                desc += f"  dot {r['to_dot'] + 1}"
            if "compensation" in r:
                c = r["compensation"]
                desc += f"  lean {'Y' if c['lean'] else 'n'} hike {'Y' if c['hike'] else 'n'}  gonio {r['peak_deg_goniometer']}"
            if r.get("deliberate_error"):
                desc += f"  error:{r['deliberate_error']}"
            lines.append(desc)
        if self.typing is not None:
            lines.append(f"goniometer deg: {self.typing}_  (Enter to set)")
        if self.message:
            lines.append(self.message)
        return lines


KEYMAP = {32: "space", 13: "enter", 10: "enter", 27: "esc", 8: "backspace", 127: "backspace"}


def write_labels(state: LabelState, path: Path) -> list[str]:
    d = state.to_json()
    errs = ds.validate_labels(d) + [f"warning: {w}" for w in ds.label_warnings(d)]
    path.write_text(json.dumps(d, indent=1) + "\n")
    state.dirty = False
    return errs


def run_ui(video: Path, state: LabelState, out: Path) -> int:  # pragma: no cover - interactive
    import cv2

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        print(f"cannot open {video}")
        return 2
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = state.fps
    frames = []
    while True:  # clips are short (< 3 min at 640x480); random access by index is exact
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    n = len(frames)
    if n == 0:
        print("empty clip")
        return 2
    i, playing = 0, False
    try:
        cv2.namedWindow(WINDOW)
    except cv2.error:
        print("This OpenCV build has no GUI (headless wheel without a window backend).")
        print("Label on a machine whose cv2 can open windows (the pinned macOS wheel can).")
        return 2
    while True:
        t = i / fps
        v = frames[i].copy()
        lines = state.status_lines(t, i, playing) + state.help_lines()
        for j, s in enumerate(lines):
            y = 22 + 20 * j if j < len(lines) - 2 else v.shape[0] - 30 + 16 * (j - len(lines) + 2)
            cv2.putText(v, s, (8, y), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 3, cv2.LINE_AA)
            cv2.putText(v, s, (8, y), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
        for r in state.reps:  # timeline
            x0, x1 = int(r["t_start"] / (n / fps) * v.shape[1]), int(r["t_end"] / (n / fps) * v.shape[1])
            col = (133, 169, 47) if r["expected"] == "verified" else (20, 127, 201)
            cv2.rectangle(v, (x0, v.shape[0] - 8), (max(x1, x0 + 1), v.shape[0] - 2), col, -1)
        cv2.line(v, (int(i / n * v.shape[1]), v.shape[0] - 12), (int(i / n * v.shape[1]), v.shape[0]), (255, 255, 255), 2)
        cv2.imshow(WINDOW, v)
        code = cv2.waitKey(int(1000 / fps) if playing else 0) & 0xFF
        if code == 255:
            if playing:
                i = min(n - 1, i + 1)
                playing = i < n - 1
            continue
        k = KEYMAP.get(code, chr(code) if 32 < code < 127 else "")
        if state.typing is None:
            if k == "space":
                playing = not playing
                continue
            if k in (",", "."):
                playing = False
                i = max(0, min(n - 1, i + (1 if k == "." else -1)))
                continue
            if k in ("[", "]"):
                i = max(0, min(n - 1, i + int(fps) * (1 if k == "]" else -1)))
                continue
        act = state.key(k, t)
        if act in ("write", "quit"):
            errs = write_labels(state, out)
            print(f"wrote {out}" + (f"  ({len(errs)} validation issues: {errs[:3]})" if errs else ""))
            if act == "quit":
                break
        elif act == "abort":
            break
    cv2.destroyAllWindows()
    return 0


def clip_fps(video: Path, meta: dict[str, Any]) -> float:
    """The file's own fps (what replay and eval.py use for t = frame_index / fps), else the
    sidecar's, else 15."""
    if video.exists():
        import cv2

        cap = cv2.VideoCapture(str(video))
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0) if cap.isOpened() else 0.0
        cap.release()
        if fps > 0:
            return fps
    return float(meta.get("fps") or ds.FPS)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="label_clip.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("video", help="the clip, e.g. ../../evaluation/dataset_v1/raw/p01/cup/<timestamp>.mp4")
    ap.add_argument("--labeller", default=None, help="your initials (required unless --validate-only)")
    ap.add_argument("--gonio", default=None, help="goniometer degrees per rep in order, comma list ('-' = not measured)")
    ap.add_argument("--validate-only", action="store_true", help="check the existing labels file and exit (1 = problems)")
    args = ap.parse_args(argv)
    if not args.validate_only and not args.labeller:
        ap.error("--labeller (your initials) is required")
    video = Path(args.video)
    sidecar = video.with_suffix(".json")
    meta = json.loads(sidecar.read_text()) if sidecar.exists() else {}
    exercise = meta.get("exercise") or video.parent.name
    try:
        ds.check_exercise(exercise)
    except ValueError as e:
        print(e)
        return 2
    out = video.with_suffix(".labels.json")
    existing = json.loads(out.read_text()) if out.exists() else None
    if args.validate_only:
        errs = ds.validate_labels(existing) if existing else ["no labels file"]
        warns = ds.label_warnings(existing) if existing and not errs else []
        print(json.dumps({"labels": str(out), "errors": errs, "warnings": warns, "complete": bool(existing and existing.get("complete"))}, indent=1))
        return 1 if errs else 0
    state = LabelState(meta.get("clip_id") or video.stem, exercise, args.labeller, clip_fps(video, meta), existing)
    if args.gonio:
        state.apply_gonio([None if v.strip() in ("", "-") else float(v) for v in args.gonio.split(",")])
    return run_ui(video, state, out)


if __name__ == "__main__":
    sys.exit(main())
