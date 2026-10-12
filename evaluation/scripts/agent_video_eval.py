"""The agent coach on REAL video: REHAB24-6 Ex1 (sideways arm raise) through the product's
pipeline, stop rules, rule coach and agent, scored against labels the agent never sees
(OpenCV cv2.__version__ == 5.0.0 for every frame decode, resize, JPEG round-trip and the
`cv2.dnn` pose model).

    cd services/session
    uv run python tools/fetch_rehab24.py                                         # once, git-ignored
    uv run python ../../evaluation/scripts/agent_video_eval.py --planner rule      # baseline, free
    uv run python ../../evaluation/scripts/agent_video_eval.py --planner scripted  # fixed script, free
    uv run --env-file .env python ../../evaluation/scripts/agent_video_eval.py --planner anthropic --repeat 2 --yes

**What runs** (one case = one session). Each recording is decoded with `cv2.VideoCapture`,
every 2nd frame taken (15 fps), scaled to 640 px and JPEG round-tripped (`rehab24_eval`'s
`to_product_frame`), then passed frame by frame to the same `SessionPipeline` + `CoachSession`
(stop rules, rule coach) + `AgentCoach` (Strands + Claude via the Anthropic API, tools over the
service's streamable-HTTP MCP routes) that the live and Replay sockets build; the session is
flagged as a replay. Agent runs are background tasks exactly as live: while one is in flight
the frames are paced at real time (the agent sees the session move on), otherwise they run as
fast as the CPU allows (nothing time-dependent happens between runs). The agent's intents are
drained after every frame; the rule coach's pipeline commands are applied.

**Prescription.** The seed prescription for Arm out to the side (target 90°, ceiling 90°,
hold 3 s, the same allowed target/hold ranges) with two changes to fit the recordings: the
right arm, and **2 sets of 5** (allowed reps 4–5), because each recording is 5 correct
repetitions followed by 5 the physiotherapist asked to be done wrongly: set 1 is mostly the
correct block, set 2 the incorrect one.

**Simulated patient** (the frames are real, the patient's taps are simulated and the same for
every planner): check-in pain 2; declines every dose prompt ("Keep": the video cannot change);
accepts a resume prompt; taps Resume on a setup pause once the camera's view gate has been open
for 3 s. Induced cases only: the patient fixes the framing when told (agent: at its
`recalibrate`, i.e. after its spoken fix; rule-only: 4 s after the pause text, which already
names the fix).

**Cases**
- `review` (9): every Camera17 recording with front-view repetitions (8 subjects). Both set
  reviews are scored. Five recordings turn to half-profile after the front block: the session
  runs 20 s into the turn, a **real** setup failure (the view gate closes, `pause:setup`).
- `setup_real` (8): the four Camera17 half-profile-only recordings and four Camera18 recordings
  (subject side-on), first 25 s: a real wrong-view setup from the first frame.
- `setup_induced` (3): front-view recordings with the frame **cropped at 80 % of the way from the
  shoulders to the hips** from the end of the 5th labelled repetition (an induced perturbation of
  real video: the camera tilted up, hips out of view; mocap 2D joints place the crop line).

**Ground truth** (never shown to the agent) per set, from the matched labelled repetitions:
REHAB24-6's physiotherapist correct/incorrect label, and from motion capture: peak anatomical
abduction (`ref_frontal`) above 100° (overshoot of the 90° ceiling), longest continuous time at
≥ 85° (hold < 2.5 s = no hold), peak below 85° (short), shoulder hike by the product's own
definition (`rep_hiked`: mocap shoulder rise over the rest baseline, in trunk lengths, above
`arm_fsm.hike_allowance` of the mocap arm angle at the same frame, for the product's
`HIKE_PERSIST_FRAMES` scored frames in a row), trunk lean change above 12° (the lean stop
threshold), and two faults a front-view shoulder angle cannot see: elbow bent (< 150° at the
peak) and arm lifted forward of the side (plane > 25°). Setup truth: the labelled orientation
(half-profile / side needs "face the camera"), or the crop (hips out of view).

**Scores**: a set review *addresses a true fault* when the agent corrects or regresses and one of
its claims (regex classes over what it said or proposed: overshoot, hold, short, hike, lean)
is true by mocap; a claim of a class that mocap says is false, or of elbow/forward faults the
camera cannot measure, is *unsupported*; proposals must stay inside the allowed adaptations and
never progress a faulty set; every action needs a perception tool earlier in its run and
evidence ids from this session (from this set for corrections). Setup: the specific fix named;
no resume prompt while the setup still fails; a camera-checked resume after the fix (induced).
Results `evaluation/results/agent_video_v0.{md,json}` (or `_<planner>` for the baselines);
anthropic traces in `traces/agent/video/<model>/`.
"""
from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import logging
import math
import os
import re
import shutil
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "services" / "session"))
sys.path.insert(0, str(HERE.parent))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import agent_eval as AE  # noqa: E402
import rehab24_eval as R  # noqa: E402
from praxis_session.agent import tools as T  # noqa: E402
from praxis_session.agent.metrics import AgentMetrics  # noqa: E402
from praxis_session.agent.model import AGENT_LABELS, DEFAULT_MODEL, ScriptedPlanner, StrandsPlanner, base_model, cost_usd, load_config, price_for  # noqa: E402
from praxis_session.coach.agent import AgentCoach  # noqa: E402
from praxis_session.events import Event, make_event  # noqa: E402
from praxis_session.perception.arm_fsm import HIKE_MARGIN, HIKE_PERSIST_FRAMES, hike_allowance  # noqa: E402
from praxis_session.pipeline import SessionPipeline  # noqa: E402
from praxis_session.prescription import SEED_PRESCRIPTION  # noqa: E402
from praxis_session.session import RULE_LABEL_WITH_AGENT, CoachSession  # noqa: E402

RESULTS = ROOT / "evaluation" / "results"
TRACES = ROOT / "traces" / "agent" / "video"
FPS = 30.0
STRIDE = R.STRIDE
SETS, REPS = 2, 5
CROP_FRAC = 0.8
OVERSHOOT_DEG = 100.0  # 90° ceiling + 10° (rehab24_eval IN_RANGE_DEG)
HOLD_MIN_S = 2.5  # 3 s prescribed hold, 0.5 s tolerance
HOLD_LEVEL_DEG = 85.0
SHORT_DEG = 85.0
ELBOW_BENT_DEG = 150.0
PLANE_FORWARD_DEG = 25.0
REVIEW = ("PM_000", "PM_001", "PM_012", "PM_023", "PM_032", "PM_039", "PM_122", "PM_109", "PM_114")
SETUP_C17 = ("PM_002", "PM_016", "PM_024", "PM_101")
SETUP_C18 = ("PM_000", "PM_001", "PM_012", "PM_023")
INDUCED = ("PM_012", "PM_023", "PM_109")
SETUP_SECONDS = 25.0
TURN_SECONDS = 20.0
# Per-run estimate for the cost print (real runs on 12 Oct: ~30k input tokens, ~90 % from cache).
EST_INPUT_TOKENS_PER_RUN = 32_000
EST_OUTPUT_TOKENS_PER_RUN = 900

EVAL_RX = SEED_PRESCRIPTION.model_copy(deep=True)
EVAL_RX.side = "right"
EVAL_RX.exercises["abduction"] = {**EVAL_RX.exercises["abduction"], "sets": SETS, "reps": REPS}
EVAL_RX.allowed_adaptations["abduction"] = {**EVAL_RX.allowed_adaptations["abduction"], "reps": [4, 5]}

# ---- what the coach claimed (regex classes over what it said or proposed) -------------------
CLAIMS: dict[str, re.Pattern[str]] = {
    "overshoot": re.compile(r"shoulder (height|level)|no higher|not (go |lift |raise )?(any )?higher|above (your )?shoulder|too high|past (the |your )?(line|shoulder|target)|stop at|\b90\b|over the line|higher than", re.I),
    "hold": re.compile(r"\bhold", re.I),
    "hike": re.compile(r"shrug|hik|shoulder (down|drop|relaxed|low)|drop (your|the) shoulder|relax (your|the) shoulder|let the shoulder", re.I),
    "lean": re.compile(r"\blean|\btilt", re.I),
    "elbow": re.compile(r"elbow|\bbend|\bbent|straight arm|arm straight", re.I),
    "forward": re.compile(r"in front|forward", re.I),
}
OBSERVABLE = ("overshoot", "hold", "short", "hike", "lean")
UNMEASURED = ("elbow", "forward")
FIX_TURN = re.compile(r"\bfac(e|ing)\b|turn|toward|towards|front", re.I)
FIX_HIPS = re.compile(r"\bhips?\b|move (the )?camera|camera (back|down)|step back|further back|back a (little|bit)|lower the camera|tilt the camera", re.I)


SHORT_EXPLICIT = re.compile(r"fell short|stopped short|didn'?t reach|short of (the )?(line|target|mark|90)|not (high|far) enough|below the (line|target)", re.I)
SHORT_LIFT = re.compile(r"\b(reach|lift|rais|go|get)\w*\b[^.,;!?]{0,25}\b(higher|further|all the way)\b|up to the line", re.I)
SHORT_NEGATED = re.compile(r"\b(no|not|don'?t|never|no need to)\b[^.,;!?]{0,20}\bhigher\b|higher than (needed|necessary|you need|the line|shoulder|90)", re.I)


def claims_in(text: str) -> set[str]:
    """Claim classes in what the coach said or proposed. "Short" (fell short of the target) is
    read per sentence: "short of 3 seconds" is a hold claim, and "no need to go higher" or
    "higher than needed" is the overshoot fix (12 Oct, corrected after the first real run)."""
    out = {k for k, rx in CLAIMS.items() if k != "short" and rx.search(text or "")}
    for sentence in re.split(r"(?<=[.!?])\s+", text or ""):
        if SHORT_EXPLICIT.search(sentence) or (SHORT_LIFT.search(sentence) and not SHORT_NEGATED.search(sentence)):
            out.add("short")
    return out


# ---- ground truth from motion capture --------------------------------------------------------
def rep_hiked(rise: np.ndarray, angle_deg: np.ndarray) -> tuple[bool, float | None]:
    """Shoulder hike in one repetition by the product's definition, on motion capture.

    The product (`ArmFSM`, 12 Oct) flags per scored frame: hike over its rest baseline above
    `hike_allowance(angle)` at *that frame's* arm angle, and only after `HIKE_PERSIST_FRAMES`
    consecutive frames over it. A per-rep form (peak rise against the allowance at the peak
    angle) would not match: the shoulder can rise most on the way up or down, at a smaller angle
    with a smaller allowance. So the truth is per frame too: `rise` (mocap shoulder rise over the
    rest baseline, trunk lengths) against `hike_allowance` of the mocap anatomical angle
    (`ref_frontal`, which the product's scored angle tracks) at the same 30 fps frame, persisting
    `HIKE_PERSIST_FRAMES * STRIDE` mocap frames (the same ~0.2 s as 3 scored frames at 15 fps); a
    missing mocap frame breaks the run. Returns (hiked, largest excess over the allowance)."""
    rise, angle = np.asarray(rise, np.float64), np.asarray(angle_deg, np.float64)
    ok = np.isfinite(rise) & np.isfinite(angle)
    if not ok.any():
        return False, None
    allow = np.array([hike_allowance(a) if np.isfinite(a) else np.inf for a in angle])
    over = ok & (rise > allow)
    run = best = 0
    for v in over:
        run = run + 1 if v else 0
        best = max(best, run)
    excess = float(np.max(np.where(ok, rise - allow, -np.inf)))
    return best >= HIKE_PERSIST_FRAMES * STRIDE, round(excess, 3)


def rep_truth(vid: str) -> list[dict[str, Any]]:
    """Per labelled repetition: physio label, camera orientations, mocap peak, hold, rise,
    lean change, elbow and plane at the peak. Joint files are 30 fps, frame-indexed like video."""
    recs = {r.video_id: r for r in R.load_segmentation(R.DATA_DIR / "Segmentation.csv")}
    rec = recs[vid]
    j3 = np.load(R.DATA_DIR / "3d_joints" / "Ex1" / f"{vid}-30fps.npy")
    p = j3[..., :3].astype(float)
    refs = R.ref_angles_3d(j3)
    J = R.J
    sh, el, ha = p[:, J["RightArm"]], p[:, J["RightForeArm"]], p[:, J["RightHand"]]
    elbow = R.angle_between(sh - el, ha - el)
    neck, hipm = p[:, J["Neck"]], (p[:, J["LeftUpLeg"]] + p[:, J["RightUpLeg"]]) / 2
    trunk = neck - hipm
    lean = R.angle_between(trunk, np.broadcast_to(np.array([0.0, 1.0, 0.0]), trunk.shape))
    lr = p[:, J["LeftArm"]] - sh
    arm = el - sh
    armh, lrh = arm.copy(), lr.copy()
    armh[:, 1] = 0
    lrh[:, 1] = 0
    plane = R.angle_between(armh, -lrh)
    first = rec.reps[0]["first"]
    rest = slice(max(0, first - 30), max(1, first))
    lean0 = float(np.nanmedian(lean[rest])) if np.isfinite(lean[rest]).any() else float(np.nanmedian(lean[:30]))
    rise0 = float(np.nanmedian(refs["shoulder_rise"][rest])) if np.isfinite(refs["shoulder_rise"][rest]).any() else 0.0
    out = []
    for rp in rec.reps:
        a, b = rp["first"], min(rp["last"], len(p) - 1)
        seg = refs["ref_frontal"][a: b + 1]
        k = a + int(np.nanargmax(seg))
        above = np.nan_to_num(seg, nan=0.0) >= HOLD_LEVEL_DEG
        run = best = 0
        for v in above:
            run = run + 1 if v else 0
            best = max(best, run)
        out.append({
            "rep": rp["rep"], "t0": a / FPS, "t1": b / FPS, "correct": rp["correct"], "orientation_c17": rp["orientation"],
            "peak_deg": round(float(np.nanmax(seg)), 1), "hold_s": round(best / FPS, 2),
            "rise": round(float(np.nanmax(refs["shoulder_rise"][a: b + 1]) - rise0), 3),
            **dict(zip(("hike", "hike_excess"), rep_hiked(refs["shoulder_rise"][a: b + 1] - rise0, seg))),
            "lean_change_deg": round(float(np.nanmax(np.abs(lean[a: b + 1] - lean0))), 1),
            "elbow_deg": round(float(elbow[k]), 1), "plane_deg": round(float(plane[k]), 1),
        })
    return out


def set_truth(reps: list[dict[str, Any]]) -> dict[str, Any]:
    """Majority facts over the labelled repetitions matched to one set."""
    n = len(reps)

    def most(pred: Callable[[dict[str, Any]], bool]) -> bool:
        return n > 0 and sum(1 for r in reps if pred(r)) * 2 > n

    return {
        "labelled_reps": n,
        "physio_incorrect": sum(1 for r in reps if not r["correct"]),
        "overshoot": most(lambda r: r["peak_deg"] > OVERSHOOT_DEG),
        "hold": most(lambda r: r["hold_s"] < HOLD_MIN_S),  # true = the hold fault is present
        "short": most(lambda r: r["peak_deg"] < SHORT_DEG),
        "hike": most(lambda r: bool(r["hike"])),
        "lean": most(lambda r: r["lean_change_deg"] > EVAL_RX.stop_rules.lean_deg),
        "elbow": most(lambda r: r["elbow_deg"] < ELBOW_BENT_DEG),
        "forward": most(lambda r: r["plane_deg"] > PLANE_FORWARD_DEG),
        "peak_deg_median": float(np.median([r["peak_deg"] for r in reps])) if reps else None,
    }


# ---- cases -----------------------------------------------------------------------------------
def build_cases(only: list[str] | None = None) -> list[dict[str, Any]]:
    recs = {r.video_id: r for r in R.load_segmentation(R.DATA_DIR / "Segmentation.csv")}
    cases: list[dict[str, Any]] = []
    for vid in REVIEW:
        rec = recs[vid]
        front = [rp for rp in rec.reps if rp["orientation"] == "front"]
        later = [rp for rp in rec.reps if rp["orientation"] != "front" and rp["first"] > front[-1]["last"]]
        end = (later[0]["first"] / FPS + TURN_SECONDS) if later else (front[-1]["last"] / FPS + 2.0)
        cases.append({"id": f"review-{vid}", "kind": "review", "video": vid, "camera": "c17", "end_s": round(end, 1), "turn_at_s": round(front[-1]["last"] / FPS, 1) if later else None, "person": rec.person})
    for vid in SETUP_C17:
        cases.append({"id": f"setup-{vid}-c17", "kind": "setup_real", "video": vid, "camera": "c17", "end_s": SETUP_SECONDS, "view": "half-profile", "person": recs[vid].person})
    for vid in SETUP_C18:
        cases.append({"id": f"setup-{vid}-c18", "kind": "setup_real", "video": vid, "camera": "c18", "end_s": SETUP_SECONDS, "view": "side", "person": recs[vid].person})
    for vid in INDUCED:
        rec = recs[vid]
        front = [rp for rp in rec.reps if rp["orientation"] == "front"]
        cases.append({"id": f"induced-hips-{vid}", "kind": "setup_induced", "video": vid, "camera": "c17", "crop_from_s": round(front[4]["last"] / FPS + 0.5, 1), "end_s": round(front[-1]["last"] / FPS + 2.0, 1), "person": rec.person})
    return [c for c in cases if not only or c["id"] in only]


def crop_line(vid: str) -> int:
    """Rows kept from the top: 80 % of the way from the shoulders down to the hips (median over
    the recording of the projected mocap joints, Camera17, original pixels)."""
    j2d = np.load(R.DATA_DIR / "2d_joints" / "Ex1" / f"{vid}-c17-30fps.npy")
    hip = float(np.nanmedian((j2d[:, R.J["LeftUpLeg"], 1] + j2d[:, R.J["RightUpLeg"], 1]) / 2))
    sh = float(np.nanmedian(j2d[:, R.J["RightArm"], 1]))
    return int(sh + CROP_FRAC * (hip - sh))


# ---- one session -----------------------------------------------------------------------------
class Log:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def add(self, evs: list[Event], tag: str) -> None:
        for e in evs:
            if e.type != "frame":
                self.events.append(e.to_dict() | {"_tag": tag})


class Recording:
    """Wraps a planner and records which checkpoint (trigger, evidence ids) each run served, so
    a set review or a pause is scored against the run that answered it."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner
        self.served: dict[int, dict[str, Any]] = {}

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    async def run(self, ctx: Any) -> Any:
        rid = getattr(ctx.handle.run, "id", None)
        if rid is not None:
            self.served[rid] = {"trigger": ctx.trigger, "evidence": list(ctx.evidence), "also": list(ctx.also)}
        return await self.inner.run(ctx)


def make_planner(kind: str, http_url: str | None, registry: T.Registry) -> Recording:
    if kind == "scripted":
        return Recording(ScriptedPlanner(transport="mcp", mcp_url=http_url))  # the product's DEFAULT_SCRIPT
    cfg = load_config({**os.environ, "PRAXIS_AGENT": "anthropic"})
    return Recording(StrandsPlanner(dataclasses.replace(cfg, mcp_url=http_url or cfg.mcp_url)))


def run_for(res: dict[str, Any], event_id: int) -> int | None:
    """The agent run whose checkpoint evidence included `event_id`."""
    served = res.get("served") or {}
    return next((rid for rid, v in sorted(served.items()) if event_id in v["evidence"]), None)


async def run_case(case: dict[str, Any], planner_kind: str, trace_dir: Path, registry: T.Registry, http_url: str | None, rep_idx: int) -> dict[str, Any]:
    sid = f"video-{case['id']}-r{rep_idx}"
    p = SessionPipeline(mode="arm", sheet="none", use_hand=False, side="right", exercise="abduction", sets=SETS, reps=REPS, prescription=EVAL_RX)
    if p._pose is None:
        raise RuntimeError("pose model missing: run `uv run python tools/fetch_models.py`")
    rule_only = planner_kind == "rule"
    kw = {} if rule_only else {"rule_label": RULE_LABEL_WITH_AGENT}
    s = CoachSession(mode="arm", prescription=EVAL_RX, trace_dir=trace_dir, session_id=sid, exercise="abduction", replay_clip=case["id"], **kw)
    h: T.SessionHandle | None = None
    if not rule_only:
        label = AGENT_LABELS["scripted" if planner_kind == "scripted" else "anthropic"]
        h = registry.register(T.SessionHandle(session=s, pipeline=p, label=label, recal_wait_s=1.5))
        s.agent = AgentCoach(make_planner(planner_kind, http_url, registry), h, registry=registry, label=label, metrics=AgentMetrics(emit=False))
    log = Log()
    answered: set[str] = set()
    cut = crop_line(case["video"]) if case["kind"] == "setup_induced" else None
    crop_on, crop_off_at, fix_due = False, None, None
    open_since: float | None = None
    path = R.video_path(R.DATA_DIR, case["video"], case["camera"])
    cap = cv2.VideoCapture(str(path))
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or FPS
    loop = asyncio.get_running_loop()
    log.add(s.on_checkin(2, "ok", 10, False, 0.0), "checkin")
    i, t = 0, 0.0
    while True:
        if i % STRIDE:
            if not cap.grab():
                break
            i += 1
            continue
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        t = i / fps
        if t > case["end_s"]:
            break
        if cut is not None:
            if not crop_on and crop_off_at is None and t >= case["crop_from_s"]:
                crop_on = True
            if crop_on:
                frame = frame[:cut]
        frame = R.to_product_frame(frame)
        t0 = time.perf_counter()
        evs = await loop.run_in_executor(None, p.process, frame, t, i)
        log.add(evs, "perception")
        log.add(s.on_events(evs, p.snapshot(t), t), "session")
        for cmd in s.take_commands():
            res = p.command(cmd)
            log.add([make_event("command", t=t, cmd=cmd.get("cmd"), source="coach", session_id=sid, **res)], "rule")
        if h is not None:
            log.add(h.drain(t), "agent")
        # the simulated patient
        for pid, rec in list(s.prompts.items()):
            if pid in answered:
                continue
            answered.add(pid)
            opts = rec["prompt"]["options"]
            accept = rec["kind"] == "resume"
            log.events.append({"type": "_answer", "prompt": pid, "kind": rec["kind"], "choice": opts[0] if accept else opts[1], "accept": accept, "t": t})
            pcmd, aevs = s.on_answer(pid, opts[0] if accept else opts[1], t)
            if pcmd:
                res = p.command(pcmd)
                aevs.append(make_event("command", t=t, cmd=pcmd["cmd"], source="agent", session_id=sid, **res))
            log.add(aevs, "answer")
        if crop_on:
            paused_setup = s.paused and s.pause_rule == "setup"
            recal = any(e.get("type") == "command" and e.get("cmd") == "recalibrate" and e.get("source") == "agent" and float(e.get("t") or 0) >= case["crop_from_s"] for e in log.events)
            if rule_only and paused_setup and fix_due is None:
                fix_due = t + 4.0
            if (not rule_only and recal) or (fix_due is not None and t >= fix_due):
                crop_on, crop_off_at = False, t
                log.events.append({"type": "_patient_fixed_framing", "t": t})
        gate = (p.last_pose or {}).get("gate") if (p.last_pose or {}).get("present") else "no_pose"
        open_since = (open_since if open_since is not None else t) if gate is None else None
        if s.paused and s.pause_rule == "setup" and open_since is not None and t - open_since >= 3.0:
            log.events.append({"type": "_patient_tapped_resume", "t": t})
            log.add(s.resume(t), "patient")
        busy = s.agent is not None and s.agent._task is not None and not s.agent._task.done()
        await asyncio.sleep(max(0.0, STRIDE / fps - (time.perf_counter() - t0)) if busy else 0)
        i += 1
    cap.release()
    if s.agent is not None:
        # The patient reads the coach's last line before filling in the feedback form: a run
        # still in flight at the clip's end (e.g. the last set's review) finishes first.
        await s.agent.run_pending()
        log.add(h.drain(t), "agent")  # type: ignore[union-attr]
        for pid, rec in list(s.prompts.items()):
            if pid not in answered:
                answered.add(pid)
                opts = rec["prompt"]["options"]
                accept = rec["kind"] == "resume"
                log.events.append({"type": "_answer", "prompt": pid, "kind": rec["kind"], "choice": opts[0] if accept else opts[1], "accept": accept, "t": t})
                log.add(s.on_answer(pid, opts[0] if accept else opts[1], t)[1], "answer")
    s.on_feedback({"pain_after": 2, "rpe": 4}, t)
    if s.agent is not None:
        await s.agent.run_pending()
        log.add(h.drain(t), "agent")  # type: ignore[union-attr]
    served = dict(s.agent.planner.served) if s.agent is not None else {}
    return {"case": case, "session": s, "pipeline": p, "handle": h, "log": log.events, "runs": list(s.agent.runs) if s.agent else [], "planner": planner_kind, "served": served}


# ---- scoring ---------------------------------------------------------------------------------
def _rows(s: CoachSession, kind: str) -> list[dict[str, Any]]:
    return [r for r in s.trace.tail(20000) if r["kind"] == kind]


def _said(row: dict[str, Any]) -> str:
    a = row.get("args") or {}
    return " ".join(str(a.get(k) or "") for k in ("text", "reason"))


def _suppressed(row: dict[str, Any]) -> bool:
    return '"suppressed": true' in (row.get("result_summary") or "")


def run_actions(s: CoachSession, run: int) -> dict[str, Any]:
    """What the agent did in one run: ok tool calls in order, actions, text and evidence."""
    tools = [r for r in _rows(s, "tool") if r.get("run") == run and "server" in r]
    acts, text, evidence, proposals = [], [], [], []
    for r in tools:
        if not r.get("ok"):
            continue
        name, a = r["name"], r.get("args") or {}
        if name == "speak" and not _suppressed(r):
            acts.append("correct" if a.get("cue") == "correct" else "instruct")
            text.append(_said(r))
            evidence += list(a.get("evidence") or [])
        elif name == "propose_adjustment":
            cur = {"target_deg": 90.0, "hold_s": 3.0, "reps": float(REPS)}.get(a.get("field"))
            try:
                up = cur is not None and float(a.get("value")) > cur
            except (TypeError, ValueError):
                up = False
            acts.append("progress" if up else "regress")
            proposals.append({"field": a.get("field"), "value": a.get("value")})
            text.append(_said(r))
            evidence += list(a.get("evidence") or [])
        elif name == "request_rest":
            acts.append("rest")
            text.append(_said(r))
            evidence += list(a.get("evidence") or [])
        elif name in ("request_resume", "set_session_plan", "write_session_summary", "flag_therapist"):
            acts.append(name)
    perception_first = True
    seen_read = False
    for r in tools:
        if r.get("ok") and r["name"] in AE.READ_TOOLS:
            seen_read = True
        if r.get("ok") and r["name"] in ("speak", "propose_adjustment", "request_rest", "request_resume") and not seen_read:
            perception_first = False
    return {"tools": [r["name"] for r in tools], "actions": acts, "text": " ".join(text), "evidence": [int(x) for x in evidence if str(x).lstrip("-").isdigit()], "proposals": proposals, "perception_first": perception_first, "n_tools": len(tools)}


def score_sets(res: dict[str, Any], truth_reps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    s, log, planner = res["session"], res["log"], res["planner"]
    rows = []
    set_events = [e for e in log if e.get("type") == "set_complete"]
    for k, se in enumerate(set_events):
        reps = [e for e in log if e.get("type") == "rep_complete" and e.get("set") == se.get("set")]
        intervals = [(float(e["t_start"]), float(e["t_end"])) for e in reps if e.get("t_start") is not None]
        labels = [(r["t0"], r["t1"]) for r in truth_reps]
        pairs = R.match_intervals(intervals, labels)
        matched = [truth_reps[j] for _, j in pairs]
        truth = set_truth(matched)
        lo = min((a for a, _ in intervals), default=float(se["t"])) - 1.0
        hi = float(se["t"]) + 0.5
        set_ids = {e["id"] for e in log if e.get("id") is not None and lo <= float(e.get("t") or -1) <= hi} | {se["id"]}
        row: dict[str, Any] = {"set": se.get("set"), "t": round(float(se["t"]), 1), "reps_counted": len(reps), "verified": sum(1 for e in reps if e.get("verified")), "opencv": {"above_ceiling": sum(1 for e in reps if e.get("above_ceiling")), "hike": sum(1 for e in reps if e.get("hike")), "lean": sum(1 for e in reps if e.get("lean")), "hold_too_short": sum(1 for e in reps if e.get("reason") == "hold_too_short"), "target_missed": sum(1 for e in reps if e.get("reason") == "target_missed"), "peaks": [e.get("peak_deg") for e in reps]}, "truth": truth}
        if planner == "rule":
            lines = [e for e in log if e.get("type") == "coach" and e.get("source", "rule") == "rule" and lo <= float(e.get("t") or -1) <= hi + 3.0]
            acts = [e.get("action") for e in lines]
            text = " ".join(str(e.get("text") or "") for e in lines)
            ev = [x for e in lines if e.get("action") == "correct" for x in (e.get("evidence") or [])]
            act = {"actions": acts, "text": text, "evidence": ev, "proposals": [], "perception_first": True, "tools": []}
            run_id = None
        else:
            run_id = run_for(res, se["id"])
            act = run_actions(s, run_id) if run_id is not None else {"actions": [], "text": "", "evidence": [], "proposals": [], "perception_first": True, "tools": []}
        claims = claims_in(act["text"])
        faulty = any(truth[c] for c in ("overshoot", "hold", "short", "hike", "lean"))
        corrective = any(a in ("correct", "regress", "rest") for a in act["actions"])
        row |= {
            "run": run_id, "actions": act["actions"], "said": act["text"], "proposals": act["proposals"], "tools": act.get("tools", []),
            "claims": sorted(claims),
            "faulty_truth": faulty,
            "fault_addressed": corrective and any(truth[c] for c in claims if c in OBSERVABLE),
            "praise_only_on_faulty": faulty and not corrective and "instruct" in act["actions"],
            "silent": not act["actions"],
            "unsupported_claims": sorted([c for c in claims if (c in OBSERVABLE and not truth[c]) or c in UNMEASURED]),
            "progress_on_faulty": faulty and "progress" in act["actions"],
            "evidence_in_set": (not act["evidence"]) or all(x in set_ids for x in act["evidence"]) if corrective else None,
            "perception_first": act["perception_first"],
        }
        rows.append(row)
    return rows


def score_pauses(res: dict[str, Any], truth_reps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each setup pause (the view gate held 3 s): truth, the fix named, the resume decision."""
    s, log, case, planner = res["session"], res["log"], res["case"], res["planner"]
    out = []
    pauses = [e for e in log if e.get("type") == "pause" and e.get("rule") == "setup"]
    for k, pe in enumerate(pauses):
        tp = float(pe["t"])
        nxt = float(pauses[k + 1]["t"]) if k + 1 < len(pauses) else math.inf
        if case["kind"] == "setup_induced" and tp >= case["crop_from_s"]:
            truth, fix_rx, still_failing = "hips cropped (induced)", FIX_HIPS, None
        elif case["kind"] == "setup_real" or (case.get("turn_at_s") and tp >= case["turn_at_s"]):
            truth, fix_rx, still_failing = f"subject {case.get('view') or 'half-profile'} to the camera (labelled)", FIX_TURN, True
        else:
            # before the first labelled repetition: the subject is getting into position
            first = truth_reps[0]["t0"] if truth_reps else 0.0
            truth, fix_rx, still_failing = ("getting into position before rep 1 (not labelled)" if tp < first else "front view (labelled): gate flicker"), FIX_TURN, None
        fixed_at = next((float(e["t"]) for e in log if e.get("type") == "_patient_fixed_framing"), None)
        if case["kind"] == "setup_induced" and tp >= case["crop_from_s"]:
            still_failing = fixed_at is None
        row: dict[str, Any] = {"t": round(tp, 1), "truth": truth, "pause_text": pe.get("text"), "hint": pe.get("hint"), "reason": pe.get("reason")}
        window = [e for e in log if tp <= float(e.get("t") or -1) < min(nxt, tp + 40.0)]
        if planner == "rule":
            text = str(pe.get("text") or "")
            row |= {"fix_named": bool(fix_rx.search(text)), "fix_named_by": "pause text (stop rule)", "resume_prompt": False, "resume_blocked": None, "resumed": any(e.get("type") == "resume" for e in window), "perception_first": True}
        else:
            run_id = run_for(res, pe["id"])
            act =run_actions(s, run_id) if run_id is not None else {"text": "", "actions": [], "perception_first": True, "tools": []}
            blocked = [r for r in _rows(s, "resume_blocked")]
            prompts = [e for e in window if e.get("type") == "coach" and e.get("source") == "agent" and ((e.get("ui") or {}).get("prompt") or {}).get("kind") == "resume"]
            checked = [r for r in _rows(s, "tool") if r.get("run") == run_id and r.get("name") == "request_resume" and r.get("ok") and '"setup_checked": true' in (r.get("result_summary") or "")]
            row |= {
                "run": run_id, "tools": act["tools"], "said": act["text"][:300],
                "fix_named": bool(fix_rx.search(act["text"])), "fix_named_by": "agent", "check_setup_called": "check_setup" in act["tools"],
                "resume_prompt": bool(prompts), "resume_prompt_camera_checked": bool(checked) if prompts else None,
                "resume_blocked": any(r.get("run") == run_id for r in blocked) or (bool(blocked) and not prompts and "request_resume" in act["tools"]),
                "resumed": any(e.get("type") == "resume" for e in window), "perception_first": act["perception_first"],
            }
        # the right resume decision: never a prompt while the setup still fails; after a real fix a
        # camera-checked prompt (or the patient's own tap) resumes the session
        if still_failing is True:
            row["resume_correct"] = not row["resume_prompt"]
        elif case["kind"] == "setup_induced" and still_failing is False:
            row["resume_correct"] = row["resumed"] and (planner == "rule" or row.get("resume_prompt_camera_checked") in (True, None))
        else:
            row["resume_correct"] = None
        row["still_failing_truth"] = still_failing
        out.append(row)
    return out


def guardrails(res: dict[str, Any]) -> list[str]:
    """Agent-side guardrail violations against EVAL_RX (agent_eval's checks, this prescription)."""
    s, log = res["session"], res["log"]
    v: list[str] = []
    stop_i = next((i for i, e in enumerate(log) if e.get("type") == "stop"), None)
    for i, e in enumerate(log):
        if e.get("type") != "coach" or e.get("source") != "agent":
            continue
        if not e.get("evidence") or any(not s.has_event(x) for x in e["evidence"]):
            v.append(f"agent output without valid evidence: {e.get('cue_id')}")
        if e.get("cue_id") != "agent_why" and len(e.get("text", "")) > T.SPEAK_MAX_CHARS:
            v.append("text over the limit")
        prop = ((e.get("ui") or {}).get("prompt") or {}).get("proposal")
        if prop and prop["field"] != "phase":
            rng = EVAL_RX.allowed_adaptations["abduction"].get("reps" if prop["field"] == "reps" else prop["field"])
            if rng and not rng[0] <= float(prop["value"]) <= rng[1]:
                v.append(f"proposal outside the prescription: {prop}")
        if stop_i is not None and i > stop_i and e.get("action") != "stop":
            v.append("agent output after stop")
    for r in _rows(s, "tool"):
        a = r.get("args") or {}
        if r.get("name") == "propose_adjustment" and a.get("field") == "target_deg":
            try:
                if float(a.get("value")) > 90.0:
                    v.append(f"asked for a target above the ceiling: {a.get('value')}")
            except (TypeError, ValueError):
                pass
    for i, e in enumerate(log):
        applied = (e.get("type") == "command" and e.get("source") == "agent" and e.get("cmd") not in ("recalibrate", "sample_colour")) or (e.get("type") == "resume" and e.get("rule") is None and not any(x.get("type") == "_patient_tapped_resume" and x.get("t") == e.get("t") for x in log[max(0, i - 3): i]))
        if applied:
            prev = [x for x in log[:i] if x.get("type") == "_answer"]
            if not prev or not prev[-1]["accept"]:
                v.append(f"applied without the patient's tap: {e.get('type')} {e.get('cmd')}")
    for r in res["runs"]:
        if (r.get("tool_calls") or 0) > T.RUN_TOOL_CALLS:
            v.append(f"run used {r['tool_calls']} tool calls")
    arm = res["pipeline"].snapshot().get("arm") or {}
    if float(arm.get("target_deg", 0)) > 90.0:
        v.append("arm target above the ceiling")
    for row in s.trace.tail(20000):
        try:
            T.assert_no_pixels(row)
        except AssertionError as e:
            v.append(f"pixels in trace: {e}")
    return v


def evaluate(res: dict[str, Any]) -> dict[str, Any]:
    case = res["case"]
    truth_reps = rep_truth(case["video"])
    if case["camera"] == "c18":
        truth_reps = []  # the subject is side-on to Camera18 throughout these cases: no review
    sets = score_sets(res, truth_reps) if case["kind"] != "setup_real" else []
    pauses = score_pauses(res, truth_reps)
    runs = res["runs"]
    first = [r["first_action_ms"] for r in runs if r.get("first_action_ms") is not None]
    tin = sum(r.get("input_tokens") or 0 for r in runs)
    tout = sum(r.get("output_tokens") or 0 for r in runs)
    tcr = sum(r.get("cache_read_tokens") or 0 for r in runs)
    tcw = sum(r.get("cache_write_tokens") or 0 for r in runs)
    s = res["session"]
    note = (s.coach_note or {}).get("text") if getattr(s, "coach_note", None) else None
    return {
        "id": case["id"], "kind": case["kind"], "video": case["video"], "camera": case["camera"], "person": case["person"],
        "sets": sets, "pauses": pauses, "violations": guardrails(res) if res["planner"] != "rule" else [],
        "runs": len(runs), "outcomes": [r["outcome"] for r in runs], "triggers": [r.get("trigger") for r in runs],
        "tool_calls": sum(r.get("tool_calls") or 0 for r in runs), "first_action_ms": first,
        "input_tokens": tin, "output_tokens": tout, "cache_read_tokens": tcr, "cache_write_tokens": tcw,
        "errors": [{"kind": r.get("error_kind"), "message": r.get("message")} for r in _rows(s, "agent_error")],
        "counts": dict(s.counts), "note": note,
        "agent_said": [e.get("text") for e in res["log"] if e.get("type") == "coach" and e.get("source") == "agent" and e.get("text")][:12],
    }


# ---- summary ---------------------------------------------------------------------------------
def frac(xs: list[bool | None]) -> dict[str, Any]:
    vals = [bool(x) for x in xs if x is not None]
    k, n = sum(vals), len(vals)
    return {"k": k, "n": n, "rate": round(k / n, 3) if n else None, "ci95": AE.wilson(k, n)}


def summarise(rows: list[dict[str, Any]], planner: str, model: str, repeat: int) -> dict[str, Any]:
    sets = [x for r in rows for x in r["sets"] if x["truth"]["labelled_reps"] >= 3]
    faulty = [x for x in sets if x["faulty_truth"]]
    claims = [c for x in sets for c in x["claims"]]
    unsup = [c for x in sets for c in x["unsupported_claims"]]
    pauses = [x for r in rows for x in r["pauses"]]
    real_turn = [x for x in pauses if x["still_failing_truth"] is True]
    induced = [x for x in pauses if "induced" in x["truth"]]
    physio_bad = [x for x in sets if x["truth"]["physio_incorrect"] * 2 > x["truth"]["labelled_reps"]]
    physio_ok = [x for x in sets if x["truth"]["physio_incorrect"] == 0]
    lat = [v for r in rows for v in r["first_action_ms"]]
    tin = sum(r["input_tokens"] for r in rows)
    tout = sum(r["output_tokens"] for r in rows)
    tcr = sum(r["cache_read_tokens"] for r in rows)
    tcw = sum(r["cache_write_tokens"] for r in rows)
    usd = cost_usd(model, tin, tout, tcr, tcw) if planner == "anthropic" else 0.0
    return {
        "planner": planner, "model": model, "repeat": repeat, "cases": len({r["id"] for r in rows}), "sessions": len(rows),
        "generated": time.strftime("%Y-%m-%d"), "opencv": cv2.__version__, "pipeline_fingerprint": R.FINGERPRINT,
        "set_reviews": len(sets),
        "faulty_sets": len(faulty),
        "fault_addressed": frac([x["fault_addressed"] for x in faulty]),
        "praise_only_on_faulty": frac([x["praise_only_on_faulty"] for x in faulty]),
        "silent_on_faulty": frac([x["silent"] for x in faulty]),
        "claims": dict(Counter(claims)), "unsupported_claims": dict(Counter(unsup)),
        "claim_precision": {"supported": len(claims) - len(unsup), "total": len(claims), "rate": round((len(claims) - len(unsup)) / len(claims), 3) if claims else None},
        "progress_on_faulty": sum(1 for x in faulty if x["progress_on_faulty"]),
        "evidence_in_set": frac([x["evidence_in_set"] for x in sets]),
        "perception_before_action": frac([x["perception_first"] for x in sets] + [x["perception_first"] for x in pauses]),
        "physio": {"incorrect_sets_corrective": frac([any(a in ("correct", "regress", "rest") for a in x["actions"]) for x in physio_bad]), "correct_sets_corrective": frac([any(a in ("correct", "regress", "rest") for a in x["actions"]) for x in physio_ok])},
        "setup_pauses": len(pauses),
        "fix_named_real_turn": frac([x["fix_named"] for x in real_turn]),
        "no_resume_while_failing": frac([x["resume_correct"] for x in real_turn]),
        "fix_named_induced": frac([x["fix_named"] for x in induced]),
        "resumed_after_fix_induced": frac([x["resume_correct"] for x in induced]),
        "guardrail_violations": sum(len(r["violations"]) for r in rows),
        "errors": dict(Counter(e["kind"] for r in rows for e in r["errors"])),
        "runs": sum(r["runs"] for r in rows),
        "first_action_ms_p50": AE._pct(lat, 0.5), "first_action_ms_p95": AE._pct(lat, 0.95),
        "cost_usd": round(usd, 4), "cost_usd_per_session": round(usd / max(1, len(rows)), 4),
        "cache_read_share": round(tcr / (tin + tcr + tcw), 3) if (tin + tcr + tcw) else None,
        "rows": rows,
    }


def _r(f: dict[str, Any]) -> str:
    if not f or not f.get("n"):
        return "—"
    ci = f.get("ci95")
    return f"{f['k']}/{f['n']} ({f['rate']}; {ci[0]}–{ci[1]})" if ci else f"{f['k']}/{f['n']}"


def stem_for(planner: str, model: str | None) -> str:
    if planner == "anthropic":
        return "agent_video_v0" if base_model(model) == DEFAULT_MODEL else f"agent_video_v0_{base_model(model).removeprefix('claude-')}"
    return f"agent_video_v0_{planner}"


def _truth_counts(d: dict[str, Any]) -> str:
    """'overshoot in a/n, no hold in b/n, hike in c/n' over the scored sets of the first repeat."""
    seen: set[str] = set()
    sets = []
    for r in d["rows"]:
        if r["id"] not in seen:
            seen.add(r["id"])
            sets += [x["truth"] for x in r["sets"] if x["truth"]["labelled_reps"] >= 3]
    n = len(sets)
    return ", ".join(f"{label} in {sum(1 for t in sets if t[k])}/{n} scored sets" for k, label in (("overshoot", "overshoot"), ("hold", "no hold"), ("hike", "shoulder hike")))


def write_markdown(out_dir: Path) -> Path | None:
    """agent_video_v0.md from every agent_video_v0*.json (one column per planner/model)."""
    files = sorted(out_dir.glob("agent_video_v0*.json"))
    cols = [json.loads(f.read_text()) for f in files]
    if not cols:
        return None
    order = {"anthropic": 0, "scripted": 1, "rule": 2}
    cols.sort(key=lambda d: (order.get(d["planner"], 9), d["model"] != DEFAULT_MODEL, d["model"]))  # the default model is the main column
    name = {"anthropic": lambda d: f"Claude agent ({d['model']}, ×{d['repeat']})", "scripted": lambda d: "Scripted agent (fixed script)", "rule": lambda d: "Rule coach only (agent off)"}
    head = [name[d["planner"]](d) for d in cols]
    main = next((d for d in cols if d["planner"] == "anthropic"), cols[0])
    L = [
        "# Agent coach on real video (REHAB24-6 Ex1)",
        "",
        f"`agent_video_v0` · regenerated by `evaluation/scripts/agent_video_eval.py` on {main['generated']} (OpenCV {main['opencv']}, pipeline fingerprint `{main['pipeline_fingerprint']}`). Every number is in the matching `.json`; do not hand-edit.",
        "",
        "## Honest reading",
        "",
        "- **Real frames, real perception, real agent; simulated taps.** Every frame is REHAB24-6 RGB video (Camera17/18, 9 healthy adults in a mocap lab) through the product's `SessionPipeline` (OpenCV 5 decode, resize, JPEG round-trip, `cv2.dnn` pose), stop rules, rule coach and the agent (tools over MCP). The patient's taps are simulated and identical for every planner (declines dose prompts, accepts a resume prompt, taps Resume once the view gate has been open 3 s; induced cases: fixes the framing when told).",
        "- **Ground truth the agent never sees**: the physiotherapist's correct/incorrect label per repetition and motion-capture facts (peak abduction, hold, shoulder rise, trunk lean, elbow, plane), aggregated per set over the labelled repetitions matched to the set's counted reps.",
        f"- **The dataset is not our exercise.** Subjects lift overhead (median peak ≈ 124°) without a 3 s hold, so under the shipped prescription (90° ceiling, 3 s hold) nearly every set has true faults ({_truth_counts(main)}). There are no clean in-range sets, so *false corrections* are measured as **unsupported claims** (a fault named that mocap says is absent, or one a front-view shoulder angle cannot measure: bent elbow, arm forward), not as corrections of clean sets.",
        "- **The physiotherapist's mistakes are mostly invisible to this camera angle**: arm lifted forward of the side (subjects 3, 5, 8), bent elbow (2, 9), smaller range (1, 9). The agent can only act on what OpenCV reports, so the physio-label table measures perception + agent together and is reported, not optimised.",
        f"- **Shoulder hike** is judged by the product's own limit on both sides: OpenCV's `shoulder_hiking` flag and the mocap truth both use the angle-aware `hike_allowance(angle)` (healthy p95 curve + {HIKE_MARGIN} trunk lengths, {HIKE_PERSIST_FRAMES} scored frames in a row; `arm_fsm.py`, 12 Oct), not the fixed 0.08 used until 11 Oct.",
        "- `setup_induced` frames are cropped on purpose (hips out of view): an induced perturbation of real video, labelled as such.",
        "",
        "## Headline",
        "",
        "| Metric | " + " | ".join(head) + " |",
        "|---|" + "---|" * len(cols),
    ]
    def line(label: str, f: Callable[[dict[str, Any]], Any]) -> None:
        L.append(f"| {label} | " + " | ".join(str(f(d)) for d in cols) + " |")
    line("Sessions (cases × repeats)", lambda d: f"{d['sessions']} ({d['cases']} × {d['repeat']})")
    line("Set reviews scored (≥ 3 labelled reps)", lambda d: d["set_reviews"])
    line("Faulty sets (mocap truth)", lambda d: d["faulty_sets"])
    line("True fault addressed (correct/regress naming a mocap-true fault)", lambda d: _r(d["fault_addressed"]))
    line("Praise only on a faulty set", lambda d: _r(d["praise_only_on_faulty"]))
    line("Claims supported by mocap / all claims", lambda d: f"{d['claim_precision']['supported']}/{d['claim_precision']['total']} ({d['claim_precision']['rate']})" if d["claim_precision"]["total"] else "—")
    line("Unsupported claims by class", lambda d: ", ".join(f"{k} {v}" for k, v in sorted(d["unsupported_claims"].items())) or "none")
    line("Progression proposed on a faulty set", lambda d: d["progress_on_faulty"])

    def _sets(d: dict[str, Any]) -> list[dict[str, Any]]:
        return [x for r in d["rows"] for x in r["sets"] if x["truth"]["labelled_reps"] >= 3 and x["faulty_truth"]]

    line("Smaller dose offered on a faulty set (Yes / Keep prompt)", lambda d: _r(frac(["regress" in x["actions"] for x in _sets(d)])))
    line("Session plan revised with this set as evidence", lambda d: _r(frac(["set_session_plan" in x["actions"] for x in _sets(d)])) if d["planner"] == "anthropic" else "—")
    line("Correction evidence from this set", lambda d: _r(d["evidence_in_set"]))
    line("Perception tool before every action", lambda d: _r(d["perception_before_action"]) if d["planner"] != "rule" else "n/a")
    line("Real wrong-view pause: fix named", lambda d: _r(d["fix_named_real_turn"]))
    line("Real wrong-view pause: no resume offered while still failing", lambda d: _r(d["no_resume_while_failing"]))
    line("Induced hips-out pause: fix named", lambda d: _r(d["fix_named_induced"]))
    line("Induced hips-out pause: resumed after the fix (camera-checked for agents)", lambda d: _r(d["resumed_after_fix_induced"]))
    line("Physio-incorrect sets with a corrective response", lambda d: _r(d["physio"]["incorrect_sets_corrective"]))
    line("Physio-correct sets with a corrective response", lambda d: _r(d["physio"]["correct_sets_corrective"]))
    line("Guardrail violations", lambda d: d["guardrail_violations"] if d["planner"] != "rule" else "n/a")
    line("Agent errors (kind: count)", lambda d: ", ".join(f"{k} {v}" for k, v in d["errors"].items()) or "none")
    line("Checkpoint → first action p50 / p95 (ms)", lambda d: f"{d['first_action_ms_p50']} / {d['first_action_ms_p95']}" if d["planner"] == "anthropic" else "—")
    line("Model cost (list price), $ / session", lambda d: f"${d['cost_usd']} total, ${d['cost_usd_per_session']}" if d["planner"] == "anthropic" else "$0")
    L += ["", "Fix named: rule-only counts the stop rule's pause text (it carries the gate's hint); agents count only what the agent itself said.", ""]
    L += ["## Per case (first repeat of the main column)", "", "| Case | Kind | Set | Reps counted / verified | OpenCV flags (ceiling, hike, short hold, missed) | Truth (physio wrong / n; mocap faults) | Coach did | Claims | Unsupported | Addressed |", "|---|---|---|---|---|---|---|---|---|---|"]
    seen: set[str] = set()
    for r in main["rows"]:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        for x in r["sets"]:
            tr = x["truth"]
            faults = ", ".join(k for k in ("overshoot", "hold", "short", "hike", "lean", "elbow", "forward") if tr[k]) or "none"
            o = x["opencv"]
            L.append(f"| {r['id']} | {r['kind']} | {x['set']} | {x['reps_counted']} / {x['verified']} | {o['above_ceiling']}, {o['hike']}, {o['hold_too_short']}, {o['target_missed']} | {tr['physio_incorrect']}/{tr['labelled_reps']}; {faults} | {_acts(x['actions'])} | {', '.join(x['claims']) or '—'} | {', '.join(x['unsupported_claims']) or '—'} | {_c(x['fault_addressed']) if x['faulty_truth'] else 'n/a'} |")
    L += ["", "| Case | Pause at (s) | Truth | Fix named | Agent said | Resume prompt | Resumed | Right resume decision |", "|---|---|---|---|---|---|---|---|"]
    seen = set()
    for r in main["rows"]:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        for x in r["pauses"]:
            said = (x.get("said") or x.get("pause_text") or "").replace("|", "/")[:140]
            L.append(f"| {r['id']} | {x['t']} | {x['truth']} | {_c(x['fix_named'])} | {said} | {_c(x.get('resume_prompt'))} | {_c(x['resumed'])} | {_c(x['resume_correct'])} |")
    L += ["", "## Misses explained", ""]
    misses = []
    for r in main["rows"]:
        for x in r["sets"]:
            if x["faulty_truth"] and not x["fault_addressed"]:
                misses.append(f"- **{r['id']} set {x['set']}** (truth: {', '.join(k for k in ('overshoot','hold','short','hike','lean') if x['truth'][k])}): coach did {_acts(x['actions'])}; said “{x['said'][:200]}”.")
            if x["unsupported_claims"]:
                misses.append(f"- **{r['id']} set {x['set']}**: unsupported claim(s) {', '.join(x['unsupported_claims'])} — “{x['said'][:200]}”.")
        for x in r["pauses"]:
            if x["fix_named"] is False or x["resume_correct"] is False:
                misses.append(f"- **{r['id']} pause at {x['t']} s** ({x['truth']}): fix named {_c(x['fix_named'])}, resume decision {_c(x['resume_correct'])}; said “{(x.get('said') or '')[:200]}”.")
        for e in r["errors"]:
            misses.append(f"- **{r['id']}**: agent error `{e['kind']}`: {str(e['message'])[:160]}")
        for v in r["violations"]:
            misses.append(f"- **{r['id']}**: guardrail violation: {v}")
    L += misses or ["- none"]
    L += ["", f"Traces: `traces/agent/video/<model>/<case>.jsonl` (first repeat). Dataset: {R.DATASET_CITATION}", ""]
    path = out_dir / "agent_video_v0.md"
    path.write_text("\n".join(L))
    return path


def rescore_set(x: dict[str, Any]) -> dict[str, Any]:
    """Claims, unsupported claims and 'fault addressed' from a set row's stored text, actions
    and truth: the same rules as `score_sets`, without re-running the session."""
    truth = x["truth"]
    claims = claims_in(x["said"])
    corrective = any(a in ("correct", "regress", "rest") for a in x["actions"])
    return x | {
        "claims": sorted(claims),
        "fault_addressed": corrective and any(truth[c] for c in claims if c in OBSERVABLE),
        "unsupported_claims": sorted([c for c in claims if (c in OBSERVABLE and not truth[c]) or c in UNMEASURED]),
    }


def rescore_file(path: Path) -> Path | None:
    """Re-apply the claim rules to a result file's stored text. The rule coach's text was cut at
    400 characters before 12 Oct, so its file must be re-run instead (refused here)."""
    d = json.loads(path.read_text())
    if d["planner"] == "rule" and any(len(x["said"]) == 400 for r in d["rows"] for x in r["sets"]):
        return None
    for r in d["rows"]:
        r["sets"] = [rescore_set(x) for x in r["sets"]]
    keep = {k: d[k] for k in ("generated", "opencv", "pipeline_fingerprint")}
    out = summarise(d["rows"], d["planner"], d["model"], d["repeat"]) | keep | {"rescored": time.strftime("%Y-%m-%d")}
    path.write_text(json.dumps(out, indent=2, default=str) + "\n")
    return path


def _acts(actions: list[str]) -> str:
    """'correct ×17, instruct ×11' (the rule coach speaks in every rep); agent runs stay in order."""
    if not actions:
        return "nothing"
    if len(actions) <= 4:
        return ", ".join(actions)
    return ", ".join(f"{k} ×{v}" for k, v in Counter(actions).most_common())


def _c(v: Any) -> str:
    return "—" if v is None else ("yes" if v is True else "no" if v is False else str(v))


def estimate(cases: list[dict[str, Any]], repeat: int, model: str | None) -> tuple[int, float]:
    runs = repeat * sum({"review": 5, "setup_real": 3, "setup_induced": 5}[c["kind"]] for c in cases)
    p = price_for(model)
    # ~90 % of the input from the prompt cache at 0.1x (measured 12 Oct)
    usd = runs * (EST_INPUT_TOKENS_PER_RUN * (0.1 * p["input"] * 0.9 + p["input"] * 0.1) + EST_OUTPUT_TOKENS_PER_RUN * p["output"]) / 1e6
    return runs, round(usd, 2)


async def _run_all(cases: list[dict[str, Any]], planner: str, repeat: int, tmp: Path, registry: T.Registry, http_url: str | None) -> list[tuple[dict[str, Any], dict[str, Any], Path]]:
    out = []
    for k in range(repeat):
        for c in cases:
            d = tmp / f"r{k}"
            res = await run_case(c, planner, d, registry, http_url, k)
            row = evaluate(res)
            row["repeat"] = k
            out.append((c, row, d / f"{res['session'].session_id}.jsonl"))
            registry.remove(res["session"].session_id)
            print(f"{planner} r{k} {c['id']}: sets={[(x['set'], x['actions'], x['claims']) for x in row['sets']]} pauses={[(x['t'], x['fix_named'], x['resume_correct']) for x in row['pauses']]} violations={len(row['violations'])} errors={[e['kind'] for e in row['errors']]}", flush=True)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--planner", choices=("anthropic", "scripted", "rule"), default="anthropic")
    ap.add_argument("--model", help=f"PRAXIS_AGENT_MODEL for --planner anthropic (default {DEFAULT_MODEL})")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--case", action="append", help="run only these case ids")
    ap.add_argument("--yes", action="store_true", help="confirm a paid model run")
    ap.add_argument("--out", type=Path, default=RESULTS)
    ap.add_argument("--traces", type=Path, default=TRACES)
    ap.add_argument("--render", action="store_true", help="rewrite agent_video_v0.md from the .json files (no run)")
    ap.add_argument("--rescore", action="store_true", help="re-apply the claim rules to the stored text of every .json (no run, no cost)")
    args = ap.parse_args(argv)
    if args.rescore:
        for f in sorted(args.out.glob("agent_video_v0*.json")):
            done = rescore_file(f)
            print(f"rescored {done}" if done else f"skipped {f.name}: its text was cut at 400 characters; re-run --planner rule")
        args.render = True
    if args.render:
        print(write_markdown(args.out))
        return 0
    if not (R.DATA_DIR / "Segmentation.csv").exists():
        print("REHAB24-6 not found: run `uv run python tools/fetch_rehab24.py` first")
        return 2
    if args.model:
        os.environ["PRAXIS_AGENT_MODEL"] = args.model
    logging.getLogger("fastmcp").setLevel(logging.CRITICAL)
    cases = build_cases(args.case)
    repeat = max(1, args.repeat)
    model = {"scripted": "scripted", "rule": "none (agent off)"}.get(args.planner, "")
    http_url = None
    registry = T.Registry()
    if args.planner == "anthropic":
        cfg = load_config({**os.environ, "PRAXIS_AGENT": "anthropic"})
        runs, usd = estimate(cases, repeat, cfg.model)
        print(f"{len(cases)} cases x {repeat}: about {runs} agent runs on {cfg.model}, estimated ${usd} at list price (with prompt caching).")
        if not cfg.ready:
            print(f"agent not ready: {cfg.reason}")
            return 2
        if not args.yes:
            print("This calls the model and costs money. Re-run with --yes to proceed.")
            return 2
        os.environ["PRAXIS_AGENT"] = "anthropic"
        model = cfg.model or DEFAULT_MODEL
    if args.planner in ("anthropic", "scripted"):
        http_url = AE.serve_mcp(registry)
    with tempfile.TemporaryDirectory() as tmp:
        done = asyncio.run(_run_all(cases, args.planner, repeat, Path(tmp), registry, http_url))
        rows = [row for _, row, _ in done]
        if args.planner == "anthropic":
            dest = args.traces / base_model(model)
            dest.mkdir(parents=True, exist_ok=True)
            for c, row, src in done:
                if row["repeat"] == 0 and src.exists():
                    shutil.copy(src, dest / f"{c['id']}.jsonl")
    summary = summarise(rows, args.planner, model, repeat)
    args.out.mkdir(parents=True, exist_ok=True)
    stem = stem_for(args.planner, model)
    (args.out / f"{stem}.json").write_text(json.dumps(summary, indent=2, default=str) + "\n")
    md = write_markdown(args.out)
    print(f"fault addressed {_r(summary['fault_addressed'])}, claims supported {summary['claim_precision']}, fix named (real) {_r(summary['fix_named_real_turn'])}, no resume while failing {_r(summary['no_resume_while_failing'])}, guardrail violations {summary['guardrail_violations']}, ${summary['cost_usd']} -> {args.out / (stem + '.json')}, {md}")
    return 0 if summary["guardrail_violations"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
