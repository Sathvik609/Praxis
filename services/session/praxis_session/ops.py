"""Operational logs and CloudWatch Embedded Metric Format (EMF) lines (12 Oct).

One JSON object per line on stdout for the events an operator needs: `session_start`,
`session_end` (per-session summary: exercise, live/replay, duration, verified/unverified reps,
per-frame processing p50/p95, fps, event-to-cue p50/p95), `stop_rule` (pause/rest/stop),
`therapist_flag`, `perception_lost`, `ws_error` and a 60 s `heartbeat`. The agent's own lines
(`agent_run`, `agent_error`) come from `agent/metrics.py` and use the EMF helpers below.

Overhead is per session and per event of note, never per frame: the frame loop only feeds the
counters `LatencyStats` already keeps.

Privacy: no frames, no usernames, no free text, no pain scores or flag details. Every field goes
through `clean()`, which drops denied keys and binary/array values at any depth and truncates
strings, so a summary passed in by mistake cannot leak what the report keeps.

EMF (gated by `PRAXIS_EMF=1`, set in the systemd unit, off locally): the same line gains an
`_aws` block plus top-level dimension and metric keys, so CloudWatch Logs extracts metrics from
the log group the CloudWatch agent ships (no SDK, no extra dependency, no PutMetricData call).
Namespace `Praxis`; per-session metrics carry the dimensions Exercise and Mode (live|replay);
service-wide ones (heartbeat, agent, socket errors) carry Service=session only. Every metric
name is registered in `METRICS` with its unit; `infra/ec2/cloudwatch/dashboard.json` and the
alarms in `infra/ec2/cloudwatch_setup.sh` are tested against it.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from collections import Counter
from typing import Any, Callable, Iterable

NAMESPACE = "Praxis"
SERVICE = "session"
SESSION_DIMS = ("Exercise", "Mode")
SERVICE_DIMS = ("Service",)
HEARTBEAT_S = 60.0
MAX_STR = 160

# name -> (unit, dimension set). Few names on purpose: each name x dimension combination is a
# CloudWatch custom metric (billed pro rata per hour it receives data).
METRICS: dict[str, tuple[str, tuple[str, ...]]] = {
    # per session (session_end)
    "Sessions": ("Count", SESSION_DIMS),
    "RepsVerified": ("Count", SESSION_DIMS),
    "RepsUnverified": ("Count", SESSION_DIMS),
    "FrameProcP50Ms": ("Milliseconds", SESSION_DIMS),
    "FrameProcP95Ms": ("Milliseconds", SESSION_DIMS),
    "Fps": ("Count/Second", SESSION_DIMS),
    "EventToCueP50Ms": ("Milliseconds", SESSION_DIMS),
    "EventToCueP95Ms": ("Milliseconds", SESSION_DIMS),
    "StopRuleActions": ("Count", SESSION_DIMS),
    "PerceptionLost": ("Count", SESSION_DIMS),
    # service-wide
    "Heartbeat": ("Count", SERVICE_DIMS),
    "ActiveSessions": ("Count", SERVICE_DIMS),
    "WsErrors": ("Count", SERVICE_DIMS),
    "AgentRuns": ("Count", SERVICE_DIMS),
    "AgentFallbacks": ("Count", SERVICE_DIMS),
    "AgentErrors": ("Count", SERVICE_DIMS),
    "AgentCostUSD": ("None", SERVICE_DIMS),
    "AgentFirstActionMs": ("Milliseconds", SERVICE_DIMS),
}

# Keys never written to an ops line, at any depth (case-insensitive).
DENY_KEYS = frozenset({
    "username", "user", "name", "email", "patient", "notes", "note", "text", "detail", "details",
    "told_us", "checkin", "feedback", "reported_pain", "pain", "pain_after", "frame", "image",
    "jpeg", "img", "pixels", "bytes", "data", "landmarks", "prompt", "patient_note", "transcript",
})


def emf_enabled() -> bool:
    """Read at call time so a test (or the unit's Environment=) decides per process."""
    return os.environ.get("PRAXIS_EMF", "0") == "1"


def clean(value: Any, _depth: int = 0) -> Any:
    """Drop denied keys and binary or array values; truncate strings; cap nesting."""
    if _depth > 4:
        return None
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if str(k).lower() in DENY_KEYS or _is_binary(v):
                continue
            out[str(k)] = clean(v, _depth + 1)
        return out
    if isinstance(value, (list, tuple, set, frozenset)):
        return [clean(v, _depth + 1) for v in list(value)[:50] if not _is_binary(v)]
    if isinstance(value, str):
        return value[:MAX_STR]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:MAX_STR]


def _is_binary(v: Any) -> bool:
    return isinstance(v, (bytes, bytearray, memoryview)) or hasattr(v, "shape") or hasattr(v, "tobytes")


def emf_fields(metrics: dict[str, float | int | None], dims: dict[str, str], ts_ms: int) -> dict[str, Any]:
    """The `_aws` block plus top-level dimension and metric keys for one EMF document.

    Metrics with a None value are left out (e.g. no cues -> no event-to-cue latency). Unknown
    names raise KeyError, so a typo fails a test instead of creating a stray custom metric."""
    present = {k: v for k, v in metrics.items() if v is not None}
    if not present:
        return {}
    groups: dict[tuple[str, ...], list[str]] = {}
    for name in present:
        unit, dset = METRICS[name]
        groups.setdefault(dset, []).append(name)
    directives = []
    for dset, names in groups.items():
        missing = [d for d in dset if not dims.get(d)]
        if missing:
            raise KeyError(f"dimension(s) {missing} missing for {names}")
        directives.append({
            "Namespace": NAMESPACE,
            "Dimensions": [list(dset)],
            "Metrics": [{"Name": n, "Unit": METRICS[n][0]} for n in names],
        })
    used = {d for dset in groups for d in dset}
    return {
        "_aws": {"Timestamp": int(ts_ms), "CloudWatchMetrics": directives},
        **{d: str(dims[d])[:64] for d in used},
        **{k: float(v) for k, v in present.items()},
    }


def build(evt: str, fields: dict[str, Any] | None = None, metrics: dict[str, float | int | None] | None = None, dims: dict[str, str] | None = None, now: float | None = None) -> dict[str, Any]:
    """One ops line as a dict (cleaned fields; EMF keys only when enabled)."""
    ts = time.time() if now is None else now
    row: dict[str, Any] = {"evt": evt, "ts": round(ts, 3), **clean(fields or {})}
    if metrics and emf_enabled():
        row.update(emf_fields(metrics, {"Service": SERVICE, **(dims or {})}, int(ts * 1000)))
    return row


def emit(evt: str, fields: dict[str, Any] | None = None, metrics: dict[str, float | int | None] | None = None, dims: dict[str, str] | None = None, now: float | None = None) -> dict[str, Any]:
    row = build(evt, fields, metrics, dims, now)
    try:
        print(json.dumps(row, separators=(",", ":"), default=str), file=sys.stdout, flush=True)
    except (OSError, ValueError):  # a closed stdout must never break a session
        pass
    return row


def exercise_dim(mode: str | None, exercise: str | None) -> str:
    """The Exercise dimension: the registry id for arm sessions, else the pipeline mode."""
    return str(exercise or mode or "unknown")


class SessionOps:
    """Per-socket counters for the events an operator cares about, and the session_end line."""

    def __init__(self, session_id: str, mode: str, exercise: str | None, source: str, now: float | None = None) -> None:
        self.session_id = session_id
        self.mode = mode
        self.exercise = exercise
        self.source = source  # live | replay
        self.t_open = time.time() if now is None else now
        self.stop_actions: Counter[str] = Counter()  # "pause:failed_reps" -> n
        self.flags: Counter[str] = Counter()
        self.perception_lost = 0
        self.bad_frames = 0
        self.ended = False

    @property
    def dims(self) -> dict[str, str]:
        return {"Exercise": exercise_dim(self.mode, self.exercise), "Mode": self.source}

    def _base(self) -> dict[str, Any]:
        return {"session": self.session_id, "mode": self.mode, "exercise": self.exercise, "source": self.source}

    def start(self, agent: str | None = None) -> dict[str, Any]:
        return emit("session_start", {**self._base(), "agent": agent}, now=self.t_open)

    def observe(self, events: Iterable[Any]) -> None:
        """Log stop-rule actions, therapist flags and perception loss as they leave the service."""
        for e in events:
            t = getattr(e, "type", None)
            p = getattr(e, "payload", {}) or {}
            if t in ("stop", "pause", "rest") and p.get("rule") and p.get("rule") != "patient":  # the patient's own Pause is not a stop rule
                rule = str(p.get("rule"))
                self.stop_actions[f"{t}:{rule}"] += 1
                emit("stop_rule", {**self._base(), "action": t, "rule": rule})
            elif t == "therapist_flag":
                rule = str(p.get("rule"))
                self.flags[rule] += 1
                emit("therapist_flag", {**self._base(), "rule": rule})
            elif t == "perception_lost":
                self.perception_lost += 1
                emit("perception_lost", {**self._base(), "missing": [str(m) for m in (p.get("missing") or [])][:8]})

    def end(self, summary: dict[str, Any] | None, latency: dict[str, Any] | None, now: float | None = None) -> dict[str, Any] | None:
        """The session_end line (once). `summary` is `CoachSession.summary()`; only counts and
        labels are read from it, never `told_us`, notes, flag details or the username."""
        if self.ended:
            return None
        self.ended = True
        t = time.time() if now is None else now
        s = summary or {}
        cam = s.get("camera") or {}
        lat = latency or {}
        wall_s = max(0.0, t - self.t_open)
        frames = int(lat.get("frames") or 0)
        fps = round(frames / wall_s, 2) if wall_s > 0 and frames else None
        stop_total = sum(self.stop_actions.values())
        fields = {
            **self._base(),
            "replay_clip": s.get("replay_clip"),
            "duration_s": round(wall_s, 1),
            "active_s": cam.get("active_s"),
            "reps_total": cam.get("reps_total"),
            "verified": cam.get("verified"),
            "unverified": cam.get("unverified"),
            "missed": cam.get("missed"),
            "tracking": s.get("tracking"),
            "stopped": bool(s.get("stopped")),
            "stop_rule_actions": dict(self.stop_actions),
            # a list, not a dict: rule names such as "pain" must not become keys (DENY_KEYS)
            "flag_rules": sorted(self.flags.elements()),
            "perception_lost": self.perception_lost,
            "frames": frames,
            "dropped": lat.get("dropped"),
            "bad_frames": self.bad_frames,
            "fps": fps,
            "proc_p50_ms": lat.get("proc_p50"),
            "proc_p95_ms": lat.get("proc_p95"),
            "capture_to_event_p95_ms": lat.get("capture_to_event_p95"),
            "event_to_cue_p50_ms": lat.get("event_to_cue_p50"),
            "event_to_cue_p95_ms": lat.get("event_to_cue_p95"),
            "cues": lat.get("cues"),
            "coach": (s.get("coach") or {}).get("label"),
            "agent_decisions": (s.get("coach") or {}).get("agent_decisions"),
        }
        metrics = {
            "Sessions": 1,
            "RepsVerified": cam.get("verified") or 0,
            "RepsUnverified": cam.get("unverified") or 0,
            "FrameProcP50Ms": lat.get("proc_p50"),
            "FrameProcP95Ms": lat.get("proc_p95"),
            "Fps": fps,
            "EventToCueP50Ms": lat.get("event_to_cue_p50"),
            "EventToCueP95Ms": lat.get("event_to_cue_p95"),
            "StopRuleActions": stop_total,
            "PerceptionLost": self.perception_lost,
        }
        return emit("session_end", fields, metrics, self.dims, now=t)


def ws_error(code: str, mode: str | None = None, **fields: Any) -> dict[str, Any]:
    """A refused or failed socket (bad mode/sheet/replay, hidden exercise, an exception)."""
    return emit("ws_error", {"code": code, "socket_mode": mode, **fields}, {"WsErrors": 1})


def heartbeat(active_sessions: int, started_at: float, now: float | None = None) -> dict[str, Any]:
    t = time.time() if now is None else now
    return emit("heartbeat", {"active_sessions": active_sessions, "uptime_s": round(t - started_at)}, {"Heartbeat": 1, "ActiveSessions": active_sessions}, now=t)


async def heartbeat_loop(active: Callable[[], int], interval_s: float = HEARTBEAT_S, started_at: float | None = None) -> None:
    """Every `interval_s`: one heartbeat line (with EMF) so a "no data" alarm notices a dead or
    wedged service, or a CloudWatch agent that stopped shipping. Runs until cancelled."""
    t0 = time.time() if started_at is None else started_at
    while True:
        try:
            heartbeat(active(), t0)
        except Exception:  # noqa: BLE001 - the heartbeat must never take the service down
            pass
        await asyncio.sleep(interval_s)
