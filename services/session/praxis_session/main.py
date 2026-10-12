"""FastAPI entrypoint for the Praxis session service.

Edge/privacy mode: 640x480 JPEG frames arrive over WebSocket, are decoded in memory with
OpenCV 5 (cv2.__version__ == 5.0.0 at authoring), processed, and discarded. Only JSON events
leave the process. Cloud hooks are gated behind PRAXIS_CLOUD_ENABLED (default off).

Frame stream (Sprint D, D-LAT): each binary message is an optional 8-byte little-endian
float64 `t_capture` (ms since epoch, browser clock) + JPEG (`latency.split_capture_prefix`).
A reader task feeds one queue; the consumer runs `pipeline.process` in the default thread
pool, and any frames that queued up meanwhile are dropped oldest-first (`frame.dropped`).
The browser sends the next frame only after the previous frame's ack event (or a 250 ms
safety timeout), so the queue normally holds at most one frame. Every `frame`/`heartbeat`
event carries `t_capture`, `dropped` and `latency = {capture_to_event_ms, proc_ms}`; every
`coach` event that follows perception events carries `latency = {event_to_cue_ms,
capture_to_cue_ms}`; the session summary carries the percentiles (`LatencyStats`).
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import time
from dataclasses import replace as _replace_event
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, ValidationError

import cv2
import numpy as np
from fastapi import Body, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect

from praxis_session.agent import tools as agent_tools
from praxis_session.agent.metrics import METRICS as AGENT_METRICS
from praxis_session.agent.model import load_config as load_agent_config, make_planner, with_listening_port
from praxis_session.calendar_view import MAX_DAYS, build_calendar, week_start
from praxis_session.coach.agent import AgentCoach
from praxis_session.session import RULE_LABEL_WITH_AGENT
from praxis_session.events import Event, EventRing, make_event
from praxis_session.latency import LatencyStats, split_capture_prefix
import praxis_session.trace as trace_mod
from praxis_session.perception.exercises import DEFAULT_VISIBLE_ID, EXERCISES, RUNNABLE_TIERS
from praxis_session.perception.hand import HAND_MODEL, MODELS_DIR, PALM_MODEL
from praxis_session.pipeline import MODES as PIPELINE_MODES, SessionPipeline
from praxis_session.replay import find_replay_clip, list_replay_clips
from praxis_session.plan import checkin_outcome, day_plan, stricter, tier_for, tier_reason
from praxis_session.prescription import SEED_PRESCRIPTION, Prescription
from praxis_session.session import CoachSession
import praxis_session.store as store_module
from praxis_session.store import DEFAULT_PATH, Store
from praxis_session.trace import Trace
from praxis_session.web import mount_web

POSE_MODELS = ("person_detection_mediapipe_2023mar.onnx", "pose_estimation_mediapipe_2023mar.onnx")

CLOUD_ENABLED = os.environ.get("PRAXIS_CLOUD_ENABLED", "0") == "1"
MODES = {"heartbeat", *PIPELINE_MODES}
COACH_MODES = {"nhpt", "cup", "arm"}  # calibrate sockets get a pipeline but no coach session or trace

app = FastAPI(title="Praxis session service", version="0.2.0")

# Claude agent coach (29 Sep). PRAXIS_AGENT=off (default) adds nothing: no MCP routes, no agent,
# the rule coach labelled "LLM agent pending" exactly as before. Otherwise the FastMCP servers
# are mounted at /mcp/{perception,exertion,coach} and each coach session gets an AgentCoach.
AGENT_CFG = load_agent_config()
AGENT_TICK_S = 0.25  # agent outputs reach the browser between frames at least this often
_mcp_subs: list = []
if AGENT_CFG.mcp_enabled:
    from praxis_session.agent import mcp_server

    _mcp_subs = mcp_server.mount(app)
    app.router.lifespan_context = mcp_server.lifespan_for(_mcp_subs)
MCP_MOUNTED = bool(_mcp_subs)

ring = EventRing()
sessions: dict[str, CoachSession] = {}
latency_stats: dict[str, LatencyStats] = {}  # per session id; summary().latency comes from here
store = Store(os.environ.get("PRAXIS_DB", str(DEFAULT_PATH)))
store.seed_if_empty()
_HERE = Path(__file__).resolve()
# Repo layout when run from source; env overrides in the container image (see Dockerfile).
EVAL_DIR = Path(os.environ["PRAXIS_EVAL_DIR"]) if "PRAXIS_EVAL_DIR" in os.environ else _HERE.parents[3] / "evaluation" / "dataset_v0"
WEB_DIST = Path(os.environ["PRAXIS_WEB_DIST"]) if "PRAXIS_WEB_DIST" in os.environ else _HERE.parents[1] / "web_dist"


def opencv_build() -> dict[str, object]:
    """Which cv2 is loaded: on the AWS Graviton box it must be COOL's (/opt/cool), not the wheel."""
    path = str(getattr(cv2, "__file__", "") or "")
    return {
        "version": cv2.__version__,
        "path": path,
        "cool": "/opt/cool" in path,
        "dnn": hasattr(cv2, "dnn") and hasattr(cv2.dnn, "readNetFromONNX"),
        "arch": platform.machine(),
    }


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "praxis-session",
        "opencv_version": cv2.__version__,
        "opencv_build": opencv_build(),
        "mode": "cloud" if CLOUD_ENABLED else "edge",
        "models": {
            "hand": all((MODELS_DIR / n).exists() for n in (PALM_MODEL, HAND_MODEL)),
            "pose": all((MODELS_DIR / n).exists() for n in POSE_MODELS),
        },
        "agent": AGENT_CFG.health(MCP_MOUNTED) | agent_run_status(AGENT_CFG, AGENT_METRICS),
    }


def agent_run_status(cfg: Any, metrics: Any) -> dict[str, object]:
    """Configured is not verified (12 Oct): `model_verified` turns true only once a run of the
    configured model got its answer in this process."""
    if cfg.mode != "anthropic":
        return {}
    return {"model_verified": bool(metrics.model_verified(cfg.model))}



@app.get("/api/agent/metrics")
def api_agent_metrics() -> dict[str, object]:
    """Agent observability (10 Oct): today's runs by outcome, errors by kind, first-action
    p50/p95, mean tool calls, fallbacks and the daily-cap status; in memory since the last
    restart. The same events are JSON lines on stdout (agent/metrics.py) for CloudWatch."""
    return {"mode": AGENT_CFG.mode, "model": AGENT_CFG.model, "policy_version": agent_tools.POLICY_VERSION, **AGENT_METRICS.summary(AGENT_CFG.budget)}


@app.get("/events")
def events(n: int = 50) -> dict[str, object]:
    return {"count": len(ring), "events": [e.to_dict() for e in ring.latest(n)]}


@app.get("/api/trace")
def api_trace(session: str | None = None, n: int = 100) -> dict[str, object]:
    """Decision trace rows (event -> stop rule -> decide -> tool -> action) for a session."""
    s = sessions.get(session) if session else (list(sessions.values())[-1] if sessions else None)
    if s is None:
        return {"session": None, "rows": []}
    return {"session": s.session_id, "rows": s.trace.tail(n)}


def _summary_with_latency(coach: CoachSession, t: float | None = None) -> dict[str, object]:
    """`CoachSession.summary()` plus the `latency` percentiles kept here (session.py is untouched)."""
    s = coach.summary(t)
    st = latency_stats.get(coach.session_id)
    if st is not None:
        s["latency"] = st.summary()
    return s


@app.get("/api/session/{session_id}/summary")
def api_summary(session_id: str) -> dict[str, object]:
    s = sessions.get(session_id)
    if s is None:
        return {"error": "unknown session"}
    return _summary_with_latency(s)



@app.get("/api/prescription")
def api_prescription() -> dict[str, object]:
    return store.prescription()


class ScheduleBody(BaseModel):
    """Therapist view · Edit practice days. Validated again by `prescription.Schedule`."""

    practice_days: list[int]
    nhpt_day: int
    next_visit: dict[str, str] | None = None


@app.put("/api/prescription/schedule")
def api_put_schedule(body: ScheduleBody) -> dict[str, object]:
    """The therapist changes practice days, the peg-test day or the next clinic visit: stored
    as prescription v(N+1) (dose, adaptations and stop rules carried over), logged in
    `schedule_log` and as a `prescription_changed` event. 422 and no change when invalid. No
    auth exists (removed 21 Sep); the UI labels it "Therapist view" and Cognito lands in W6."""
    before = store.prescription()["version"]
    try:
        rx = store.update_schedule(body.model_dump(), by="therapist", now=_clock().timestamp())
    except ValidationError as e:
        raise HTTPException(422, [{"loc": err["loc"], "msg": err["msg"]} for err in e.errors()]) from None
    ring.append(make_event("prescription_changed", what="schedule", by="therapist", from_version=before, to_version=rx["version"], schedule=rx["schedule"]))
    return rx


@app.get("/api/patients/me")
def api_me() -> dict[str, object]:
    return store.patient()


@app.get("/api/sessions")
def api_sessions(limit: int = 50) -> dict[str, object]:
    return {"sessions": store.sessions(limit)}


@app.get("/api/sessions/{session_id}")
def api_session(session_id: str) -> dict[str, object]:
    s = store.session(session_id)
    if s is None:
        live = sessions.get(session_id)
        return {"error": "unknown session"} if live is None else {"id": session_id, "live": True, "summary": _summary_with_latency(live)}
    return s


def _is_int_0_10(v: Any) -> bool:
    return not isinstance(v, bool) and isinstance(v, int) and 0 <= v <= 10


def _is_barriers(v: Any) -> bool:
    return isinstance(v, list) and len(v) <= 16 and all(isinstance(x, str) and 0 < len(x) <= 40 for x in v)


# The answers screen 08 collects, which the report may edit afterwards, and their checks.
# `pain_after` may be cleared (None); the others are left out when unanswered.
FEEDBACK_EDITABLE: dict[str, tuple[Any, str]] = {
    "pain_after": (lambda v: v is None or _is_int_0_10(v), "pain_after must be an integer 0-10"),
    "difficulty": (lambda v: v in ("too_easy", "just_right", "hard", "couldnt_finish"), "difficulty must be too_easy, just_right, hard or couldnt_finish"),
    "effort": (_is_int_0_10, "effort must be an integer 0-10"),
    "again_tomorrow": (lambda v: v in ("yes_easily", "yes_probably", "not_sure", "no"), "again_tomorrow must be yes_easily, yes_probably, not_sure or no"),
    "barriers": (_is_barriers, "barriers must be a list of at most 16 short strings"),
    "detail": (lambda v: isinstance(v, str) and len(v) <= 2000, "detail must be text of at most 2000 characters"),
}
# How the session ended is fixed when it ends; the edit form sends these back and they are dropped.
FEEDBACK_FIXED = ("cmd", "ended_early", "end_reason")


@app.patch("/api/sessions/{session_id}/feedback")
def api_patch_feedback(session_id: str, body: dict[str, Any] = Body(...)) -> dict[str, object]:
    """Report · Edit feedback (6 Oct, ruling R4). Merges the body into the stored session's
    feedback and `summary.told_us` exactly as the end-of-session path does, writes a
    `feedback_edit` trace line, and re-applies the post-session pain rule: `pain_after` at or
    above the stop level adds one `pain_after` therapist flag (never a stop; the session is
    over). Only the screen-08 answers (`FEEDBACK_EDITABLE`) are merged, each type- and
    length-checked; `ended_early` / `end_reason` (how the session ended) are dropped, never
    merged. 404 for an unknown session, 422 for a non-object body, any other key or a bad value."""
    patch = {k: v for k, v in body.items() if k not in FEEDBACK_FIXED}
    errors = []
    for k, v in patch.items():
        rule = FEEDBACK_EDITABLE.get(k)
        if rule is None:
            errors.append({"loc": ["body", k], "msg": f"{k} is not an editable feedback answer"})
        elif not rule[0](v):
            errors.append({"loc": ["body", k], "msg": rule[1]})
    if errors:
        raise HTTPException(422, errors)
    out = store.update_feedback(session_id, patch, t=_clock().timestamp())
    if out is None:
        raise HTTPException(404, "unknown session")
    row, added = out
    live = sessions.get(session_id)
    if live is not None:  # keep the in-memory session (live summary, trace panel) in step
        live.feedback = dict(row["feedback"])
        if added is not None and not any(f["rule"] == "pain_after" for f in live.stop_rules.flags):
            live.stop_rules.flags.append(dict(added))
    tr = live.trace if live is not None else Trace(session_id)
    tr.log("feedback_edit", changed=patch, feedback=row["feedback"])
    if added is not None:
        tr.log("flag", rule=added["rule"], detail=added["detail"])
    return row


@app.get("/api/flags")
def api_flags() -> dict[str, object]:
    return {"flags": store.flags()}


@app.post("/api/flags/{flag_id}/reviewed")
def api_flag_reviewed(flag_id: int) -> dict[str, object]:
    store.mark_reviewed(flag_id)
    return {"ok": True}


class GoalNote(BaseModel):
    note: str = ""


@app.post("/api/goal-log")
def api_goal_log(body: GoalNote) -> dict[str, object]:
    return {"ok": True, "goal_attempts": store.log_goal(body.note)}


@app.get("/api/progress")
def api_progress() -> dict[str, object]:
    return store.progress(today=_clock().date())


def _clock() -> datetime:
    """The service's local wall clock. Tests pin it (`monkeypatch.setattr(main, "_clock", ...)`);
    "today" on the calendar, adherence and the next-visit check all read it."""
    return datetime.now()


# The store serves the sample next visit relative to today: the same clock (looked up per call,
# so a test that pins `_clock` pins it too).
store_module.local_today = lambda: _clock().date()


@app.get("/api/calendar")
def api_calendar(start: date | None = Query(None, alias="from"), end: date | None = Query(None, alias="to")) -> dict[str, object]:
    """Screen 12. Days `from..to` (inclusive, at most 62) from the prescription's practice
    schedule and the stored sessions; with no range, the Mon-Sun week holding today. `done`
    only from live sessions: replays never count, sample days are labelled (`calendar_view`)."""
    now = _clock()
    today = now.date()
    if (start is None) != (end is None):
        raise HTTPException(400, "give both from and to, or neither")
    if start is None or end is None:
        start = week_start(today)
        end = start + timedelta(days=6)
    if end < start or (end - start).days + 1 > MAX_DAYS:
        raise HTTPException(400, f"from must not be after to, and the range is at most {MAX_DAYS} days")
    rx = store.prescription()
    cal = build_calendar(Prescription.model_validate(rx).schedule, store.sessions(10_000), start, end, today, now=now)
    if cal["next_visit"] is not None:  # the seed's visit is a sample (served relative to today)
        cal["next_visit"]["sample"] = bool((rx["schedule"].get("next_visit") or {}).get("sample"))
    return cal


@app.get("/api/plan")
def api_plan(pain: int = 0, nhpt_due: bool = True) -> dict[str, object]:
    """Today in the default order at the pain tier's dose (`plan.day_plan`). A rule in code."""
    return day_plan(pain, SEED_PRESCRIPTION, nhpt_due=nhpt_due)


class CheckinBody(BaseModel):
    """Screen 03's check-in as `web/src/lib/day.ts` posts it (`api.ts` CheckinBody). Types are
    strict: a pain of "5", 5.5 or true is a 422, never coerced."""

    pain: Annotated[int, Field(strict=True, ge=0, le=10)]
    new_symptoms: Annotated[bool, Field(strict=True)]
    rpe: Annotated[int | None, Field(strict=True, ge=0, le=10)] = None
    notes: Annotated[str | None, Field(max_length=2000)] = None
    side: Literal["left", "right"] | None = None
    patient_id: Annotated[str | None, Field(min_length=1, max_length=64)] = None


_checkin_traces: dict[tuple[str, str], Trace] = {}  # one trace file per day (and trace dir)


@app.post("/api/checkin")
def api_checkin(body: CheckinBody) -> dict[str, object]:
    """The day's check-in (screen 03), decided in code by `plan.checkin_outcome` against the
    **current** prescription's stop level (seed 7; a therapist can make it stricter): 0-3 full,
    4-6 gentle, at/above the stop level or new/worse symptoms rest. A rest day writes a
    therapist flag (`checkin_pain`, `checkin_symptoms`) to the same `flags` table the stop rules
    use, at most once per patient, day and reason, so the web's offline re-post
    (`syncCheckin`) never flags twice. Every check-in is stored (`checkins`), traced
    (`traces/checkin-<date>.jsonl`) and each new flag goes on the event ring. `flagged` is true
    whenever a flag for this check-in's reason is on file today: the therapist has been told.
    422 on bad input, and nothing is written."""
    now = _clock()
    day, t = now.date().isoformat(), now.timestamp()
    out = checkin_outcome(body.pain, body.new_symptoms, store.rx())
    record = {"pain": body.pain, "new_symptoms": body.new_symptoms, "rpe": body.rpe, "notes": body.notes, "side": body.side, "tier": out["tier"], "reasons": out["reasons"], "flagged": bool(out["flags"])}
    patient_id = body.patient_id or store.patient()["id"]
    saved, added = store.save_checkin(record, out["flags"], day, t, patient_id=patient_id)
    key = (day, str(trace_mod.DEFAULT_DIR))
    tr = _checkin_traces.get(key)
    if tr is None:
        tr = _checkin_traces[key] = Trace(f"checkin-{day}")
    tr.log("checkin", checkin_id=saved["id"], patient=patient_id, pain=body.pain, new_symptoms=body.new_symptoms, rpe=body.rpe, tier=out["tier"], reasons=out["reasons"])
    for f in added:
        tr.log("flag", rule=f["rule"], detail=f["detail"], flag_id=f["id"])
        ring.append(make_event("therapist_flag", t=t, rule=f["rule"], detail=f["detail"]))
    return {"tier": out["tier"], "flagged": record["flagged"], "reasons": out["reasons"], "plan": out["plan"]}


class SelfReport(BaseModel):
    exercise: str
    sets: int = 1


SELF_TICK_LABEL = "Demo only · self-ticked, not camera-verified"
_self_ticks: dict[tuple[str, str], int] = {}  # (date, exercise) -> sets ticked today
_self_traces: dict[tuple[str, str], Trace] = {}  # one trace file per day (and trace dir)


@app.post("/api/self_report")
def api_self_report(body: SelfReport) -> dict[str, object]:
    """A demo-only exercise the patient did while watching the avatar. It is logged as
    self-ticked and **never** as a verified rep; a camera-coached exercise is refused here
    because it only counts from OpenCV events. Since 28 Sep the only demo-only entries (Rotate
    out / Rotate in) are hidden, so this path is dormant: a hidden exercise is `not_offered`."""
    ex = EXERCISES.get(body.exercise)
    if ex is None:
        return {"ok": False, "error": "unknown_exercise", "exercise": body.exercise}
    if not ex.visible:
        return {"ok": False, "error": "not_offered", "exercise": ex.id, "text": f"{ex.name} is not part of your program."}
    if ex.mode != "demo":
        return {"ok": False, "error": "not_demo", "exercise": ex.id, "text": f"{ex.name} is counted by the camera, not by a tick."}
    sets = max(1, min(10, int(body.sets)))
    today = time.strftime("%Y-%m-%d")
    _self_ticks[(today, ex.id)] = _self_ticks.get((today, ex.id), 0) + sets
    key = (today, str(trace_mod.DEFAULT_DIR))
    tr = _self_traces.get(key)
    if tr is None:
        tr = _self_traces[key] = Trace(f"self-{today}")
    fields = {"exercise": ex.id, "name": ex.name, "mode": ex.mode, "sets": sets, "verified": False, "source": "self_ticked", "label": SELF_TICK_LABEL}
    tr.log("self_report", **fields, sets_today=_self_ticks[(today, ex.id)])
    ring.append(make_event("self_report", **fields))
    return {"ok": True, **fields, "sets_today": _self_ticks[(today, ex.id)]}


@app.get("/api/therapist/patients")
def api_therapist_patients() -> dict[str, object]:
    return {"patients": store.therapist_patients(today=_clock().date())}


@app.get("/api/replay/list")
def api_replay_list() -> dict[str, object]:
    """Synthetic dataset_v0 renders plus every consented recorded clip with a sidecar
    (`replay.list_replay_clips`); `mode` is the registry exercise id the web routes on."""
    return {"clips": [c.to_api() for c in list_replay_clips(EVAL_DIR)]}


def decode_jpeg(data: bytes) -> np.ndarray | None:
    arr = np.frombuffer(data, dtype=np.uint8)
    if arr.size == 0:
        return None
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


@app.websocket("/session")
async def session_ws(
    ws: WebSocket,
    mode: str = "heartbeat",
    sheet: str = "nhpt_board",
    debounce: int = 2,
    clear: int = 3,
    side: str = "left",
    exercise: str | None = None,
    tier: str = "full",
    target: float | None = None,
    hold: float | None = None,
    sets: int | None = None,
    reps: int | None = None,
    replay: str | None = None,
    for_mode: str = Query("", alias="for"),
) -> None:
    """Frame ingest. mode=heartbeat echoes frame info; other modes run the perception pipeline.

    One pipeline per connection; every event goes to the shared ring and back over the socket
    as one JSON text message per event. Frames are decoded in memory and dropped.

    Sprint E: `mode=arm` takes `exercise` (a `perception/exercises.py` id) and `tier`
    (`full`/`gentle`, the pain-tier overrides). `target`/`hold`/`sets`/`reps` still override
    both when given. Since 28 Sep a missing or unknown arm exercise runs `DEFAULT_VISIBLE_ID`
    (Arm out to the side) and a hidden one is refused (`not_offered`).
    """
    await ws.accept()
    clip = find_replay_clip(replay, EVAL_DIR) if replay else None
    if clip is not None:  # a recorded clip knows its own pipeline, exercise and side
        mode, sheet, side = clip.pipeline, clip.sheet, clip.side or side
        exercise = clip.exercise if clip.pipeline == "arm" else exercise
    if mode == "arm" and (not exercise or exercise not in EXERCISES):
        exercise = DEFAULT_VISIBLE_ID  # never fall back to a hidden exercise
    if mode not in MODES:
        await ws.send_text(make_event("error", code="bad_mode", mode=mode).to_json())
        await ws.close()
        return
    refusal = _refuse_exercise(mode, exercise, tier)
    if refusal is not None:
        await ws.send_text(refusal.to_json())
        await ws.close()
        return
    pipeline: SessionPipeline | None = None
    if mode != "heartbeat":
        try:
            pipeline = SessionPipeline(
                mode=mode,  # type: ignore[arg-type]
                sheet=sheet,
                ring=ring,
                debounce_frames=debounce,
                clear_frames=clear,
                side=side,
                target_deg=target,
                hold_s=hold,
                sets=sets,
                reps=reps,
                for_mode=for_mode or None,
                exercise=exercise,
                tier=tier,
            )
        except ValueError:
            await ws.send_text(make_event("error", code="bad_sheet", sheet=sheet).to_json())
            await ws.close()
            return
    coach: CoachSession | None = None
    stats = LatencyStats()
    if pipeline is not None and mode in COACH_MODES:
        coach = CoachSession(
            mode=mode,
            prescription=SEED_PRESCRIPTION,
            exercise=exercise if mode == "arm" else None,
            replay_clip=replay or None,  # saved as `source: replay`, never counted as practice
            **({"rule_label": RULE_LABEL_WITH_AGENT} if AGENT_CFG.enabled else {}),
        )
        sessions[coach.session_id] = coach
        if AGENT_CFG.enabled:
            await _start_agent(ws, coach, pipeline)
        latency_stats[coach.session_id] = stats
        while len(sessions) > 50:
            old = sessions.pop(next(iter(sessions)))
            latency_stats.pop(old.session_id, None)
    try:
        if replay and pipeline is not None and coach is not None:
            await _replay_loop(ws, replay, pipeline, coach, stats)
            return
        await _live_loop(ws, pipeline, coach, stats)
    finally:
        # 11 Oct audit: the socket is gone, so the agent must not keep running (model spend,
        # tools on a dead pipeline): pending checkpoints dropped, the run in flight cancelled
        # (a feedback run may finish its report note), the tool handle unregistered.
        if coach is not None and coach.agent is not None:
            coach.agent.close("socket closed")
        elif coach is not None:
            agent_tools.REGISTRY.remove(coach.session_id)


async def _start_agent(ws: WebSocket, coach: CoachSession, pipeline: SessionPipeline) -> None:
    """Agent on: register the session's tool handle, attach the AgentCoach when the model is
    ready, and tell the browser the session id and coach labels straight away (the trace panel
    polls /api/trace?session=<id> before the first command)."""
    label = AGENT_CFG.label or "Claude agent"
    handle = agent_tools.REGISTRY.register(agent_tools.SessionHandle(session=coach, pipeline=pipeline, store=store, label=label))
    if AGENT_CFG.ready:
        planner = make_planner(with_listening_port(AGENT_CFG, ws.scope.get("server")))
        coach.agent = AgentCoach(planner, handle, label=label, daily=AGENT_CFG.budget)
    first = [make_event("session_start", session_id=coach.session_id, mode=coach.mode, exercise=coach.exercise, label=coach.rule_label, agent=AGENT_CFG.health(MCP_MOUNTED) | {"label": label})]
    if not AGENT_CFG.ready:
        first.append(make_event("agent_status", state="offline", reason=f"Coach offline · rule coach ({AGENT_CFG.reason})", label=label))
    for e in first:
        ring.append(e)
        await ws.send_text(e.to_json())


async def _deliver_agent(ws: WebSocket, coach: CoachSession | None, now: float) -> None:
    """Send whatever the agent queued (coach lines, prompts, agent_status, commands). Called
    after every frame and command, and on a short timer between frames."""
    if coach is None or coach.agent is None:
        return
    for e in coach.agent.handle.drain(now):
        ring.append(e)
        await ws.send_text(e.to_json())


def _refuse_exercise(mode: str, exercise: str | None, tier: str) -> Event | None:
    """Guardrails before any pipeline exists. A hidden exercise (28 Sep: Pendulum, Arm to the
    front, Rotate out, Rotate in) is not offered; a demo-only exercise is never scored by the
    camera; a sheet activity is not an arm exercise; a tier outside full/gentle has nothing to
    run (pain >= 7 is a rest day, handled by the stop rule)."""
    if tier not in RUNNABLE_TIERS:
        return make_event("error", code="rest_day" if tier == "rest" else "bad_tier", tier=tier)
    if mode != "arm" or not exercise or exercise not in EXERCISES:
        return None
    ex = EXERCISES[exercise]
    if not ex.visible:
        return make_event("error", code="not_offered", exercise=exercise, text=f"{ex.name} is not part of your program.")
    if ex.mode == "demo":
        return make_event("error", code="demo_only", exercise=exercise, text=f"{ex.name} is demo only: watch the figure and tick it yourself. The camera does not score it.")
    if ex.pipeline != "arm":
        return make_event("error", code="bad_exercise", exercise=exercise, mode=mode)
    return None


def _is_disconnect(msg: dict) -> bool:
    return msg.get("type") == "websocket.disconnect"


async def _live_loop(ws: WebSocket, pipeline: SessionPipeline | None, coach: CoachSession | None, stats: LatencyStats) -> None:
    """Reader task -> queue -> consumer. The consumer never blocks the event loop on OpenCV:
    `pipeline.process` runs in the default thread pool, and frames that queued up meanwhile
    are dropped oldest-first. Commands are handled in arrival order between frames, so the
    pipeline and coach are only ever touched from one coroutine at a time."""
    loop = asyncio.get_running_loop()
    q: asyncio.Queue[dict] = asyncio.Queue()

    async def reader() -> None:
        try:
            while True:
                msg = await ws.receive()
                await q.put(msg)
                if _is_disconnect(msg):
                    return
        except (WebSocketDisconnect, RuntimeError):
            await q.put({"type": "websocket.disconnect"})

    reader_task = asyncio.ensure_future(reader())
    received = 0  # every frame the socket delivered; dropped ones keep their index
    try:
        while True:
            if coach is not None and coach.agent is not None:
                try:
                    msg = await asyncio.wait_for(q.get(), AGENT_TICK_S)
                except asyncio.TimeoutError:
                    await _deliver_agent(ws, coach, time.time())
                    continue
            else:
                msg = await q.get()
            if _is_disconnect(msg):
                return
            if msg.get("text") is not None:
                await _run_command(ws, msg["text"], pipeline, coach)
                continue
            data, index, dropped = msg.get("bytes") or b"", received, 0
            received += 1
            while not q.empty():  # drop-oldest: a newer queued frame replaces this one
                nxt = q.get_nowait()
                if _is_disconnect(nxt):
                    return
                if nxt.get("text") is not None:
                    await _run_command(ws, nxt["text"], pipeline, coach)
                    continue
                dropped += 1
                data, index = nxt.get("bytes") or b"", received
                received += 1
            t_capture, jpeg = split_capture_prefix(data)
            frame = decode_jpeg(jpeg)
            if frame is None:
                await ws.send_text(make_event("error", code="bad_frame", frame_index=index).to_json())
                continue
            if pipeline is None:
                h, w = frame.shape[:2]
                now = time.time()
                lat = {"capture_to_event_ms": _since_ms(t_capture, now), "proc_ms": 0.0}
                stats.frame(lat["capture_to_event_ms"], 0.0, dropped)
                e = make_event(
                    "heartbeat",
                    t=now,
                    frame_index=index,
                    frame={"width": w, "height": h, "bytes": len(jpeg)},
                    t_capture=t_capture,
                    dropped=dropped,
                    latency=lat,
                )
                ring.append(e)
                await ws.send_text(e.to_json())
            else:
                await _run_frame(ws, loop, pipeline, coach, stats, frame, time.time(), index, t_capture, dropped)
            del frame
    except WebSocketDisconnect:
        return
    finally:
        reader_task.cancel()


def _since_ms(t_capture_ms: float | None, now_s: float) -> float | None:
    return None if t_capture_ms is None else round(now_s * 1000.0 - t_capture_ms, 1)


async def _run_frame(
    ws: WebSocket,
    loop: asyncio.AbstractEventLoop,
    pipeline: SessionPipeline,
    coach: CoachSession | None,
    stats: LatencyStats,
    frame: np.ndarray,
    t: float,
    index: int,
    t_capture: float | None,
    dropped: int,
) -> None:
    """One frame through perception (thread pool) then stop rules + coach (event loop);
    `t` is wall-clock live and clip time in replay. Frame events gain the latency block,
    coach events gain event->cue."""
    t0 = time.perf_counter()
    evs: list[Event] = await loop.run_in_executor(None, pipeline.process, frame, t, index)
    proc_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    t_events = time.time()
    lat = {"capture_to_event_ms": _since_ms(t_capture, t_events), "proc_ms": proc_ms}
    stats.frame(lat["capture_to_event_ms"], proc_ms, dropped)
    for e in evs:
        if e.type == "frame":
            e = _replace_event(e, payload={**e.payload, "t_capture": t_capture, "dropped": dropped, "latency": lat})
        await ws.send_text(e.to_json())
    if coach is None:
        return
    for e in coach.on_events(evs, pipeline.snapshot(t), t):
        if e.type == "coach":
            now = time.time()
            cue_lat = {"event_to_cue_ms": round((now - t_events) * 1000.0, 1), "capture_to_cue_ms": _since_ms(t_capture, now)}
            stats.cue(cue_lat["event_to_cue_ms"])
            e = _replace_event(e, payload={**e.payload, "latency": cue_lat})
        ring.append(e)
        await ws.send_text(e.to_json())
    for e in _apply_coach_commands(pipeline, coach):
        ring.append(e)
        await ws.send_text(e.to_json())
    await _deliver_agent(ws, coach, t)


def _apply_coach_commands(pipeline: SessionPipeline, coach: CoachSession) -> list[Event]:
    """Apply what a coach decision asked of the pipeline (today: a regress's `set_hold`).
    `SessionPipeline.command` clamps it to the prescription in code; the result goes back as
    a `command` event (`source: coach`) and a trace row citing the decision's evidence."""
    out: list[Event] = []
    for cmd in coach.take_commands():
        result = pipeline.command(cmd)
        coach.trace.log("apply", cmd=cmd.get("cmd"), requested=cmd, evidence=cmd.get("evidence", []), **result)
        out.append(make_event("command", cmd=cmd.get("cmd"), source="coach", session_id=coach.session_id, **result))
    return out


async def _run_command(ws: WebSocket, text: str, pipeline: SessionPipeline | None, coach: CoachSession | None, now: float | None = None) -> None:
    try:
        cmd = _as_command(json.loads(text))
    except json.JSONDecodeError:
        cmd = {}
    for e in _handle_command(cmd, pipeline, coach, now=now):
        ring.append(e)
        await ws.send_text(e.to_json())
    await _deliver_agent(ws, coach, time.time() if now is None else now)


class _BadCommand(ValueError):
    """A browser command with a missing, mistyped or out-of-range value."""


def _as_command(obj: object) -> dict:
    """A parsed WebSocket text frame as a command dict; anything but a JSON object is empty."""
    return obj if isinstance(obj, dict) else {}


def _int_field(cmd: dict, key: str, default: int, lo: int, hi: int) -> int:
    """An integer field in [lo, hi]; anything else (text, null, bool, list, out of range) is
    refused rather than coerced, so a pain of 11 or "seven" never reaches the stop rules."""
    v = cmd.get(key, default)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or int(v) != v:
        raise _BadCommand(f"{key} must be a whole number")
    if not lo <= int(v) <= hi:
        raise _BadCommand(f"{key} must be {lo}-{hi}")
    return int(v)


def _handle_command(cmd: dict, pipeline: SessionPipeline | None, coach: CoachSession | None, now: float | None = None) -> list:
    """Text commands from the browser: pipeline commands and coach-session inputs.

    `now` is wall-clock for live sessions and clip time in replay, so the coach's cooldowns
    and the exertion timer see one clock. A malformed command is answered with
    `command {ok: false, error}` and the session carries on: one bad frame from the socket
    must never end a patient's session."""
    try:
        return _handle_command_unchecked(cmd, pipeline, coach, now)
    except (_BadCommand, TypeError, ValueError, KeyError) as exc:
        return [make_event("command", cmd=cmd.get("cmd") if isinstance(cmd, dict) else None, ok=False, error=f"bad_command: {exc}"[:200])]


def _handle_command_unchecked(cmd: dict, pipeline: SessionPipeline | None, coach: CoachSession | None, now: float | None) -> list:
    name = cmd.get("cmd")
    now = time.time() if now is None else now
    out: list = []
    if pipeline is None or coach is None:
        return [make_event("command", cmd=name, ok=False, error="no pipeline")]
    if name == "checkin":
        pain = _int_field(cmd, "pain", 0, 0, 10)
        minutes = _int_field(cmd, "minutes", 0, 0, 600)
        # Pain tier (plan.py), enforced here and not left to the client: pain 4-6 tightens the
        # running dose to gentle before the first rep; >= 7 is a rest day, and the pain stop
        # rule below ends the session and writes the therapist flag.
        tier = stricter(tier_for(pain, coach.prescription), pipeline.tier)
        applied = pipeline.apply_tier(tier)
        coach.trace.log("tier", rule="pain_tier", pain=pain, tier=tier, running=applied["tier"], changed=applied["changed"], reason=tier_reason(tier, pain))
        notes = cmd.get("notes")
        out += coach.on_checkin(pain, str(cmd.get("energy", "")), minutes, bool(cmd.get("new_symptoms", False)), now, rpe=cmd.get("rpe"), notes=notes[:2000] if isinstance(notes, str) else None)
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id, tier=tier, tier_applied=applied["changed"]), *out]
    if name == "pain":
        out += coach.on_pain(_int_field(cmd, "pain", 0, 0, 10), now)
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id), *out]
    if name == "rpe":
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id), *coach.on_rpe(_int_field(cmd, "rpe", 0, 0, 10), now)]
    if name == "pause":
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id), *coach.pause(now)]
    if name == "resume":
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id), *coach.resume(now)]
    if name == "answer":
        pcmd, evs = coach.on_answer(str(cmd.get("prompt", "")), str(cmd.get("choice", "")), now)
        result = pipeline.command(pcmd) if pcmd else {"ok": True}
        out = [make_event("command", cmd=name, session_id=coach.session_id, **result), *evs]
        if pcmd and pcmd.get("source") == "agent":
            # The patient accepted an agent proposal: applied (clamped again in the pipeline)
            # and reported as its own command event, citing the proposal's evidence.
            coach.trace.log("apply", cmd=pcmd.get("cmd"), requested=pcmd, evidence=pcmd.get("evidence", []), source="agent", **result)
            out.append(make_event("command", cmd=pcmd.get("cmd"), source="agent", session_id=coach.session_id, prompt=pcmd.get("prompt"), **result))
        return out
    if name == "feedback":
        coach.on_feedback({k: v for k, v in cmd.items() if k != "cmd"}, now)
        summary = _summary_with_latency(coach, now)
        store.save_session(summary, coach.checkin, coach.feedback, [r for r in coach.trace.tail(2000) if r.get("kind") == "event"])
        return [make_event("command", cmd=name, ok=True, session_id=coach.session_id, summary=summary)]
    result = pipeline.command(cmd)
    return [make_event("command", cmd=name, session_id=coach.session_id, **result)]


def _find_clip(clip_id: str) -> Path | None:
    clip = find_replay_clip(clip_id, EVAL_DIR)
    return clip.path if clip is not None else None


async def _replay_loop(ws: WebSocket, clip_id: str, pipeline: SessionPipeline, coach: CoachSession, stats: LatencyStats) -> None:
    """Judge fallback: the service streams a recorded clip through the identical pipeline at the
    file's fps while still accepting text commands from the client. Raw frames never leave.
    Frames keep clip time and carry `latency.proc_ms` only (no capture time, nothing dropped)."""
    path = _find_clip(clip_id)
    if path is None:
        await ws.send_text(make_event("error", code="bad_replay", clip=clip_id).to_json())
        await ws.close()
        return
    loop = asyncio.get_running_loop()
    cap = cv2.VideoCapture(str(path))
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 10.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    await ws.send_text(make_event("replay_start", clip=clip_id, fps=fps, frames=n, session_id=coach.session_id).to_json())
    i = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                await ws.send_text(make_event("replay_end", clip=clip_id, frames=i).to_json())
                break
            await _run_frame(ws, loop, pipeline, coach, stats, frame, i / fps, i, None, 0)
            i += 1
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=max(0.005, 1.0 / fps))
                if _is_disconnect(msg):
                    return
                if msg.get("text") is not None:
                    await _run_command(ws, msg["text"], pipeline, coach, now=pipeline._last_t)
            except asyncio.TimeoutError:
                pass
        while True:  # keep the socket open for feedback after the clip ends
            if coach.agent is not None:
                try:
                    msg = await asyncio.wait_for(ws.receive(), AGENT_TICK_S)
                except asyncio.TimeoutError:
                    await _deliver_agent(ws, coach, pipeline._last_t)
                    continue
            else:
                msg = await ws.receive()
            if _is_disconnect(msg):
                return
            if msg.get("text") is not None:
                await _run_command(ws, msg["text"], pipeline, coach, now=pipeline._last_t)
    except WebSocketDisconnect:
        return
    finally:
        cap.release()


# Single-origin deploy: same handler at /ws/session (the path the browser uses behind Vite's
# proxy) and the built web app last, so every /api, /health, /events route above wins.
app.add_api_websocket_route("/ws/session", session_ws)
WEB_MOUNTED = mount_web(app, WEB_DIST)
