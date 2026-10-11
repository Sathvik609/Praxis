"""Fake-camera videos for the browser end-to-end check (`web/scripts/e2e-fake-camera.mjs`).

    uv run python tools/make_fake_camera.py [--out DIR] [--fps 30] [--only NAME ...] [--stills]

Renders, with the repo's own synthetic renderer (`perception/synth.py`), what a laptop's built-in
camera sees when its screen is tilted forward over a printed sheet lying 25-35 cm in front of it:
the sheet at ~40 deg from straight down, upside down in the raw camera image (the sheet's top
edge, nearest the laptop, is at the bottom of the frame and the patient side at the top), with
sensor noise. Clips are written as MJPEG (concatenated JPEG frames), which Chrome plays as a
camera with `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<file>`.
Chrome assumes 30 fps for MJPEG and loops the file; every getUserMedia restarts it at frame 0.

Synthetic: these clips exercise the browser -> service -> coach -> report path, not real-world
accuracy. Output is git-ignored (default `evaluation/fake_camera/`).

OpenCV cv2.__version__ == 5.0.0 (cv2.warpPerspective via synth.camera_frame, cv2.imencode,
cv2.GaussianBlur, cv2.warpAffine, cv2.rotate).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Iterator
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
from praxis_session.perception.board_spec import CUP_TARGETS, NHPT_BOARD, SheetSpec  # noqa: E402
from praxis_session.perception.cup import ARC  # noqa: E402
from praxis_session.perception.synth import SKIN_BGR, camera_frame, view_homography  # noqa: E402

SIZE = (640, 480)
TILT_DEG = 40.0  # laptop screen tilted forward over the sheet
YAW_DEG = 4.0
# Sheet size in the frame: the portrait NHPT sheet ~1.1 px/mm at the centre (about what a 640x480
# laptop frame gives at 30 cm); the landscape cup sheet a little smaller so all of it fits.
SCALE = {"nhpt_board": 1.25, "cup_targets": 1.0}
NOISE = 3.0
NHPT_ORDER = [4, 0, 8, 2, 6, 1, 7, 3, 5]
NHPT_SOURCE_MM = (160.0, 148.5)  # beside the board, as in synth.write_nhpt_clip

# One "shot": the sheet state for a span of seconds and an optional frame effect.
Effect = Callable[[np.ndarray], np.ndarray]


def _rot180(frame: np.ndarray) -> np.ndarray:
    return cv2.rotate(frame, cv2.ROTATE_180)


def dark(frame: np.ndarray) -> np.ndarray:
    return (frame.astype(np.float32) * 0.16).astype(np.uint8)


def blurred(frame: np.ndarray) -> np.ndarray:
    return cv2.GaussianBlur(frame, (0, 0), 7.0)


def half_out(frame: np.ndarray) -> np.ndarray:
    """The sheet slid sideways so about half of it leaves the frame."""
    M = np.float32([[1, 0, SIZE[0] * 0.5], [0, 1, 0]])
    return cv2.warpAffine(frame, M, SIZE, borderValue=(90, 90, 90))


def no_sheet(frame: np.ndarray) -> np.ndarray:
    """The sheet pushed out of view entirely (only the table)."""
    rng = np.random.default_rng(int(frame[0, 0, 0]) + 7)
    table = np.full_like(frame, 90)
    return np.clip(table + rng.normal(0, NOISE, table.shape), 0, 255).astype(np.uint8)


class Clip:
    def __init__(self, spec: SheetSpec, fps: float, seed: int) -> None:
        self.spec = spec
        self.fps = fps
        self.rng = np.random.default_rng(seed)
        self.frames: list[tuple[dict, Effect | None]] = []  # rendered lazily
        self.marks: list[dict] = []

    @property
    def t(self) -> float:
        return len(self.frames) / self.fps

    def hold(self, seconds: float, effect: Effect | None = None, **state) -> None:
        for _ in range(max(1, round(seconds * self.fps))):
            self.frames.append((state, effect))

    def mark(self, what: str, **kw) -> None:
        self.marks.append({"t": round(self.t, 3), "what": what, **kw})

    def geometry(self) -> dict:
        """Where the sheet truly is in the raw (unmirrored, rotated) camera frame: the ground truth
        the e2e driver compares the service's overlay geometry against."""
        H = view_homography(self.spec, SIZE, TILT_DEG, YAW_DEG, SCALE[self.spec.name])

        def px(pts):
            q = cv2.perspectiveTransform(np.array(pts, np.float64).reshape(-1, 1, 2), H).reshape(-1, 2)
            q = np.array([SIZE[0] - 1, SIZE[1] - 1]) - q  # cv2.ROTATE_180
            return np.round(q, 1).tolist()

        ids = sorted(self.spec.marker_centres_mm)
        return {
            "markers_px": dict(zip(map(str, ids), px([self.spec.marker_centres_mm[i] for i in ids]), strict=True)),
            "targets_px": px(self.spec.targets_mm),
        }

    def render(self) -> Iterator[np.ndarray]:
        for state, effect in self.frames:
            state = dict(state)
            hide = state.pop("hide_marker", None)
            hidden = () if hide is None else (hide,) if isinstance(hide, int) else tuple(hide)
            hide = hidden[0] if hidden else None
            skin = []
            for mid in hidden:  # a hand on the corner marker(s)
                cx, cy = self.spec.marker_centres_mm[mid]
                skin += [(cx, cy, 28.0), (cx + (25 if cx < self.spec.width_mm / 2 else -25), cy, 18.0)]
            frame, _ = camera_frame(
                self.spec,
                size=SIZE,
                tilt_deg=TILT_DEG,
                yaw_deg=YAW_DEG,
                scale=SCALE[self.spec.name],
                noise_sigma=NOISE,
                seed=int(self.rng.integers(0, 2**31)),
                hide_marker=hide,
                skin_blobs_mm=skin or None,
                skin_bgr=SKIN_BGR,
                **state,
            )
            frame = _rot180(frame)
            if effect is not None:
                frame = effect(frame)
            yield frame


# --- NHPT -------------------------------------------------------------------------------------


def nhpt_clip(fps: float, phase_s: float = 0.6, lead_s: float = 8.0, loss_after: int | None = None, loss_s: float = 4.0) -> Clip:
    """Idle with a peg at the source, then nine transfers (lift, over hole, seated, next peg),
    then the full board. `loss_after=k`: the sheet leaves the view for `loss_s` after peg k."""
    c = Clip(NHPT_BOARD, fps, seed=11)
    holes = NHPT_BOARD.targets_mm
    seated: list[int] = []

    def pegs(*extra):
        return [holes[k] for k in seated] + list(extra)

    c.hold(lead_s, pegs_mm=pegs(NHPT_SOURCE_MM))
    for r, k in enumerate(NHPT_ORDER, start=1):
        c.mark("lift", rep=r, hole=k)
        c.hold(phase_s, pegs_mm=pegs())
        c.hold(phase_s, pegs_mm=pegs((holes[k][0] + 5.0, holes[k][1])))
        seated.append(k)
        c.mark("seated", rep=r, hole=k)
        c.hold(phase_s, pegs_mm=pegs())
        c.hold(phase_s, pegs_mm=pegs(NHPT_SOURCE_MM) if r < 9 else pegs())
        if loss_after == r:
            c.mark("sheet_gone")
            c.hold(loss_s, effect=no_sheet, pegs_mm=pegs(NHPT_SOURCE_MM))
            c.mark("sheet_back")
            c.hold(2.0, pegs_mm=pegs(NHPT_SOURCE_MM))
    c.hold(20.0, pegs_mm=pegs())
    return c


# --- Waiter - cup -----------------------------------------------------------------------------


def cup_clip(fps: float, slow_s: float = 0.7, fast_s: float = 0.35, lead_s: float = 8.0, gap_s: float = 8.0, cover: tuple[int | tuple[int, ...], int] | None = None) -> Clip:
    """Idle at dot 1, two slow arcs (1..5..1), a pause for the progression prompt, two fast
    arcs, then idle. Per reach: at the source dot -> lifted (base hidden) -> mid-way -> placed.
    `cover=(marker_ids, arc)`: a hand covers those corner markers for the whole of that arc
    (one covered corner rides on the three-marker fit; two lose calibration)."""
    c = Clip(CUP_TARGETS, fps, seed=13)
    dots = CUP_TARGETS.targets_mm
    c.hold(lead_s, cup_mm=dots[ARC[0]])
    for arc, phase in enumerate(("slow", "slow", "fast", "fast"), start=1):
        if arc == 3:
            c.mark("progression_gap")
            c.hold(gap_s, cup_mm=dots[ARC[0]])
        h = fast_s if phase == "fast" else slow_s
        hide = cover[0] if cover and cover[1] == arc else None
        extra = {"hide_marker": hide} if hide is not None else {}
        if hide is not None:
            c.mark("marker_covered", marker=hide)
        for a, b in zip(ARC[:-1], ARC[1:], strict=True):
            c.hold(h, cup_mm=dots[a], **extra)
            c.mark("lift", arc=arc, phase=phase, from_dot=a, to_dot=b)
            c.hold(h, cup_mm=None, **extra)
            mid = ((dots[a][0] + dots[b][0]) / 2, (dots[a][1] + dots[b][1]) / 2)
            c.hold(h, cup_mm=mid, **extra)
            c.mark("placed", arc=arc, to_dot=b)
            c.hold(h + 2 / fps, cup_mm=dots[b], **extra)
        if hide is not None:
            c.mark("marker_uncovered", marker=hide)
    c.hold(20.0, cup_mm=dots[ARC[-1]])
    return c


# --- Camera-setup failures --------------------------------------------------------------------


def setup_clip(spec: SheetSpec, fps: float, kind: str) -> Clip:
    c = Clip(spec, fps, seed=17)
    state = {"pegs_mm": [NHPT_SOURCE_MM]} if spec is NHPT_BOARD else {"cup_mm": spec.targets_mm[0]}
    if kind == "good":
        c.hold(30.0, **state)
    elif kind == "covered":  # covered for 10 s, then uncovered for 10 s (loops)
        c.mark("covered", marker=3)
        c.hold(10.0, hide_marker=3, **state)
        c.mark("uncovered")
        c.hold(10.0, **state)
    elif kind == "dark":
        c.hold(20.0, effect=dark, **state)
    elif kind == "blur":
        c.hold(20.0, effect=blurred, **state)
    elif kind == "half_out":
        c.hold(20.0, effect=half_out, **state)
    else:
        raise ValueError(kind)
    return c


def clips(fps: float) -> dict[str, Callable[[], Clip]]:
    return {
        "nhpt_session": lambda: nhpt_clip(fps),
        "nhpt_loss": lambda: nhpt_clip(fps, loss_after=4),
        "cup_session": lambda: cup_clip(fps),
        "cup_covered": lambda: cup_clip(fps, cover=((2, 3), 2)),  # a forearm along the near edge
        "setup_nhpt_good": lambda: setup_clip(NHPT_BOARD, fps, "good"),
        "setup_cup_good": lambda: setup_clip(CUP_TARGETS, fps, "good"),
        "setup_nhpt_covered": lambda: setup_clip(NHPT_BOARD, fps, "covered"),
        "setup_nhpt_dark": lambda: setup_clip(NHPT_BOARD, fps, "dark"),
        "setup_nhpt_blur": lambda: setup_clip(NHPT_BOARD, fps, "blur"),
        "setup_nhpt_half_out": lambda: setup_clip(NHPT_BOARD, fps, "half_out"),
    }


def write_mjpeg(clip: Clip, path: Path, quality: int = 85) -> int:
    n = 0
    with path.open("wb") as f:
        for frame in clip.render():
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
            assert ok
            f.write(buf.tobytes())
            n += 1
    return n


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=str(HERE.parents[3] / "evaluation" / "fake_camera"))
    ap.add_argument("--fps", type=float, default=30.0, help="Chrome plays MJPEG at 30 fps")
    ap.add_argument("--only", nargs="*", help="clip names to render (default all)")
    ap.add_argument("--stills", action="store_true", help="also write the first frame as PNG")
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    index_path = out / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    for name, make in clips(args.fps).items():
        if args.only and name not in args.only:
            continue
        clip = make()
        path = out / f"{name}.mjpeg"
        n = write_mjpeg(clip, path)
        if args.stills:
            cv2.imwrite(str(out / f"{name}.png"), next(clip.render()))
        index[name] = {"file": path.name, "fps": args.fps, "frames": n, "seconds": round(n / args.fps, 2), "marks": clip.marks, "geometry": clip.geometry()}
        print(f"{name:22s} {n:5d} frames {n / args.fps:6.1f} s -> {path}")
    index_path.write_text(json.dumps(index, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
