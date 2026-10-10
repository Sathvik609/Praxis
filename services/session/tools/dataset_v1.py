"""Dataset v1 (real recordings): layout, sidecars, consent, label schema, discovery, manifest,
deletion. Shared by `tools/record_session.py`, `tools/label_clip.py` and
`evaluation/scripts/eval.py` so the three agree on one layout (OpenCV cv2.__version__ == 5.0.0
does the capture and playback in those tools):

    evaluation/dataset_v1/
      manifest.json                                  written by `dataset_v1.py manifest` - committed
      consent/<participant>_<YYYY-MM-DD>.json        consent record (pseudonym, dates) - committed
      raw/<participant>/<exercise>/<ts>.mp4          the clip - git-ignored, deleted after 30 days
      raw/<participant>/<exercise>/<ts>.json         sidecar (who/what/how recorded) - committed
      raw/<participant>/<exercise>/<ts>.labels.json  ground truth (labels.schema.json) - committed
      raw/<participant>/<exercise>/<ts>.pred.json    pipeline events cached by eval.py - committed
    evaluation/failure_cases/<clip_id>/              JPEG frames around each miss + reason.json,
                                                     only with consent_clips - git-ignored,
                                                     deleted with the clip

Only pseudonyms (p01, p02, ...) ever appear here; the key from pseudonym to person stays on
paper with the team lead. Video never leaves the laptop it was recorded on. After deletion the
committed `.pred.json` (events only, no pixels) keeps every number regenerable.

    uv run python tools/dataset_v1.py status      # clips, labelled reps, progress to 300 / 5
    uv run python tools/dataset_v1.py validate    # check every labels file against the schema
    uv run python tools/dataset_v1.py manifest    # write dataset_v1/manifest.json for eval.py
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
EVAL_DIR = ROOT / "evaluation"
DATASET_DIR = EVAL_DIR / "dataset_v1"
RAW_DIR = DATASET_DIR / "raw"
CONSENT_DIR = DATASET_DIR / "consent"
FAILURE_DIR = EVAL_DIR / "failure_cases"
LABEL_SCHEMA_PATH = EVAL_DIR / "labels.schema.json"

DATASET_VERSION = "v1"
SIDECAR_SCHEMA = "praxis.sidecar/1"
LABEL_SCHEMA = "praxis.labels/1"
CONSENT_SCHEMA = "praxis.consent/1"
RETENTION_DAYS = 30
FPS = 15
SIZE = (640, 480)
PARTICIPANT_RE = re.compile(r"^p\d{2,3}$")
SHEET_BY_PIPELINE = {"nhpt": "nhpt_board", "cup": "cup_targets", "arm": "none"}
ARM_IDS = ("pendulum", "flexion", "abduction")
TARGET_REPS = 300
TARGET_PARTICIPANTS = 5


def coached() -> dict[str, Any]:
    """The camera-coached, *visible* registry entries: Arm out to the side, Waiter – cup and the
    NHPT (28 Sep lock). Hidden exercises and the demo-only rotations are never recorded."""
    from praxis_session.perception.exercises import EXERCISES

    return {k: ex for k, ex in EXERCISES.items() if ex.mode == "coached" and ex.pipeline and ex.visible}


def stamp(now: dt.datetime | None = None) -> str:
    return (now or dt.datetime.now()).strftime("%Y%m%dT%H%M%S")


def clip_id(participant: str, exercise: str, ts: str) -> str:
    return f"{participant}_{exercise}_{ts}"


def clip_paths(raw_dir: Path, participant: str, exercise: str, ts: str) -> dict[str, Path]:
    d = Path(raw_dir) / participant / exercise
    return {
        "dir": d,
        "video": d / f"{ts}.mp4",
        "sidecar": d / f"{ts}.json",
        "labels": d / f"{ts}.labels.json",
        "pred": d / f"{ts}.pred.json",
    }


def video_dir_is_private(d: Path) -> tuple[bool, str]:
    """May a clip be written into `d`? Only where git will never commit it: outside the
    repository, or on a git-ignored path inside it (`.gitignore`: evaluation/dataset_v*/** video).
    Asked of git itself (`git check-ignore --no-index`), so a .gitignore edit cannot silently
    turn the recorder into a way to commit video."""
    probe = Path(d).resolve() / "probe.mp4"
    if not probe.is_relative_to(ROOT.resolve()):
        return True, "outside the repository"
    try:
        r = subprocess.run(
            ["git", "check-ignore", "-q", "--no-index", str(probe)], cwd=ROOT, capture_output=True, timeout=10
        )
    except (OSError, subprocess.TimeoutExpired):
        ok = probe.is_relative_to(RAW_DIR.resolve())
        return ok, "git unavailable; " + ("inside the default raw dir" if ok else f"{d} is not the default raw dir")
    if r.returncode == 0:
        return True, "git-ignored"
    if r.returncode == 1:
        return False, (
            f"{d} is inside the repository and NOT git-ignored, so a clip there could be committed. "
            "Use the default --raw-dir (evaluation/dataset_v1/raw) or a folder outside the repository."
        )
    return True, "not a git checkout"


def check_participant(p: str) -> str:
    p = p.strip().lower()
    if not PARTICIPANT_RE.match(p):
        raise ValueError(f"participant must be a pseudonym like p01, got {p!r} (never a name)")
    return p


def check_exercise(e: str) -> str:
    e = e.strip()
    ok = coached()
    if e not in ok:
        raise ValueError(f"exercise must be one of {sorted(ok)} (hidden and demo-only exercises are never recorded)")
    return e


# ---- consent -----------------------------------------------------------------------------
def consent_record(
    participant: str,
    confirmation: str,
    today: dt.date | None = None,
    replay_demo: bool = False,
    recorded_by: str = "",
    consent_clips: bool = False,
) -> dict[str, Any]:
    """The participant (or their proxy) must have typed exactly `yes`; anything else refuses.
    `replay_demo` and `consent_clips` are separate, optional yeses (default no): the clip may run
    in the in-app Replay demo; still frames around the camera's misses may be kept as failure
    cases (git-ignored, deleted with the clip)."""
    if confirmation.strip().lower() != "yes":
        raise PermissionError("no consent: the participant did not type 'yes'; nothing is recorded")
    today = today or dt.date.today()
    return {
        "schema": CONSENT_SCHEMA,
        "participant": check_participant(participant),
        "consented_on": today.isoformat(),
        "delete_clips_after": (today + dt.timedelta(days=RETENTION_DAYS)).isoformat(),
        "retention_days": RETENTION_DAYS,
        "scope": (
            "Video of the listed exercises is recorded on this laptop for evaluating Praxis. "
            "Clips are never uploaded or committed and are deleted after 30 days or on request. "
            "Labels, events and metrics derived from them (no images) are kept."
        ),
        "replay_demo": bool(replay_demo),
        "consent_clips": bool(consent_clips),
        "confirmation": "yes",
        "recorded_by": recorded_by,
        "clips": [],
    }


def write_consent(record: dict[str, Any], consent_dir: Path = CONSENT_DIR) -> Path:
    """One file per participant per day; a later run the same day appends its clips."""
    consent_dir = Path(consent_dir)
    consent_dir.mkdir(parents=True, exist_ok=True)
    p = consent_dir / f"{record['participant']}_{record['consented_on']}.json"
    if p.exists():
        old = json.loads(p.read_text())
        record = {**record, "clips": sorted(set(old.get("clips", [])) | set(record.get("clips", [])))}
        for k in ("replay_demo", "consent_clips"):  # the most careful answer of the day wins
            record[k] = bool(record.get(k) and old.get(k, True))
    p.write_text(json.dumps(record, indent=1) + "\n")
    return p


def add_clip_to_consent(consent_path: Path, cid: str) -> None:
    rec = json.loads(Path(consent_path).read_text())
    rec["clips"] = sorted(set(rec.get("clips", [])) | {cid})
    Path(consent_path).write_text(json.dumps(rec, indent=1) + "\n")


# ---- sidecar -----------------------------------------------------------------------------
def build_sidecar(
    participant: str,
    exercise: str,
    ts: str,
    side: str,
    consent: dict[str, Any],
    consent_file: str,
    *,
    view: str | None = None,
    camera_note: str = "",
    lighting: str = "",
    device: str = "",
    fps: float = FPS,
    fps_measured: float | None = None,
    frames: int = 0,
    size: tuple[int, int] = SIZE,
    planned_errors: list[str] | None = None,
    notes: str = "",
) -> dict[str, Any]:
    import cv2

    ex = coached()[check_exercise(exercise)]
    if side not in ("left", "right"):
        raise ValueError("side must be left or right")
    return {
        "schema": SIDECAR_SCHEMA,
        "dataset": DATASET_VERSION,
        "clip_id": clip_id(participant, exercise, ts),
        "participant": check_participant(participant),
        "exercise": exercise,
        "pipeline": ex.pipeline,
        "sheet": SHEET_BY_PIPELINE[ex.pipeline],
        "side": side,
        "view": view or ex.view,
        "camera_note": camera_note,
        "lighting": lighting,
        "device": device,
        "cv2_version": cv2.__version__,
        "fps": fps,
        "fps_measured": fps_measured,
        "frames": frames,
        "width": size[0],
        "height": size[1],
        "recorded_at": ts,
        "synthetic": False,
        "consent": {
            "file": consent_file,
            "consented_on": consent["consented_on"],
            "delete_after": consent["delete_clips_after"],
            "replay_demo": bool(consent.get("replay_demo", False)),
            "consent_clips": bool(consent.get("consent_clips", False)),
        },
        "planned_errors": list(planned_errors or []),
        "notes": notes,
        "clip_deleted_on": None,
    }


# ---- discovery ---------------------------------------------------------------------------
@dataclass
class Clip:
    sidecar_path: Path
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def stem(self) -> Path:
        return self.sidecar_path.with_suffix("")

    @property
    def id(self) -> str:
        return str(self.meta.get("clip_id") or self.stem.name)

    @property
    def participant(self) -> str:
        return str(self.meta.get("participant", "?"))

    @property
    def exercise(self) -> str:
        return str(self.meta.get("exercise", "?"))

    @property
    def pipeline(self) -> str:
        return str(self.meta.get("pipeline") or ("arm" if self.exercise in ARM_IDS else self.exercise))

    @property
    def view(self) -> str:
        return str(self.meta.get("view", "?"))

    @property
    def video(self) -> Path:
        return self.stem.with_suffix(".mp4")

    @property
    def labels_path(self) -> Path:
        return self.stem.with_suffix(".labels.json")

    @property
    def pred_path(self) -> Path:
        return self.stem.with_suffix(".pred.json")

    @property
    def synthetic(self) -> bool:
        return bool(self.meta.get("synthetic", False))

    def delete_after(self) -> dt.date | None:
        d = (self.meta.get("consent") or {}).get("delete_after")
        return dt.date.fromisoformat(d) if d else None

    def expired(self, today: dt.date | None = None) -> bool:
        d = self.delete_after()
        return d is None or (today or dt.date.today()) >= d

    def consented(self, today: dt.date | None = None) -> bool:
        """A clip may be read only with a consent record that has not expired."""
        return bool((self.meta.get("consent") or {}).get("file")) and not self.expired(today)

    @property
    def side(self) -> str:
        return str(self.meta.get("side") or "left")

    def consent_clips(self, today: dt.date | None = None) -> bool:
        """Failure-case frames may be cut from this clip only with that separate yes, while the
        clip's consent holds and the clip still exists."""
        c = self.meta.get("consent") or {}
        return bool(c.get("consent_clips")) and self.consented(today) and not self.meta.get("clip_deleted_on")

    def labels(self) -> dict[str, Any] | None:
        return json.loads(self.labels_path.read_text()) if self.labels_path.exists() else None


def discover(raw_dir: Path = RAW_DIR) -> list[Clip]:
    raw_dir = Path(raw_dir)
    if not raw_dir.exists():
        return []
    out = []
    for p in sorted(raw_dir.glob("*/*/*.json")):
        if p.name.endswith((".labels.json", ".pred.json")):
            continue
        try:
            meta = json.loads(p.read_text())
        except ValueError:
            continue
        if meta.get("schema") == SIDECAR_SCHEMA:
            out.append(Clip(p, meta))
    return out


# ---- labels ------------------------------------------------------------------------------
def load_label_schema() -> dict[str, Any]:
    return json.loads(LABEL_SCHEMA_PATH.read_text())


def validate_labels(d: dict[str, Any]) -> list[str]:
    """Schema errors plus the checks a schema cannot express. Empty list = valid."""
    import jsonschema

    v = jsonschema.Draft202012Validator(load_label_schema())
    errs = [f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message}" for e in v.iter_errors(d)]
    if errs:
        return errs
    for r in d["reps"]:
        if r["t_end"] < r["t_start"]:
            errs.append(f"rep {r['rep']}: t_end < t_start")
        if r["expected"] == "unverified" and not r.get("reason") and not r.get("deliberate_error"):
            errs.append(f"rep {r['rep']}: unverified needs a reason")
    if d["exercise"] == "nhpt" and "nhpt" in d:
        n = d["nhpt"]
        if abs((n["t_end"] - n["t_start"]) - n["total_s"]) > 0.05:
            errs.append("nhpt: total_s != t_end - t_start")
    return errs


def label_warnings(d: dict[str, Any]) -> list[str]:
    """Plausibility checks that do not block saving (a real session can be odd)."""
    out: list[str] = []
    reps = d.get("reps", [])
    if d.get("exercise") == "nhpt":
        holes = [r.get("hole") for r in reps]
        dup = sorted({h + 1 for h in holes if h is not None and holes.count(h) > 1})
        if dup:
            out.append(f"NHPT hole(s) {dup} used twice: did you press 1-9 on every rep?")
        if len(reps) != 9:
            out.append(f"NHPT has {len(reps)} reps, a full trial has 9")
    if d.get("exercise") == "cup":
        for a, b in zip(reps, reps[1:]):
            if a.get("to_dot") == b.get("to_dot"):
                out.append(f"cup reps {a['rep']} and {b['rep']} end on the same dot: did you press 1-5?")
    if d.get("exercise") == "abduction" and reps and all(r.get("peak_deg_goniometer") is None for r in reps):
        out.append("no goniometer readings: the peak-angle error cannot be computed for this clip")
    return out


def nhpt_block(reps: list[dict[str, Any]]) -> dict[str, float] | None:
    """The product's NHPT timer: first peg lifted -> ninth peg seated."""
    if not reps:
        return None
    t0 = min(r["t_start"] for r in reps)
    seated = sorted(r["t_end"] for r in reps)
    t1 = seated[min(8, len(seated) - 1)]
    return {"t_start": round(t0, 3), "t_end": round(t1, 3), "total_s": round(t1 - t0, 3)}


# ---- deletion ----------------------------------------------------------------------------
def _delete_clip(c: Clip, today: dt.date, reason: str, failure_dir: Path, dry_run: bool) -> dict[str, Any]:
    removed = []
    targets = [c.video] if c.video.exists() else []
    targets += sorted(c.video.parent.glob(c.video.stem + ".part.*"))  # an interrupted recording
    frames_dir = Path(failure_dir) / c.id  # failure-case JPEGs (eval.py)
    if frames_dir.is_dir():
        targets.append(frames_dir)
    for t in targets:
        removed.append(str(t))
        if not dry_run:
            shutil.rmtree(t) if t.is_dir() else t.unlink()
    if not dry_run and (targets or not c.meta.get("clip_deleted_on")):
        c.meta["clip_deleted_on"] = today.isoformat()
        c.meta["clip_deleted_reason"] = reason
        c.sidecar_path.write_text(json.dumps(c.meta, indent=1) + "\n")
    return {"clip_id": c.id, "reason": reason, "removed": removed}


def purge_expired(
    raw_dir: Path = RAW_DIR,
    today: dt.date | None = None,
    dry_run: bool = False,
    failure_dir: Path = FAILURE_DIR,
) -> list[dict[str, Any]]:
    """Delete every clip (and its failure-case excerpts) whose 30 days are up. Sidecars, labels
    and cached events stay, stamped with the deletion date."""
    today = today or dt.date.today()
    out = []
    for c in discover(raw_dir):
        if c.expired(today) and (c.video.exists() or not c.meta.get("clip_deleted_on")):
            out.append(_delete_clip(c, today, "retention_30_days", failure_dir, dry_run))
    return out


def withdraw(
    participant: str,
    raw_dir: Path = RAW_DIR,
    today: dt.date | None = None,
    dry_run: bool = False,
    failure_dir: Path = FAILURE_DIR,
    remove_derived: bool = False,
) -> list[dict[str, Any]]:
    """Consent withdrawn: delete that participant's clips now. `remove_derived` also removes
    their sidecars, labels and cached events so none of their data is used."""
    p = check_participant(participant)
    today = today or dt.date.today()
    out = []
    for c in discover(raw_dir):
        if c.participant != p:
            continue
        out.append(_delete_clip(c, today, "consent_withdrawn", failure_dir, dry_run))
    if remove_derived and not dry_run and (Path(raw_dir) / p).exists():
        shutil.rmtree(Path(raw_dir) / p)
    return out


# ---- manifest + status -------------------------------------------------------------------
def _rel(p: Path, base: Path) -> str:
    try:
        return str(p.resolve().relative_to(Path(base).resolve()))
    except ValueError:
        return str(p.resolve())


def manifest_entry(c: Clip, dataset_dir: Path, today: dt.date | None = None) -> dict[str, Any]:
    """One eval.py entry for a real clip. Paths are relative to `dataset_dir`."""
    return {
        "id": c.id,
        "exercise": c.exercise,
        "mode": c.pipeline,
        "sheet": SHEET_BY_PIPELINE.get(c.pipeline, "none"),
        "video": _rel(c.video, dataset_dir),
        "labels": _rel(c.labels_path, dataset_dir),
        "pred": _rel(c.pred_path, dataset_dir),
        "synthetic": False,
        "participant": c.participant,
        "side": c.side,
        "view": c.view,
        "fps": c.meta.get("fps", FPS),
        "consent_clips": c.consent_clips(today),
        "delete_after": (c.meta.get("consent") or {}).get("delete_after"),
        "clip_deleted_on": c.meta.get("clip_deleted_on"),
        "planned_errors": list(c.meta.get("planned_errors") or []),
    }


def build_manifest(raw_dir: Path = RAW_DIR, dataset_dir: Path = DATASET_DIR, today: dt.date | None = None) -> dict[str, Any]:
    """Every clip with a complete, valid labels file becomes an entry; every other clip is listed
    under `skipped` with the reason, so nothing disappears silently."""
    entries, skipped = [], []
    for c in discover(raw_dir):
        if c.synthetic:
            skipped.append({"id": c.id, "reason": "sidecar says synthetic (dataset_v1 holds real recordings)"})
            continue
        if c.exercise not in coached():
            skipped.append({"id": c.id, "reason": f"exercise {c.exercise!r} is not one of the three"})
            continue
        lab = c.labels()
        if lab is None:
            skipped.append({"id": c.id, "reason": "not labelled yet (tools/label_clip.py)"})
            continue
        errs = validate_labels(lab)
        if errs:
            skipped.append({"id": c.id, "reason": "labels invalid: " + "; ".join(errs[:3])})
            continue
        if not lab.get("complete"):
            skipped.append({"id": c.id, "reason": "labels not marked complete (press c in label_clip, then w)"})
            continue
        if not c.video.exists() and not c.pred_path.exists():
            skipped.append({"id": c.id, "reason": "clip deleted before eval.py cached its events: cannot be scored"})
            continue
        entries.append(manifest_entry(c, dataset_dir, today))
    return {"version": DATASET_VERSION, "entries": entries, "skipped": skipped}


def write_manifest(raw_dir: Path = RAW_DIR, dataset_dir: Path = DATASET_DIR, today: dt.date | None = None) -> tuple[Path, dict[str, Any]]:
    m = build_manifest(raw_dir, dataset_dir, today)
    out = Path(dataset_dir) / "manifest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(m, indent=1) + "\n")
    return out, m


def status(raw_dir: Path = RAW_DIR) -> dict[str, Any]:
    """Progress towards the dataset target: clips, labelled reps and participants per exercise."""
    per: dict[str, dict[str, Any]] = {k: {"clips": 0, "labelled_clips": 0, "reps": 0, "participants": set()} for k in coached()}
    people: set[str] = set()
    for c in discover(raw_dir):
        if c.exercise not in per or c.synthetic:
            continue
        row = per[c.exercise]
        row["clips"] += 1
        lab = c.labels()
        if lab and lab.get("complete") and not validate_labels(lab):
            row["labelled_clips"] += 1
            row["reps"] += len(lab["reps"])
            row["participants"].add(c.participant)
            people.add(c.participant)
    total = sum(r["reps"] for r in per.values())
    return {
        "per_exercise": {k: {**v, "participants": sorted(v["participants"])} for k, v in per.items()},
        "labelled_reps": total,
        "participants": sorted(people),
        "target_reps": TARGET_REPS,
        "target_participants": TARGET_PARTICIPANTS,
        "target_met": total >= TARGET_REPS and len(people) >= TARGET_PARTICIPANTS,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="dataset_v1.py",
        description="Dataset v1 bookkeeping: progress, label validation and the manifest eval.py reads. "
        "Run from services/session with `uv run python tools/dataset_v1.py <command>`.",
    )
    ap.add_argument("--raw-dir", default=str(RAW_DIR), help="where record_session.py wrote the clips (default: %(default)s)")
    ap.add_argument("--dataset-dir", default=str(DATASET_DIR), help="where manifest.json is written (default: %(default)s)")
    sub = ap.add_subparsers(dest="cmd", required=True, metavar="{status,validate,manifest}")
    sub.add_parser("status", help="clips and labelled reps per exercise; progress to 300 reps / 5 people")
    sub.add_parser("validate", help="check every labels file against evaluation/labels.schema.json")
    sub.add_parser("manifest", help="write dataset_v1/manifest.json (clips with complete, valid labels only)")
    args = ap.parse_args(argv)
    raw = Path(args.raw_dir)
    if args.cmd == "status":
        s = status(raw)
        print(f"{'exercise':<12}{'clips':>7}{'labelled':>10}{'reps':>7}  participants")
        for k, v in s["per_exercise"].items():
            print(f"{k:<12}{v['clips']:>7}{v['labelled_clips']:>10}{v['reps']:>7}  {', '.join(v['participants']) or '-'}")
        print(
            f"\nlabelled reps {s['labelled_reps']} / {s['target_reps']} · participants "
            f"{len(s['participants'])} / {s['target_participants']} · {'TARGET MET' if s['target_met'] else 'keep recording'}"
        )
        return 0
    if args.cmd == "validate":
        bad = 0
        for c in discover(raw):
            lab = c.labels()
            if lab is None:
                print(f"{c.id}: not labelled yet")
                continue
            errs = validate_labels(lab)
            bad += bool(errs)
            print(f"{c.id}: {'; '.join(errs) if errs else 'OK'}{'' if lab.get('complete') else ' (not marked complete)'}")
        return 1 if bad else 0
    out, m = write_manifest(raw, Path(args.dataset_dir))
    print(f"wrote {out}: {len(m['entries'])} entries, {len(m['skipped'])} skipped")
    for s in m["skipped"]:
        print(f"  skipped {s['id']}: {s['reason']}")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # praxis_session from services/session
    sys.exit(main())
