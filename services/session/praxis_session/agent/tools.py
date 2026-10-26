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
import math
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
# Praise after a clean set/arc: at most one `speak(cue="instruct")` per PRAISE_EVERY_N clean
# reviews, unless something changed (first review, an unverified or missed rep, a peak drop of
# PEAK_DROP_DEG or more, a correction since the last praise).
PRAISE_EVERY_N = 3
PEAK_DROP_DEG = 3.0
REVIEW_TRIGGERS = ("arc_complete", "set_complete")

POLICY_VERSION = "2026-10-21.1"  # the autonomy policy (AUTONOMY below); in every agent_run row
PLAN_MAX_ITEMS = 3
PLAN_ITEM_MAX_CHARS = 100
BECAUSE_MAX_CHARS = 200

SERVERS: dict[str, tuple[str, ...]] = {
    "perception": ("get_events", "get_set_summary", "check_setup", "recalibrate", "resample_target_colour"),
    "exertion": ("get_exertion_state", "get_prescription", "read_patient_model", "get_session_plan"),
    "coach": ("speak", "propose_adjustment", "request_rest", "request_resume", "flag_therapist", "end_session", "write_session_summary", "set_session_plan"),
}

# The autonomy policy (10 Oct), one table the tool layer enforces (`invoke`) and docs/AGENT.md
# renders (`autonomy_markdown`). Levels:
# - autonomous: the agent may call it on its own, at any time in a run (reads; the report note);
# - forbidden_after_stop: on its own, but refused once a stop rule or the agent ended the session;
# - patient_approval: only ever a prompt; nothing changes until the patient taps Yes (also
#   refused after a stop);
# - never: not a tool at all; refused by name if anything asks for it.
AUTONOMY_LEVELS = ("autonomous", "forbidden_after_stop", "patient_approval", "never")
AUTONOMY: dict[str, tuple[str, str]] = {
    "get_events": ("autonomous", "read-only: this session's events (ids are the evidence)"),
    "get_set_summary": ("autonomous", "read-only: the last set or arc in numbers"),
    "check_setup": ("autonomous", "read-only OpenCV checks on the latest frame; changes nothing"),
    "get_exertion_state": ("autonomous", "read-only behavioural exertion"),
    "get_prescription": ("autonomous", "read-only: dose, allowed adaptations, stop rules"),
    "read_patient_model": ("autonomous", "read-only short history (empty for a replay)"),
    "get_session_plan": ("autonomous", "read-only: the agent's own plan for this session"),
    "write_session_summary": ("autonomous", "a factual coach note in the report; allowed after a stop so the stop is explained"),
    "recalibrate": ("forbidden_after_stop", "resets tracking only (calibrator or pose gate); no dose change"),
    "resample_target_colour": ("forbidden_after_stop", "tunes the cup/peg colour window only when OpenCV detection then succeeds where it failed; no dose change"),
    "set_session_plan": ("forbidden_after_stop", "internal plan (goals, what to watch); every version cites evidence, a revision needs new evidence and a reason"),
    "speak": ("forbidden_after_stop", "one captioned line, <= 160 chars, rate-limited, praise limited, evidence required"),
    "request_rest": ("forbidden_after_stop", "a 10-120 s rest only makes the session safer; the patient resumes"),
    "flag_therapist": ("forbidden_after_stop", "adds a flag for the therapist; never clears one"),
    "end_session": ("forbidden_after_stop", "can end the session early, never extend it"),
    "propose_adjustment": ("patient_approval", "a dose change is a Yes / Keep / Why prompt, clamped to the prescription here and again when applied"),
    "request_resume": ("patient_approval", "a resume prompt, offered only after a fresh passing setup check"),
    "apply_adjustment": ("never", "only the patient's Yes applies a dose change"),
    "resume_session": ("never", "only the patient's tap resumes a paused session"),
    "change_prescription": ("never", "the therapist prescribes; the agent works inside the prescription"),
    "override_stop_rule": ("never", "stop rules run before the agent and it cannot lift them"),
    "clear_therapist_flag": ("never", "flags are the therapist's to review"),
    "raise_ceiling": ("never", "the 90 deg ceiling and the prescription's ranges are enforced in code"),
}


def autonomy_markdown() -> str:
    """The AUTONOMY table as Markdown (docs/AGENT.md holds this exact text; a test checks it)."""
    lines = ["| Tool | Autonomy | Why |", "|---|---|---|"]
    order = {lvl: i for i, lvl in enumerate(AUTONOMY_LEVELS)}
    for name, (lvl, why) in sorted(AUTONOMY.items(), key=lambda kv: (order[kv[1][0]], kv[0])):
        lines.append(f"| `{name}` | {lvl} | {why} |")
    return "\n".join(lines)
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
    "set_session_plan": "instruct",
}
ARM_FIELDS = {"target_deg": ("set_target", "target_deg", "°"), "hold_s": ("set_hold", "hold_s", "s"), "reps": ("set_reps", "reps", "reps")}
FIELD_NAMES = {"target_deg": "target", "hold_s": "hold", "reps": "reps per set", "phase": "arc speed"}
_BIG_KEYS = {"overlay", "markers_px", "hand", "pose", "board", "targets_px", "skeleton_px", "free_pegs_mm", "splits_s", "occupancy", "colour"}
_B64 = re.compile(r"[A-Za-z0-9+/=_-]{200,}")


# Rejection kinds that are a guardrail doing its job on the session's state (the session moved
# on, stopped or ended, the clamped value is already in force, a rate limit or budget, a prompt
# already waiting), not a bad call (21 Oct team test). The trace row says `refused: true` for
# these; review.py counts them apart from tool failures (malformed arguments, bad evidence...).
REFUSAL_KINDS = frozenset({"stale", "stopped", "ended", "no_change", "rate", "prompt_pending", "state", "budget", "policy"})


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
    lines: int = 0  # speak lines said in this run

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
    # request_resume refused (setup still failing): one more `correct` line may break the 4 s gap
    fix_repeat_allowed: bool = False
    # praise rate limit (PRAISE_EVERY_N)
    praised: bool = False
    clean_reviews: int = 0
    praise_run_seen: int | None = None
    corrections_at_praise: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def session_id(self) -> str:
        return self.session.session_id

    def begin_run(self, trigger: str, transport: str = "direct") -> RunState:
        with self.lock:
            self.runs += 1
            self.run = RunState(id=self.runs, trigger=trigger, epoch=self.session.epoch, t0=time.monotonic(), transport=transport)
            self.fix_repeat_allowed = False
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
        """Queue an output of the current run. A tool that finishes after its run ended (timed
        out or cancelled while the tool was still working) queues nothing (11 Oct audit)."""
        run = self.run
        if run is None:
            d = data.get("decision")
            self.session.trace.log("agent_drop", reason="run ended before the tool finished", intent=kind, text=d.text if d is not None else None)
            return
        self.intents.append((kind, run.epoch, data))

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
    level = AUTONOMY.get(name, ("", ""))[0]
    if fn is None and level != "never":
        raise ToolRejected(f"unknown tool {name!r}; the tools are {', '.join(TOOLS)}", "unknown_tool")
    sid = str(args.get("session_id", ""))
    h = reg.get(sid)
    if h is None:
        raise ToolRejected(f"unknown session {sid!r}", "unknown_session")
    t0 = time.perf_counter()
    ok, result, err = True, None, None
    try:
        # The autonomy policy, before budgets and before the tool runs.
        if level == "never":
            raise ToolRejected(f"{name} is never allowed: {AUTONOMY[name][1]}", "policy")
        if level in ("forbidden_after_stop", "patient_approval") and h.session.stopped:
            raise ToolRejected(f"{name} is forbidden after a stop: the session is stopped", "stopped")
        if level in ("forbidden_after_stop", "patient_approval") and getattr(h.session, "ended", False):
            # 11 Oct: once the patient has finished (feedback sent), the agent may only read and
            # write the report note; nothing it says, proposes or flags would reach anyone.
            raise ToolRejected(f"{name} is not allowed once the session has ended: only reads and the report note", "ended")
        assert fn is not None
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
        if level == "patient_approval" and (result.get("applied") or result.get("resumed")):
            raise ToolRejected(f"internal: {name} must only prompt the patient", "policy")
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
        safe_args = {k: (v[:SPEAK_MAX_CHARS] if isinstance(v, str) else v) for k, v in args.items() if k != "session_id"}
        extra: dict[str, Any] = {}
        if not ok:
            kind = getattr(err, "kind", "error")
            extra |= {"error_kind": kind, "refused": kind in REFUSAL_KINDS}
        if ok and isinstance(result, dict) and name in OPENCV_TOOLS:
            extra["opencv"] = opencv_digest(name, result)
        h.session.trace.log("tool", server=SERVER_OF.get(name, "none"), name=name, autonomy=level or None, args=safe_args, ok=ok, ms=ms, transport=transport, result_summary=summary, run=h.run.id if h.run else None, **extra)


OPENCV_TOOLS = ("check_setup", "recalibrate", "resample_target_colour")
_DIGEST_MEASURES = ("markers_found", "markers_missing", "rms_mm", "tilt_deg", "jitter_px", "mean_luma", "sharpness", "target", "target_seen", "colour_source", "pose_present", "visibility", "facing", "needed_view", "gate", "trunk_lean_deg")


def opencv_digest(name: str, result: dict[str, Any]) -> dict[str, Any]:
    """What OpenCV found, in a few readable fields for the trace (11 Oct): the 240-character
    `result_summary` cut a `check_setup` result off before its failing checks and hint."""
    if name == "check_setup":
        m = result.get("measures") or {}
        return {"failing": result.get("failing", []), "first_hint": result.get("first_hint"), "frame_age_s": result.get("frame_age_s")} | {k: m[k] for k in _DIGEST_MEASURES if k in m}
    if name == "resample_target_colour":
        return {k: result.get(k) for k in ("target", "applied", "reason", "before", "after", "sampled_at_dot", "sampled_at_mm") if result.get(k) is not None} | {"tried": len(result.get("tried") or [])}
    keys = ("reset", "frames_seen", "calibrated", "markers_found", "markers_missing", "rms_mm", "tilt_deg", "pose_visible", "visibility", "gate", "failing", "note")
    return {k: result[k] for k in keys if k in result}


def bind(name: str, transport: str, registry: Registry | None = None) -> Callable[..., dict[str, Any]]:
    """The tool as a plain function with its model-facing signature and docstring, routed
    through `invoke` with the given transport (FastMCP and Strands read the signature)."""
    impl = TOOLS[name]

    @functools.wraps(impl)
    def tool(**kwargs: Any) -> dict[str, Any]:
        return invoke(name, kwargs, transport, registry)

    return tool


# ---- guardrail helpers ----------------------------------------------------------------------
def _number(value: Any, what: str) -> float:
    """A finite number from a model argument (a number or a numeric string); bools, NaN and
    infinities are refused (NaN used to clamp to the prescription's maximum)."""
    if isinstance(value, bool):
        raise ToolRejected(f"{what} needs a number, got {value!r}", "field")
    try:
        x = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ToolRejected(f"{what} needs a number, got {value!r}", "field") from None
    if not math.isfinite(x):
        raise ToolRejected(f"{what} must be a finite number, got {value!r}", "field")
    return x


def _event_id(value: Any) -> int:
    """An evidence id: an int, or a string of digits (models sometimes quote ids). Bools,
    fractions, NaN/inf and anything else are refused, never truncated into some other id."""
    if isinstance(value, bool):
        raise ToolRejected(f"evidence ids must be integers, got {value!r}", "evidence")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    raise ToolRejected(f"evidence ids must be integers, got {value!r}", "evidence")


def _evidence_ids(evidence: Any) -> list[int]:
    if not isinstance(evidence, (list, tuple)) or not evidence:
        raise ToolRejected("evidence must list at least one event id from get_events", "evidence")
    return [_event_id(x) for x in evidence]


def _run_guard(h: SessionHandle) -> RunState:
    """The current run, live and not stale; otherwise the call is refused."""
    run = h.run
    if run is None:
        raise ToolRejected("coach actions only run inside an agent checkpoint run", "no_run")
    if h.session.stopped:
        raise ToolRejected("the session is stopped; nothing more can be said or changed", "stopped")
    if run.epoch != h.session.epoch:
        raise ToolRejected("stale: the session moved on since this checkpoint", "stale")
    return run


def _acted(h: SessionHandle) -> None:
    run = h.run  # None when the run ended while this tool was still working
    if run is not None:
        run.acted()


def _action_guard(evidence: Any, count: bool = True) -> list[int]:
    h = _h()
    s = h.session
    _run_guard(h)
    ids = _evidence_ids(evidence)
    bad = [i for i in ids if not s.has_event(i)]
    if bad:
        raise ToolRejected(f"evidence ids {bad} are not events of this session", "evidence")
    if count:
        _acted(h)
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
    ui = {**(ui or {}), "agent_tool": tool, "agent_run": h.run.id if h.run else None}
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
    n = max(1, min(50, int(_number(last_n, "last_n"))))
    evs = _h().session.recent_events(types=list(types) if types else None, last_n=n)
    return {"events": [_compact(e) for e in evs]}


def get_set_summary(session_id: str) -> dict[str, Any]:
    """The last finished set (arm) or arc (cup), or the one in progress: reps, verified and not
    verified (with reasons; `missed` = seen to fall short, `unverified` = camera could not check),
    peak angles, hold times, lean/hike/above-ceiling counts, reach times, and the previous set's
    mean peak. After the peg test, `nhpt` holds its total time and the nine per-peg splits."""
    return _set_summary(_h().session)


def _set_summary(s: Any) -> dict[str, Any]:
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
    nhpt = None
    if kind == "nhpt" and boundary is not None:
        # The peg-test result in numbers (11 Oct): `_compact` strips the splits list from
        # events, so the nhpt_complete job ("time, splits") had nothing to explain them with.
        splits = [round(float(x), 2) for x in (boundary.payload.get("splits_s") or [])][:9]
        nhpt = {
            "total_s": boundary.payload.get("total_s"),
            "splits_s": splits,
            "pegs": len(splits),
            "slowest_peg": (splits.index(max(splits)) + 1) if splits else None,
            "fastest_peg": (splits.index(min(splits)) + 1) if splits else None,
            "tracking_lost_events": getattr(s, "tracking_lost_events", 0),
        }
    return {
        "nhpt": nhpt,
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
        "above_ceiling_count": sum(1 for e in reps if e.payload.get("above_ceiling")),
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
    """Reset the sheet calibration (sheet tasks: corners still where the last fix puts them
    resume at once, a moved sheet needs corners that fit) or the pose gate (arm), let the next
    frames through, and report markers found, homography error in mm and whether the pose is
    visible. Use after the patient has fixed the setup."""
    h = _h()
    s = h.session
    # 11 Oct: it resets tracking, so like every action it needs a live agent run (an outside
    # MCP client with the token can read perception but not reset it mid-session).
    _run_guard(h)
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


def resample_target_colour(session_id: str, target: str, evidence: list[int]) -> dict[str, Any]:
    """Active perception, OpenCV on the latest frame: use when the sheet's markers are found but
    check_setup says the cup (or the pegs) is not seen, e.g. a cup that is not blue. Warps to
    the sheet, samples the colour where the target should be (the cup on a dot; peg-sized
    colour patches), tests detection with that colour against the current one and applies it
    only if the target is then detected where it was not. `target`: "cup" or "pegs". Returns
    before/after detection (never pixels). If `applied`, tell the patient the camera had not
    recognised their cup's colour and has now learned it; otherwise ask them to put the cup
    on a dot."""
    h = _h()
    s = h.session
    if target not in ("cup", "pegs"):
        raise ToolRejected("target must be 'cup' or 'pegs'", "field")
    ids = _action_guard(evidence, count=False)
    res = h.pipeline.resample_target_colour(target)
    if not res.get("ok"):
        raise ToolRejected(str(res.get("error", "resample is not available here")), "unsupported")
    s.trace.log("resample", target=target, applied=bool(res.get("applied")), before=res.get("before"), after=res.get("after"), colour=res.get("colour"), evidence=ids, run=h.run.id if h.run else None)
    if res.get("applied"):
        _acted(h)
        h._queue("command", {"payload": {"cmd": "sample_colour", "source": "agent", "ok": True, "session_id": s.session_id, "target": target, "colour": res.get("colour"), "evidence": ids}})
    return {k: v for k, v in res.items() if k != "tried"} | {"tried": (res.get("tried") or [])[:6]}


# ---- exertion / program ---------------------------------------------------------------------
def get_exertion_state(session_id: str) -> dict[str, Any]:
    """Behavioural exertion (`low|moderate|high`, score, reasons) from rep-time slope, falling
    peaks and tremor plus the last RPE; not a physiological measurement."""
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
    """Say one short line to the patient (captioned). `cue`: `instruct` for guidance, plans and
    praise; `correct` only to fix a fault (form, setup). At most 160 characters, at most one
    line every 4 s. `evidence`: ids of the events it is based on."""
    h = _h()
    if cue not in ("instruct", "correct"):
        raise ToolRejected("cue must be 'instruct' or 'correct'", "field")
    line = _text(text, "text", SPEAK_MAX_CHARS)
    ids = _action_guard(evidence, count=False)
    if cue == "instruct" and h.run is not None and h.run.trigger in REVIEW_TRIGGERS:
        why_not = _praise_gate(h)
        if why_not is not None:
            h.session.trace.log("praise_suppressed", reason=why_not, text=line, evidence=ids, run=h.run.id)
            return {"ok": True, "suppressed": True, "reason": why_not, "action": cue}
    # Session clock (wall time live, clip time in replay), the clock the rule coach paces on.
    now = float(h.session.clock)
    run = h.run
    # 12 Oct (real video): the first fix line of a pause run may break the gap: the session is
    # paused, nothing else is being said, and a pause 3 s after the opening line used to lose it.
    pause_fix = cue == "correct" and run is not None and run.trigger.startswith("pause") and run.lines == 0
    if now - h.last_speak_clock < SPEAK_MIN_GAP_S:
        if not (cue == "correct" and h.fix_repeat_allowed) and not pause_fix:
            raise ToolRejected(f"rate limited: one line every {SPEAK_MIN_GAP_S:g} s", "rate")
        if not pause_fix:
            h.fix_repeat_allowed = False  # the one repeat after a refused resume
    if run is not None:
        run.lines += 1
    h.last_speak_clock = now
    _acted(h)
    h._queue("decision", {"decision": _decision(cue, "agent_speak", line, "", ids, tool="speak")})
    return {"ok": True, "queued": True, "action": cue}


def _praise_gate(h: SessionHandle) -> str | None:
    """None when this praise may be said; otherwise why it is held back. Counted per review
    (one set/arc checkpoint run), not per call."""
    s = h.session
    run = h.run
    assert run is not None
    if h.praise_run_seen != run.id:
        h.praise_run_seen = run.id
        h.clean_reviews += 1
    summ = _set_summary(s)
    changed: list[str] = []
    if not h.praised:
        changed.append("first review")
    if summ["not_verified"]:
        changed.append("reps not verified")
    peaks, prev = summ["peak_deg"], summ["previous_set_mean_peak_deg"]
    if peaks and prev is not None and prev - sum(peaks) / len(peaks) >= PEAK_DROP_DEG:
        changed.append("peak drop")
    if int(s.counts.get("corrections", 0)) != h.corrections_at_praise:
        changed.append("a correction since the last praise")
    if changed or h.clean_reviews >= PRAISE_EVERY_N:
        h.praised, h.clean_reviews = True, 0
        h.corrections_at_praise = int(s.counts.get("corrections", 0))
        return None
    return f"praise rate limit: {h.clean_reviews} clean review(s) since the last praise (at most one per {PRAISE_EVERY_N} unless something changed)"


def _prompt_waiting(h: SessionHandle) -> bool:
    """One prompt at a time: an unanswered prompt, or one queued and not yet delivered."""
    s = h.session
    return bool(s.prompts or s.pending_prompt or any(k == "prompt" for k, _, _ in list(h.intents)))


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
    if _prompt_waiting(h):
        raise ToolRejected("a prompt is already waiting for the patient", "prompt_pending")
    rx = _rx_key(h)
    if field in ARM_FIELDS and getattr(h.pipeline, "_arm", None) is not None:
        cmd, key, unit = ARM_FIELDS[field]
        wanted = _number(value, field)
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
    want = int(round(_number(seconds, "seconds")))
    secs = max(REST_MIN_S, min(REST_MAX_S, want))
    ids = _action_guard(evidence)
    text = f"Let's rest for {secs} seconds. {why}"[:SPEAK_MAX_CHARS]
    h._queue("rest", {"decision": _decision("rest", "agent_rest", text, why, ids, {"chip": "rest"}, tool="request_rest"), "seconds": secs})
    return {"ok": True, "seconds": secs, "clamped": secs != want}


def request_resume(session_id: str, reason: str, evidence: list[int]) -> dict[str, Any]:
    """While a rule pause holds (unverified reps, lost tracking, lean), ask the patient whether
    to carry on: a "Setup looks good — resume?" prompt. The session resumes only on their tap.
    A fresh camera setup check runs first: if any check still fails, no prompt is shown and the
    result is `{ok: false, reason: "setup still failing: <check>"}`; say the fix again."""
    h = _h()
    s = h.session
    why = _text(reason, "reason", REASON_MAX_CHARS)
    if not s.paused:
        raise ToolRejected("the session is not paused", "state")
    if s.pause_rule == "patient":
        raise ToolRejected("the patient paused themselves; they resume when they are ready", "state")
    if _prompt_waiting(h):
        raise ToolRejected("a prompt is already waiting for the patient", "prompt_pending")
    ids = _action_guard(evidence, count=False)
    # 10 Oct: never offer a resume the camera has not confirmed. A fresh OpenCV setup check
    # runs here, on the latest frame; anything still failing means no prompt at all.
    chk = h.pipeline.check_setup()
    if not chk.get("ok"):
        why_not = f"setup could not be checked: {chk.get('error', 'no frame')}"
        s.trace.log("resume_blocked", reason=why_not, evidence=ids)
        h.fix_repeat_allowed = True
        return {"ok": False, "reason": why_not, "resume_offered": False}
    if chk.get("failing"):
        first = next(c for c in chk["checks"] if c["status"] != "pass")
        why_not = f"setup still failing: {first['id']}"
        s.trace.log("resume_blocked", reason=why_not, failing=chk["failing"], evidence=ids)
        h.fix_repeat_allowed = True
        return {"ok": False, "reason": why_not, "failing": chk["failing"], "hint": first.get("hint"), "resume_offered": False, "next": "say the fix again (one repeat is allowed now); do not offer a resume"}
    _acted(h)
    h.prompt_seq += 1
    pid = f"resume-{h.prompt_seq}"
    prompt = {"id": pid, "kind": "resume", "title": "Setup looks good — resume?", "text": why, "options": ["Yes, resume", "Not yet"], "within_prescription": True}
    # the caption asks once: the model's reason may already end in a question
    stem = why.rstrip()
    caption = stem if stem.endswith("?") else f"{stem}{'' if stem.endswith(('.', '!')) else '.'} Ready to carry on?"
    d = _decision("instruct", "agent_resume_request", caption[:SPEAK_MAX_CHARS], why, ids, {"prompt": prompt}, tool="request_resume")
    h._queue("prompt", {"decision": d, "prompt": prompt, "prompt_kind": "resume", "reason": why, "accept": None})
    return {"ok": True, "prompt_id": pid, "resumed": False, "setup_checked": True}


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
    ids = _evidence_ids(evidence)
    if any(not s.has_event(i) for i in ids):
        raise ToolRejected("evidence must list event ids of this session", "evidence")
    _acted(h)
    s.coach_note = {"text": text, "evidence": ids, "label": h.label}
    s.trace.log("coach_note", text=text, evidence=ids, label=h.label)
    stored = False
    if h.store is not None and hasattr(h.store, "set_coach_note"):
        stored = bool(h.store.set_coach_note(s.session_id, s.coach_note))
    return {"ok": True, "stored_in_report": stored}


def _items(value: Any, what: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, (list, tuple)):
        raise ToolRejected(f"{what} must be a list of short strings", "field")
    if len(value) > PLAN_MAX_ITEMS:
        raise ToolRejected(f"{what}: at most {PLAN_MAX_ITEMS} items", "field")
    return [_text(v, f"{what} item", PLAN_ITEM_MAX_CHARS) for v in value]


def set_session_plan(session_id: str, goals: list[str], watch: list[str], evidence: list[int], because: str = "") -> dict[str, Any]:
    """Set the session plan at check-in, or revise it later: up to 3 `goals` (what this session
    aims for, within the prescription) and up to 3 things to `watch` (e.g. trunk lean, falling
    peaks, cup hidden by the hand), each <= 100 characters. A revision must cite at least one
    event id that no earlier version cited and say `because` (what the camera showed); only
    revise when new evidence warrants it. The patient does not see the plan; the report does."""
    h = _h()
    s = h.session
    ids = _action_guard(evidence, count=False)
    goal_list, watch_list = _items(goals, "goals"), _items(watch, "watch")
    if not goal_list:
        raise ToolRejected("goals: give at least one goal", "field")
    prev = s.plan
    if prev is not None:
        why = _text(because, "because (what new evidence changed the plan)", BECAUSE_MAX_CHARS)
        cited = {i for v in s.plan_history for i in v["evidence"]}
        if not [i for i in ids if i not in cited]:
            raise ToolRejected("a revision needs new evidence: cite an event id that no earlier plan version cited", "evidence")
    else:
        why = (str(because or "").strip()[:BECAUSE_MAX_CHARS]) or None
    plan = {
        "version": len(s.plan_history) + 1,
        "goals": goal_list,
        "watch": watch_list,
        "evidence": ids,
        "because": why,
        "trigger": h.run.trigger if h.run else None,
        "t": s.clock,
        "label": h.label,
    }
    s.set_plan(plan)
    return {"ok": True, "version": plan["version"], "revised": prev is not None}


def get_session_plan(session_id: str) -> dict[str, Any]:
    """The current session plan (goals, what to watch, evidence, why it last changed) and how
    many versions it has had; `plan` is null before the check-in sets one."""
    s = _h().session
    return {"plan": s.plan, "versions": len(s.plan_history)}


TOOLS: dict[str, Callable[..., dict[str, Any]]] = {
    f.__name__: f
    for f in (
        get_events, get_set_summary, check_setup, recalibrate, resample_target_colour,
        get_exertion_state, get_prescription, read_patient_model, get_session_plan,
        speak, propose_adjustment, request_rest, request_resume, flag_therapist, end_session, write_session_summary, set_session_plan,
    )
}
