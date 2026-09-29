"""The agent coach's tools: one implementation, every guardrail (agent coach design §4-§5).

The same functions are served three ways: by the FastMCP servers `perception`, `exertion` and
`coach` (`agent/mcp_server.py`, transport `mcp`), as direct Strands tools when MCP is down
(transport `direct`), and by the scripted planner in tests. Every call goes through `invoke`,
which finds the session, enforces budgets, times the call and writes one `tool` trace row.

Perception tools run OpenCV 5 on demand (cv2.__version__ == 5.0.0 at authoring): `check_setup`
runs `perception.quality` and a fresh `cv2.aruco` detection + `cv2.findHomography` /
`cv2.solvePnP` on the latest frame held in memory by reference (`SessionPipeline.check_setup`).

Guardrails live here, in code, not in the prompt:
- coach (action) tools only inside an agent run, never once the session is stopped, never
  from a stale run (the session moved on), and only with `evidence` ids that exist in *this*
  session's event ring (CLAUDE.md rule 5);
- only the six actions exist; unknown tools/fields are errors and nothing happens;
- adjustments are clamped with `prescription.clamp` and only become a patient prompt; they
  are applied by the pipeline only when the patient taps Yes (`CoachSession.on_answer`);
- a resume is only ever a prompt; text and rate limits; per-run and per-session budgets.
Action tools do not touch the session directly: they queue *intents* that the WebSocket loop
drains on its own coroutine (`SessionHandle.drain`), where the stop check runs once more.

Privacy: results are numbers and short text. `assert_no_pixels` runs on every result.
"""
from __future__ import annotations

import contextvars
import functools
import json
import re
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np

from praxis_session.coach.base import Decision
from praxis_session.events import Event, make_event
from praxis_session.prescription import clamp
from praxis_session.stop_rules import is_miss

SPEAK_MAX_CHARS = 160
SPEAK_MIN_GAP_S = 4.0
NOTE_MAX_CHARS = 400
REASON_MAX_CHARS = 300
REST_MIN_S, REST_MAX_S = 10, 120
RUN_TOOL_CALLS = 6
SESSION_TOOL_CALLS = 60
SESSION_RUNS = 12
RECAL_FRAMES = 3

SERVERS: dict[str, tuple[str, ...]] = {
    "perception": ("get_events", "get_set_summary", "check_setup", "recalibrate"),
    "exertion": ("get_exertion_state", "get_prescription", "read_patient_model"),
    "coach": ("speak", "propose_adjustment", "request_rest", "request_resume", "flag_therapist", "end_session", "write_session_summary"),
}
SERVER_OF: dict[str, str] = {name: server for server, names in SERVERS.items() for name in names}
# Every coach tool is one of the six actions (speak: instruct|correct; propose: progress|regress).
ACTION_OF: dict[str, str] = {
    "speak": "instruct",
    "propose_adjustment": "progress",
    "request_rest": "rest",
    "request_resume": "instruct",
    "flag_therapist": "instruct",
    "end_session": "stop",
    "write_session_summary": "instruct",
}
ARM_FIELDS = {"target_deg": ("set_target", "target_deg", "°"), "hold_s": ("set_hold", "hold_s", "s"), "reps": ("set_reps", "reps", "reps")}
FIELD_NAMES = {"target_deg": "target", "hold_s": "hold", "reps": "reps per set", "phase": "arc speed"}
_BIG_KEYS = {"overlay", "markers_px", "hand", "pose", "board", "targets_px", "skeleton_px", "free_pegs_mm", "splits_s", "occupancy", "colour"}
_B64 = re.compile(r"[A-Za-z0-9+/=_-]{200,}")


class ToolRejected(Exception):
    """A guardrail said no. The model sees the message as a tool error; nothing happened."""

    def __init__(self, message: str, kind: str = "guardrail") -> None:
        super().__init__(message)
        self.kind = kind


def assert_no_pixels(obj: Any, path: str = "result") -> None:
    """Privacy check: no ndarray, no bytes, no base64-looking blob anywhere in a result."""
    if isinstance(obj, (np.ndarray, bytes, bytearray, memoryview)):
        raise AssertionError(f"{path} holds binary data ({type(obj).__name__})")
    if isinstance(obj, str):
        if _B64.search(obj):
            raise AssertionError(f"{path} holds a base64-looking blob")
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            assert_no_pixels(v, f"{path}.{k}")
    elif isinstance(obj, (list, tuple, set)):
        for i, v in enumerate(obj):
            assert_no_pixels(v, f"{path}[{i}]")


# ---- session handles ------------------------------------------------------------------------
@dataclass
class RunState:
    id: int
    trigger: str
    epoch: int
    t0: float
    calls: int = 0
    transport: str = "direct"
    actions: int = 0
    first_action_ms: float | None = None

    def acted(self) -> None:
        self.actions += 1
        if self.first_action_ms is None:
            self.first_action_ms = round((time.monotonic() - self.t0) * 1000.0, 1)


@dataclass
class SessionHandle:
    """What the tools act on: the coach session, its pipeline, the store and the intents queue."""

    session: Any  # CoachSession
    pipeline: Any  # SessionPipeline
    store: Any | None = None
    label: str = "Claude agent"
    recal_wait_s: float = 1.5
    intents: deque = field(default_factory=deque)
    run: RunState | None = None
    runs: int = 0
    tool_calls: int = 0
    last_speak_clock: float = -1e18
    prompt_seq: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def session_id(self) -> str:
        return self.session.session_id

    def begin_run(self, trigger: str, transport: str = "direct") -> RunState:
        with self.lock:
            self.runs += 1
            self.run = RunState(id=self.runs, trigger=trigger, epoch=self.session.epoch, t0=time.monotonic(), transport=transport)
            return self.run

    def end_run(self) -> RunState | None:
        with self.lock:
            run, self.run = self.run, None
            return run

    def status(self, state: str, trigger: str | None = None, reason: str | None = None) -> None:
        """Queue an `agent_status` event (always delivered, even after a stop)."""
        data = {"state": state, "label": self.label}
        if trigger is not None:
            data["trigger"] = trigger
        if reason is not None:
            data["reason"] = reason
        self.intents.append(("status", None, data))

    def _queue(self, kind: str, data: dict[str, Any]) -> None:
        epoch = self.run.epoch if self.run is not None else self.session.epoch
        self.intents.append((kind, epoch, data))

    def drain(self, t: float) -> list[Event]:
        """Apply queued agent outputs on the caller's (WebSocket) coroutine and return the events
        to send. The stop check runs again here: a pain stop mid-run drops what was queued."""
        out: list[Event] = []
        s = self.session
        while self.intents:
            kind, epoch, data = self.intents.popleft()
            if kind == "status":
                out.append(make_event("agent_status", t=t, **data))
                continue
            if s.stopped or (epoch is not None and epoch != s.epoch):
                why = "session stopped" if s.stopped else "stale: the session moved on"
                s.trace.log("agent_drop", reason=why, intent=kind, text=(data.get("decision").text if data.get("decision") else None))
                continue
            d: Decision | None = data.get("decision")
            if kind == "command":
                out.append(make_event("command", t=t, **data["payload"]))
            elif kind == "decision":
                out.append(s._coach_event(d, t))
            elif kind == "prompt":
                p = data["prompt"]
                s.add_prompt(p, data["prompt_kind"], data["reason"], data.get("accept"), d.evidence, self.label, d.action)
                out.append(s._coach_event(d, t))
            elif kind == "rest":
                out.append(s._coach_event(d, t))
                out += s._log_stop([make_event("rest", t=t, rule="agent", text=d.text, seconds=data["seconds"])])
            elif kind == "flag":
                detail = f"agent: {data['reason']}"
                s.stop_rules.flags.append({"t": t, "rule": "agent", "detail": detail})
                out += s._log_stop([make_event("therapist_flag", t=t, rule="agent", detail=detail)])
            elif kind == "stop":
                out.append(s._coach_event(d, t))
                s.stop_rules.stopped = True
                detail = f"agent ended the session: {data['reason']}"
                s.stop_rules.flags.append({"t": t, "rule": "agent", "detail": detail})
                out += s._log_stop([make_event("stop", t=t, rule="agent", text=d.text), make_event("therapist_flag", t=t, rule="agent", detail=detail)])
        return out


class Registry:
    """session_id -> SessionHandle, shared by the MCP servers and the agent coach."""

    def __init__(self) -> None:
        self._h: dict[str, SessionHandle] = {}
        self._lock = threading.Lock()

    def register(self, h: SessionHandle) -> SessionHandle:
        with self._lock:
            self._h[h.session_id] = h
            while len(self._h) > 50:
                self._h.pop(next(iter(self._h)))
        return h

    def get(self, session_id: str) -> SessionHandle | None:
        return self._h.get(session_id)

    def remove(self, session_id: str) -> None:
        with self._lock:
            self._h.pop(session_id, None)


REGISTRY = Registry()
_HANDLE: contextvars.ContextVar[SessionHandle] = contextvars.ContextVar("praxis_agent_handle")


def _h() -> SessionHandle:
    return _HANDLE.get()


# ---- dispatch -------------------------------------------------------------------------------
def invoke(name: str, args: dict[str, Any], transport: str, registry: Registry | None = None) -> dict[str, Any]:
    """Run one tool: look up the session, check budgets, time it, trace it, check privacy.
    Raises `ToolRejected` (after tracing) when a guardrail says no."""
    reg = registry or REGISTRY
    fn = TOOLS.get(name)
    if fn is None:
        raise ToolRejected(f"unknown tool {name!r}; the tools are {', '.join(TOOLS)}", "unknown_tool")
    sid = str(args.get("session_id", ""))
    h = reg.get(sid)
    if h is None:
        raise ToolRejected(f"unknown session {sid!r}", "unknown_session")
    t0 = time.perf_counter()
    ok, result, err = True, None, None
    try:
        with h.lock:
            if h.tool_calls >= SESSION_TOOL_CALLS:
                raise ToolRejected(f"session tool budget used ({SESSION_TOOL_CALLS} calls)", "budget")
            if h.run is not None and h.run.calls >= RUN_TOOL_CALLS:
                raise ToolRejected(f"run tool budget used ({RUN_TOOL_CALLS} calls); finish now", "budget")
            h.tool_calls += 1
            if h.run is not None:
                h.run.calls += 1
        token = _HANDLE.set(h)
        try:
            result = fn(**args)
        except TypeError as e:
            raise ToolRejected(f"malformed arguments for {name}: {e}", "malformed") from None
        finally:
            _HANDLE.reset(token)
        assert_no_pixels(result)
        return result
    except ToolRejected as e:
        ok, err = False, e
        raise
    except AssertionError as e:  # privacy guard tripped: never hand the result over
        ok, err = False, ToolRejected(f"internal: {e}", "privacy")
        raise err from None
    except Exception as e:
        ok, err = False, e
        raise
    finally:
        ms = round((time.perf_counter() - t0) * 1000.0, 1)
        summary = json.dumps(result if ok else {"error": str(err), "kind": getattr(err, "kind", "error")}, default=str)[:240]
        safe_args = {k: (v[:120] if isinstance(v, str) else v) for k, v in args.items() if k != "session_id"}
        h.session.trace.log("tool", server=SERVER_OF[name], name=name, args=safe_args, ok=ok, ms=ms, transport=transport, result_summary=summary, run=h.run.id if h.run else None)


def bind(name: str, transport: str, registry: Registry | None = None) -> Callable[..., dict[str, Any]]:
    """The tool as a plain function with its model-facing signature and docstring, routed
    through `invoke` with the given transport (FastMCP and Strands read the signature)."""
    impl = TOOLS[name]

    @functools.wraps(impl)
    def tool(**kwargs: Any) -> dict[str, Any]:
        return invoke(name, kwargs, transport, registry)

    return tool


# ---- guardrail helpers ----------------------------------------------------------------------
def _action_guard(evidence: Any, count: bool = True) -> list[int]:
    h = _h()
    s = h.session
    if h.run is None:
        raise ToolRejected("coach actions only run inside an agent checkpoint run", "no_run")
    if s.stopped:
        raise ToolRejected("the session is stopped; nothing more can be said or changed", "stopped")
    if h.run.epoch != s.epoch:
        raise ToolRejected("stale: the session moved on since this checkpoint", "stale")
    if not isinstance(evidence, (list, tuple)) or not evidence:
        raise ToolRejected("evidence must list at least one event id from get_events", "evidence")
    ids: list[int] = []
    for x in evidence:
        try:
            ids.append(int(x))
        except (TypeError, ValueError):
            raise ToolRejected(f"evidence ids must be integers, got {x!r}", "evidence") from None
    bad = [i for i in ids if not s.has_event(i)]
    if bad:
        raise ToolRejected(f"evidence ids {bad} are not events of this session", "evidence")
    if count:
        h.run.acted()
    return ids


def _text(value: Any, what: str, limit: int) -> str:
    text = str(value or "").strip()
    if not text:
        raise ToolRejected(f"{what} is empty", "text")
    if len(text) > limit:
        raise ToolRejected(f"{what} is {len(text)} characters; the limit is {limit}", "text")
    return text


def _decision(action: str, cue_id: str, text: str, reason: str, evidence: list[int], ui: dict[str, Any] | None = None, tool: str = "") -> Decision:
    h = _h()
    trigger = h.run.trigger if h.run else "external"
    # No `tool_calls` here: `invoke` already wrote the tool's own trace row (with `server`).
    ui = {**(ui or {}), "agent_tool": tool}
    return Decision(action, cue_id, text, reason or f"Claude agent at {trigger}", evidence, ui, h.label, [], source="agent")  # type: ignore[arg-type]


def _compact(e: Event) -> dict[str, Any]:
    d = {k: v for k, v in e.to_dict().items() if k not in _BIG_KEYS}
    for k, v in list(d.items()):
        if isinstance(v, list) and len(v) > 12:
            d[k] = v[:12]
        elif isinstance(v, dict):
            d[k] = {kk: vv for kk, vv in v.items() if not isinstance(vv, (list, dict))}
    return d


def _running(h: SessionHandle) -> dict[str, Any]:
    snap = h.pipeline.snapshot()
    if snap.get("arm"):
        a = snap["arm"]
        return {"exercise": a["exercise"], "tier": a["tier"], "target_deg": a["target_deg"], "hold_s": a["hold_s"], "reps_per_set": a["reps_per_set"], "sets": a["sets"], "set": a["set"], "rep": a["rep"]}
    if snap.get("cup"):
        c = snap["cup"]
        return {"exercise": "cup", "phase": c.get("phase"), "arcs_done": c.get("arcs_done"), "reaches_total": c.get("reaches_total")}
    return {"exercise": snap.get("mode")}


# ---- perception -----------------------------------------------------------------------------
def get_events(session_id: str, types: list[str] | None = None, last_n: int = 20) -> dict[str, Any]:
    """Recent perception and stop-rule events of this session (never frames), newest last.
    Use their `id` values as `evidence` for coach actions. `types` filters by event type
    (e.g. ["rep_complete", "pause"]); `last_n` is at most 50."""
    n = max(1, min(50, int(last_n)))
    evs = _h().session.recent_events(types=list(types) if types else None, last_n=n)
    return {"events": [_compact(e) for e in evs]}


def get_set_summary(session_id: str) -> dict[str, Any]:
    """The last finished set (arm) or arc (cup), or the one in progress: reps, verified and not
    verified (with reasons; `missed` = seen to fall short, `unverified` = camera could not check),
    peak angles, hold times, lean/hike counts, reach times, and the previous set's mean peak."""
    s = _h().session
    ring = s.recent_events(last_n=400)
    bounds = [i for i, e in enumerate(ring) if e.type in ("set_complete", "arc_complete", "nhpt_complete")]
    if bounds:
        end = bounds[-1]
        start = bounds[-2] + 1 if len(bounds) > 1 else 0
        kind = {"set_complete": "set", "arc_complete": "arc", "nhpt_complete": "nhpt"}[ring[end].type]
        boundary = ring[end]
        prev_start = bounds[-3] + 1 if len(bounds) > 2 else 0
        prev = ring[prev_start: bounds[-2]] if len(bounds) > 1 else []
    else:
        end, start, kind, boundary, prev = len(ring) - 1, 0, "in_progress", None, []
    block = ring[start: end + 1]
    reps = [e for e in block if e.type in ("rep_complete", "reach_complete")]
    peaks = [e.payload["peak_deg"] for e in reps if "peak_deg" in e.payload]
    prev_peaks = [e.payload["peak_deg"] for e in prev if e.type == "rep_complete" and "peak_deg" in e.payload]
    not_ok = [{"id": e.id, "reason": e.payload.get("reason"), "kind": "missed" if is_miss(e.payload) else "unverified"} for e in reps if e.payload.get("verified") is False]
    return {
        "kind": kind,
        "boundary_event_id": boundary.id if boundary else None,
        "boundary": _compact(boundary) if boundary else None,
        "reps": len(reps),
        "verified": sum(1 for e in reps if e.payload.get("verified", True)),
        "not_verified": not_ok,
        "rep_event_ids": [e.id for e in reps],
        "peak_deg": peaks,
        "previous_set_mean_peak_deg": round(sum(prev_peaks) / len(prev_peaks), 1) if prev_peaks else None,
        "hold_s": [e.payload["hold_s"] for e in reps if "hold_s" in e.payload],
        "lean_count": sum(1 for e in reps if e.payload.get("lean")),
        "hike_count": sum(1 for e in reps if e.payload.get("hike")),
        "reach_ms": [e.payload.get("reach_ms") for e in reps if e.type == "reach_complete"],
        "session_counts": dict(s.counts),
        "paused": s.paused,
        "pause_rule": s.pause_rule,
    }


def check_setup(session_id: str) -> dict[str, Any]:
    """Run the camera setup checks now with OpenCV on the latest frame in memory: ArUco markers
    found/missing and homography error (sheet tasks), camera tilt, task area, lighting and
    sharpness, marker steadiness; person / joints / view for the arm exercise. Each check is
    `pass`, `check` (with a fix hint) or `pending`; `failing` lists the ids to fix."""
    return _h().pipeline.check_setup()


def recalibrate(session_id: str) -> dict[str, Any]:
    """Reset the sheet calibration (sheet tasks: all four markers needed again) or the pose gate
    (arm), let the next frames through, and report markers found, homography error in mm and
    whether the pose is visible. Use after the patient has fixed the setup."""
    h = _h()
    s = h.session
    if s.stopped:
        raise ToolRejected("the session is stopped", "stopped")
    res = h.pipeline.command({"cmd": "recalibrate"})
    if not res.get("ok"):
        raise ToolRejected(res.get("error", "recalibrate is not available here"), "unsupported")
    h._queue("command", {"payload": {"cmd": "recalibrate", "source": "agent", "ok": True, "session_id": s.session_id, "reset": res["reset"]}})
    deadline = time.monotonic() + h.recal_wait_s
    while time.monotonic() < deadline and (h.pipeline.frames_since_recalibrate or 0) < RECAL_FRAMES:
        time.sleep(0.03)
    seen = int(h.pipeline.frames_since_recalibrate or 0)
    out: dict[str, Any] = {"ok": True, "reset": res["reset"], "frames_seen": seen}
    if seen == 0:
        chk = h.pipeline.check_setup()
        m = chk.get("measures", {})
        out |= {"note": "no new frames yet; checked the last frame instead", "failing": chk.get("failing", [])}
        if res["reset"] == "calibrator":
            out |= {"markers_found": m.get("markers_found"), "markers_missing": m.get("markers_missing"), "rms_mm": m.get("rms_mm")}
        else:
            out |= {"pose_visible": bool(m.get("pose_present")), "visibility": m.get("visibility")}
        return out
    if res["reset"] == "calibrator":
        cal = h.pipeline.last_calibration or {}
        out |= {"calibrated": cal.get("calibrated"), "markers_found": cal.get("markers_found"), "markers_missing": cal.get("missing"), "rms_mm": cal.get("rms_mm"), "tilt_deg": cal.get("tilt_deg")}
    else:
        pose = h.pipeline.last_pose or {}
        out |= {"pose_visible": bool(pose.get("present")), "visibility": pose.get("visibility"), "gate": pose.get("gate")}
    return out


# ---- exertion / program ---------------------------------------------------------------------
def get_exertion_state(session_id: str) -> dict[str, Any]:
    """Behavioural exertion (`low|moderate|high`, score, reasons) from rep-time slope, falling
    peaks, tremor and hesitation plus the last RPE; not a physiological measurement."""
    return dict(_h().session.exertion.state)


def get_prescription(session_id: str) -> dict[str, Any]:
    """The therapist's prescription for the running exercise: dose, what may be adapted and how
    far (`allowed_adaptations`), stop-rule thresholds, and what is running now."""
    h = _h()
    p = h.session.prescription
    run = _running(h)
    rx = _rx_key(h)
    return {
        "program": p.program,
        "level": p.level,
        "version": p.version,
        "exercise": run.get("exercise"),
        "dose": p.exercises.get(rx, {}),
        "allowed_adaptations": p.allowed_adaptations.get(rx, {}),
        "stop_rules": p.stop_rules.model_dump(),
        "running": run,
    }


def read_patient_model(session_id: str) -> dict[str, Any]:
    """Short history for this patient (last sessions, peg-test trend, open therapist flags).
    Empty for a replayed clip: a replay is not the patient's practice."""
    h = _h()
    if h.session.replay_clip:
        return {"sessions": [], "nhpt_trend": [], "open_flags": 0, "note": "replay session: no patient history is used"}
    if h.store is None:
        return {"sessions": [], "nhpt_trend": [], "open_flags": 0, "note": "no store attached"}
    pm = h.store.read_patient_model("alex")
    sessions = [
        {"date": x["date"], "mode": x["mode"], "status": x["status"], "tracking": x["tracking"], "verified": (x.get("camera") or {}).get("verified"), "unverified": (x.get("camera") or {}).get("unverified"), "sample": bool(x.get("illustrative"))}
        for x in pm.get("history", [])[:5]
    ]
    return {"sessions": sessions, "nhpt_trend": pm.get("nhpt_trend", [])[-5:], "open_flags": len(pm.get("open_flags", []))}


# ---- coach actions --------------------------------------------------------------------------
def speak(session_id: str, text: str, cue: str, evidence: list[int]) -> dict[str, Any]:
    """Say one short line to the patient (captioned). `cue` is `instruct` or `correct`; at most
    160 characters, at most one line every 4 s. `evidence`: ids of the events it is based on."""
    h = _h()
    if cue not in ("instruct", "correct"):
        raise ToolRejected("cue must be 'instruct' or 'correct'", "field")
    line = _text(text, "text", SPEAK_MAX_CHARS)
    ids = _action_guard(evidence, count=False)
    # Session clock (wall time live, clip time in replay), the clock the rule coach paces on.
    now = float(h.session.clock)
    if now - h.last_speak_clock < SPEAK_MIN_GAP_S:
        raise ToolRejected(f"rate limited: one line every {SPEAK_MIN_GAP_S:g} s", "rate")
    h.last_speak_clock = now
    h.run.acted()  # type: ignore[union-attr]
    h._queue("decision", {"decision": _decision(cue, "agent_speak", line, "", ids, tool="speak")})
    return {"ok": True, "queued": True, "action": cue}


def _rx_key(h: SessionHandle) -> str:
    arm = getattr(h.pipeline, "_arm", None)
    if arm is not None:
        return arm.exercise.rx
    return h.pipeline.mode


def propose_adjustment(session_id: str, exercise: str, field: str, value: float | str, reason: str, evidence: list[int]) -> dict[str, Any]:
    """Propose a dose change for the running exercise; the patient decides (Yes / Keep / Why).
    Fields: `target_deg`, `hold_s`, `reps` (Arm out to the side), `phase` = `fast`|`slow` (cup).
    The value is clamped to the prescription's allowed range; nothing changes unless the
    patient taps Yes. `reason` is shown when the patient asks why."""
    h = _h()
    s = h.session
    why = _text(reason, "reason", REASON_MAX_CHARS)
    run = _running(h)
    if exercise != run.get("exercise"):
        raise ToolRejected(f"{exercise!r} is not the running exercise ({run.get('exercise')!r})", "field")
    if s.prompts or s.pending_prompt or any(k == "prompt" for k, _, _ in list(h.intents)):
        raise ToolRejected("a prompt is already waiting for the patient", "prompt_pending")
    rx = _rx_key(h)
    if field in ARM_FIELDS and getattr(h.pipeline, "_arm", None) is not None:
        cmd, key, unit = ARM_FIELDS[field]
        try:
            wanted = float(value)
        except (TypeError, ValueError):
            raise ToolRejected(f"{field} needs a number", "field") from None
        try:
            new = clamp(s.prescription, rx, field, wanted)
        except KeyError:
            raise ToolRejected(f"{rx}.{field} is not an allowed adaptation", "field") from None
        if field == "reps":
            new = float(int(round(new)))
        current = float(run["reps_per_set"] if field == "reps" else run[field])
        if new == current:
            raise ToolRejected(f"no change: {field} is already {current:g} (after clamping {wanted:g} to the prescription)", "no_change")
        action = "progress" if new > current else "regress"
        value_out: float | str = int(new) if field == "reps" else new
        accept = {"cmd": cmd, key: value_out}
        requested: float | str = wanted
        title = f"Coach suggests: {FIELD_NAMES[field]} {value_out:g}{'°' if unit == '°' else ' ' + unit} instead of {current:g}{'°' if unit == '°' else ' ' + unit}"
    elif field == "phase" and h.pipeline.mode == "cup":
        want = str(value).lower()
        if want not in ("fast", "slow"):
            raise ToolRejected("phase must be 'fast' or 'slow'", "field")
        if want == "fast" and not s.prescription.allowed_adaptations.get("cup", {}).get("fast_arcs"):
            raise ToolRejected("cup.fast_arcs is not an allowed adaptation", "field")
        if want == run.get("phase"):
            raise ToolRejected(f"no change: the arcs are already {want}", "no_change")
        action, unit, value_out, requested = ("progress" if want == "fast" else "regress"), "", want, want
        accept = {"cmd": "set_phase", "phase": want}
        title = f"Coach suggests: {want} arcs"
    else:
        raise ToolRejected(f"field {field!r} cannot be adjusted for {exercise!r}", "field")
    ids = _action_guard(evidence)
    h.prompt_seq += 1
    pid = f"adj-{h.prompt_seq}"
    clamped = field != "phase" and float(value_out) != float(requested)  # type: ignore[arg-type]
    prompt = {
        "id": pid,
        "kind": "adjustment",
        "title": title,
        "text": why,
        "options": ["Yes, change it", "Keep as is", "Why?"],
        "within_prescription": True,
        "proposal": {"exercise": exercise, "field": field, "value": value_out, "requested": requested, "clamped": bool(clamped), "unit": unit},
    }
    line = f"{title.replace('Coach suggests: ', 'How about ')}? Tap Yes to change it, or Keep."
    d = _decision(action, "agent_propose", line[:SPEAK_MAX_CHARS], why, ids, {"prompt": prompt}, tool="propose_adjustment")
    h._queue("prompt", {"decision": d, "prompt": prompt, "prompt_kind": "adjustment", "reason": why, "accept": accept})
    return {"ok": True, "prompt_id": pid, "value": value_out, "requested": requested, "clamped": bool(clamped), "action": action, "applied": False}


def request_rest(session_id: str, seconds: int, reason: str, evidence: list[int]) -> dict[str, Any]:
    """Ask for a rest break of `seconds` (10-120). The patient resumes with a tap."""
    h = _h()
    why = _text(reason, "reason", REASON_MAX_CHARS)
    try:
        want = int(seconds)
    except (TypeError, ValueError):
        raise ToolRejected("seconds must be a whole number", "field") from None
    secs = max(REST_MIN_S, min(REST_MAX_S, want))
    ids = _action_guard(evidence)
    text = f"Let's rest for {secs} seconds. {why}"[:SPEAK_MAX_CHARS]
    h._queue("rest", {"decision": _decision("rest", "agent_rest", text, why, ids, {"chip": "rest"}, tool="request_rest"), "seconds": secs})
    return {"ok": True, "seconds": secs, "clamped": secs != want}


def request_resume(session_id: str, reason: str, evidence: list[int]) -> dict[str, Any]:
    """While a rule pause holds (unverified reps, lost tracking, lean), ask the patient whether
    to carry on: a "Setup looks good — resume?" prompt. The session resumes only on their tap."""
    h = _h()
    s = h.session
    why = _text(reason, "reason", REASON_MAX_CHARS)
    if not s.paused:
        raise ToolRejected("the session is not paused", "state")
    if s.pause_rule == "patient":
        raise ToolRejected("the patient paused themselves; they resume when they are ready", "state")
    ids = _action_guard(evidence)
    h.prompt_seq += 1
    pid = f"resume-{h.prompt_seq}"
    prompt = {"id": pid, "kind": "resume", "title": "Setup looks good — resume?", "text": why, "options": ["Yes, resume", "Not yet"], "within_prescription": True}
    d = _decision("instruct", "agent_resume_request", f"{why} Ready to carry on?"[:SPEAK_MAX_CHARS], why, ids, {"prompt": prompt}, tool="request_resume")
    h._queue("prompt", {"decision": d, "prompt": prompt, "prompt_kind": "resume", "reason": why, "accept": None})
    return {"ok": True, "prompt_id": pid, "resumed": False}


def flag_therapist(session_id: str, reason: str, evidence: list[int]) -> dict[str, Any]:
    """Write a therapist flag (shown on the therapist dashboard) citing the evidence."""
    h = _h()
    why = _text(reason, "reason", REASON_MAX_CHARS)
    _action_guard(evidence)
    h._queue("flag", {"reason": why})
    return {"ok": True, "flagged": True}


def end_session(session_id: str, reason: str, evidence: list[int]) -> dict[str, Any]:
    """End the session early (stop) and flag the therapist. The agent can end, never extend."""
    h = _h()
    why = _text(reason, "reason", REASON_MAX_CHARS)
    ids = _action_guard(evidence)
    text = "Let's stop here for today. Your therapist will see why."
    h._queue("stop", {"decision": _decision("stop", "agent_stop", text, why, ids, {"chip": "stop"}, tool="end_session"), "reason": why})
    return {"ok": True, "ended": True}


def write_session_summary(session_id: str, note: str, evidence: list[int]) -> dict[str, Any]:
    """Store a short coach note (at most 400 characters) with the session report."""
    h = _h()
    text = _text(note, "note", NOTE_MAX_CHARS)
    s = h.session
    if h.run is None:
        raise ToolRejected("coach actions only run inside an agent checkpoint run", "no_run")
    ids = [int(x) for x in evidence] if isinstance(evidence, (list, tuple)) and evidence else []
    if not ids or any(not s.has_event(i) for i in ids):
        raise ToolRejected("evidence must list event ids of this session", "evidence")
    h.run.acted()
    s.coach_note = {"text": text, "evidence": ids, "label": h.label}
    s.trace.log("coach_note", text=text, evidence=ids, label=h.label)
    stored = False
    if h.store is not None and hasattr(h.store, "set_coach_note"):
        stored = bool(h.store.set_coach_note(s.session_id, s.coach_note))
    return {"ok": True, "stored_in_report": stored}


TOOLS: dict[str, Callable[..., dict[str, Any]]] = {
    f.__name__: f
    for f in (
        get_events, get_set_summary, check_setup, recalibrate,
        get_exertion_state, get_prescription, read_patient_model,
        speak, propose_adjustment, request_rest, request_resume, flag_therapist, end_session, write_session_summary,
    )
}
