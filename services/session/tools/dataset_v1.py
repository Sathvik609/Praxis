"""Dataset v1 (real recordings): layout, sidecars, consent, label schema, discovery, deletion.

Shared by `tools/record_session.py`, `tools/label_clip.py`, `evaluation/scripts/eval.py` and
`evaluation/scripts/failure_cases.py` so the four agree on one layout
(OpenCV cv2.__version__ == 5.0.0 does the capture and playback in those tools):

    evaluation/dataset_v1/
      consent/<participant>_<YYYY-MM-DD>.json        consent record (pseudonym, dates) - committed
      raw/<participant>/<exercise>/<ts>.mp4          the clip - git-ignored, deleted after 30 days
      raw/<participant>/<exercise>/<ts>.json         sidecar (who/what/how recorded) - committed
      raw/<participant>/<exercise>/<ts>.labels.json  ground truth (labels.schema.json) - committed
      raw/<participant>/<exercise>/<ts>.pred.json    pipeline events cached by eval.py - committed

Only pseudonyms (p01, p02, ...) ever appear here; the key from pseudonym to person stays on
paper with the team lead. Video never leaves the laptop it was recorded on. After deletion the
committed `.pred.json` (events only, no pixels) keeps every number regenerable.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import shutil
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


def coached() -> dict[str, Any]:
    """The five camera-coached registry entries (demo-only rotations can never be scored)."""
    from praxis_session.perception.exercises import EXERCISES

    return {k: ex for k, ex in EXERCISES.items() if ex.mode == "coached"}


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


def check_participant(p: str) -> str:
    p = p.strip().lower()
    if not PARTICIPANT_RE.match(p):
        raise ValueError(f"participant must be a pseudonym like p01, got {p!r} (never a name)")
    return p


def check_exercise(e: str) -> str:
    e = e.strip()
    ok = coached()
    if e not in ok:
        raise ValueError(f"exercise must be one of {sorted(ok)} (demo-only rotations are never recorded)")
    return e


# ---- consent -----------------------------------------------------------------------------
def consent_record(
    participant: str,
    confirmation: str,
    today: dt.date | None = None,
    replay_demo: bool = False,
    recorded_by: str = "",
) -> dict[str, Any]:
    """The participant (or their proxy) must have typed exactly `yes`; anything else refuses."""
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
        record["replay_demo"] = bool(record["replay_demo"] and old.get("replay_demo", True))
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
    clips_dir = Path(failure_dir) / "clips"
    if clips_dir.exists():
        targets += sorted(clips_dir.glob(f"{c.id}__*"))
    for t in targets:
        removed.append(str(t))
        if not dry_run:
            t.unlink()
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
