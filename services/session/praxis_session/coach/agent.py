"""AgentCoach: Claude at checkpoints, beside the rule coach (agent coach design §3, §6).

The rule coach keeps the instant in-rep cues. At a checkpoint (`checkin`, `set_complete`,
`arc_complete`, a stop-rule `pause:failed_reps` / `pause:perception`, `nhpt_complete`,
`feedback`) `CoachSession` calls `on_checkpoint`; the agent then runs **in a background asyncio
task**: one run per session at a time (later checkpoints coalesce into the next run), at most
`SESSION_RUNS` runs per session, `RUN_TIMEOUT_S` per run (`PAUSE_RUN_TIMEOUT_S` for a `pause:*`
checkpoint, as the service sets it, 12 Oct), never while the session is stopped.

A run is: `agent_status thinking` → trace `agent_run {phase: start}` → the planner (Strands +
Claude, or scripted) calls tools (agent/tools.py, over MCP or direct) → trace `agent_run
{phase: end, ms, tokens, outcome, transport}` → `agent_status idle`. Tool outputs are queued
intents the socket loop drains, so they reach the browser between frames and pass the stop
check once more. A run that ends after the session moved on is `stale` (its queued outputs are
dropped). A model error, timeout, refusal or malformed call ends the run with `agent_error
{error_kind, message}` and `agent_status offline`; the rule coach carries on, and the next
checkpoint tries again.

Before any planner is called, a run takes one slot from the process-wide `DailyRunBudget`
(`PRAXIS_AGENT_DAILY_RUNS`, agent/budget.py). Over the cap the model is not called: the first
blocked run in a session writes `agent_error {error_kind: "daily_cap"}` and `agent_status
offline` ("Daily agent limit reached · rule coach continues"), later ones an `agent_skip` row;
the rule coach carries on, and the next UTC day the agent runs again.

Every run end and every agent error is also one JSON line on stdout (`agent/metrics.py`,
CloudWatch-ready) and feeds the `/api/agent/metrics` aggregate. `agent_run` trace rows carry
the autonomy `policy_version` (agent/tools.py `AUTONOMY`).

Scheduling rules (11 Oct audit):
- `feedback` supersedes everything still pending (the session is over; those checkpoints are
  stale) and is the one checkpoint that still runs after a stop, so the report note can explain
  the stop (the tool layer then allows only reads and `write_session_summary`);
- a pending `pause:*` checkpoint is skipped when the pause has already cleared;
- `close()` (the socket closed) drops pending checkpoints, cancels the run in flight unless it
  is the `feedback` run (which only writes the report note), and unregisters the session's tool
  handle once nothing runs. A cancelled run still gets its `agent_run {phase: end, outcome:
  cancelled}` row and metrics line.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from praxis_session.agent import tools as T
from praxis_session.agent.budget import DAILY_CAP_REASON, DailyRunBudget
from praxis_session.agent.metrics import METRICS, AgentMetrics
from praxis_session.agent.model import RUN_TIMEOUT_S, RunContext, build_prompt, classify_error

# Which checkpoint wins when several coalesce into one run.
PRIORITY = ("pause", "feedback", "set_complete", "arc_complete", "nhpt_complete", "checkin")


def _rank(trigger: str) -> int:
    head = trigger.split(":")[0]
    return PRIORITY.index(head) if head in PRIORITY else len(PRIORITY)


class AgentCoach:
    name = "agent"

    def __init__(self, planner: Any, handle: T.SessionHandle, registry: T.Registry | None = None, label: str | None = None, timeout_s: float = RUN_TIMEOUT_S, max_runs: int = T.SESSION_RUNS, daily: DailyRunBudget | None = None, metrics: AgentMetrics | None = None, pause_timeout_s: float | None = None) -> None:
        self.planner = planner
        self.handle = handle
        self.registry = registry
        self.label = label or handle.label
        self.timeout_s = timeout_s
        self.pause_timeout_s = pause_timeout_s  # `pause:*` checkpoints; None = timeout_s
        self.max_runs = max_runs
        self.daily = daily  # None: no daily cap (evaluation, tests); main.py passes AGENT_CFG.budget
        self._cap_notified = False
        self.metrics = METRICS if metrics is None else metrics
        self.pending: list[tuple[str, list[int], float]] = []
        self.offline = False
        self.runs: list[dict[str, Any]] = []  # per-run outcome (evaluation reads it)
        self._task: asyncio.Task | None = None
        self.closed = False
        self._current: str | None = None  # trigger of the run in flight

    def _skip(self, trigger: str, reason: str) -> None:
        self.handle.session.trace.log("agent_skip", trigger=trigger, reason=reason)

    def _may_run(self, trigger: str) -> bool:
        """Stopped sessions run nothing but the feedback checkpoint (the report note)."""
        return not self.handle.session.stopped or trigger == "feedback"

    # ---- scheduling ------------------------------------------------------------------------
    def on_checkpoint(self, trigger: str, evidence: list[int], t: float) -> None:
        if self.closed or not self._may_run(trigger):
            return
        if trigger == "feedback" and self.pending:
            # the session is over: whatever was still waiting is stale
            for old, _, _ in self.pending:
                self._skip(old, "superseded by feedback: the session has ended")
            self.pending = []
        if self.handle.runs + (1 if self.pending else 0) >= self.max_runs:
            self._skip(trigger, f"session run budget ({self.max_runs}) used")
            return
        self.pending.append((trigger, list(evidence), t))
        self._kick()

    def _kick(self) -> None:
        if self._task is not None and not self._task.done():
            return  # coalesces into the next run
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # no loop (sync tests): `await run_pending()` runs them
        self._task = loop.create_task(self._drain())

    async def _drain(self) -> None:
        try:
            while self.pending:  # after close() only a feedback checkpoint can be left
                nxt = self._coalesce()
                if nxt is None:
                    continue
                trigger, evidence, t, also = nxt
                self._current = trigger
                try:
                    await self.run_once(trigger, evidence, t, also)
                finally:
                    self._current = None
        finally:
            if self.closed:
                self._unregister()

    def _coalesce(self) -> tuple[str, list[int], float, list[str]] | None:
        batch, self.pending = self.pending, []
        s = self.handle.session
        keep = []
        for item in batch:
            if not self._may_run(item[0]):
                self._skip(item[0], "session stopped")
            elif item[0].startswith("pause") and not s.paused:
                self._skip(item[0], "the pause cleared before the agent ran")
            else:
                keep.append(item)
        if not keep:
            return None
        batch = keep
        batch.sort(key=lambda x: _rank(x[0]))
        trigger, _, t = batch[0]
        evidence: list[int] = []
        for _, ev, _ in batch:
            evidence += [i for i in ev if i not in evidence]
        also = [b[0] for b in batch[1:]]
        return trigger, evidence, t, also

    async def run_pending(self) -> None:
        """Wait for the background run (if any) and run whatever is still pending."""
        if self._task is not None and not self._task.done():
            await self._task
        await self._drain()

    def cancel(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()

    def close(self, reason: str = "socket closed") -> None:
        """The session's socket closed: drop pending checkpoints, cancel the run in flight
        (except a feedback run: it only writes the report note) and unregister the tool handle
        once nothing runs. Safe to call twice."""
        if self.closed:
            return
        self.closed = True
        keep = [p for p in self.pending if p[0] == "feedback"]
        for trig, _, _ in self.pending:
            if trig != "feedback":
                self._skip(trig, reason)
        self.pending = keep
        running = self._task is not None and not self._task.done()
        if running and self._current != "feedback" and not keep:
            self._task.cancel()  # type: ignore[union-attr]
        elif not running and keep:
            self._kick()  # the feedback run goes through; `_drain` unregisters after it
        if not running and not keep:
            self._unregister()

    async def wait_closed(self) -> None:
        """Wait until the background task (if any) has finished after `close()`."""
        task = self._task
        if task is not None and not task.done():
            try:
                await task
            except asyncio.CancelledError:
                pass

    def _unregister(self) -> None:
        reg = self.registry if self.registry is not None else T.REGISTRY
        if reg.get(self.handle.session_id) is self.handle:
            reg.remove(self.handle.session_id)

    # ---- one run -------------------------------------------------------------------------
    def _timeout_for(self, trigger: str) -> float:
        if self.pause_timeout_s is not None and trigger.startswith("pause:"):
            return self.pause_timeout_s
        return self.timeout_s

    async def run_once(self, trigger: str, evidence: list[int], t: float, also: list[str] | None = None) -> dict[str, Any]:
        h, s = self.handle, self.handle.session
        also = list(also or [])
        if not self._may_run(trigger):
            return {"outcome": "skipped"}
        if self.daily is not None and not self.daily.acquire():
            return self._daily_cap(trigger)
        preferred = getattr(self.planner, "transport", "mcp")
        run = h.begin_run(trigger, transport=preferred)
        h.status("thinking", trigger)
        model = getattr(self.planner, "model", "")
        s.trace.log("agent_run", phase="start", trigger=trigger, model=model, transport=preferred, also=also, label=self.label, run=run.id, policy_version=T.POLICY_VERSION)
        t0 = time.perf_counter()
        res, err = None, None
        cancelled = False
        try:
            ctx = RunContext(handle=h, trigger=trigger, evidence=evidence, prompt=build_prompt(h, trigger, evidence, also), also=also, registry=self.registry)
            res = await asyncio.wait_for(self.planner.run(ctx), timeout=self._timeout_for(trigger))
        except asyncio.CancelledError:  # the socket closed: still write the end row, then stop
            cancelled = True
        except Exception as e:  # model / transport failure: the rule coach carries on
            err = e
        finally:
            h.end_run()
        ms = round((time.perf_counter() - t0) * 1000.0, 1)
        if cancelled:
            row = {"phase": "end", "trigger": trigger, "model": model, "transport": preferred, "ms": ms, "input_tokens": None, "output_tokens": None, "outcome": "cancelled", "tool_calls": run.calls, "actions": run.actions, "first_action_ms": run.first_action_ms, "label": self.label, "run": run.id, "policy_version": T.POLICY_VERSION}
            s.trace.log("agent_run", **row)
            self.metrics.run(session=s.session_id, trigger=trigger, outcome="cancelled", ms=ms, first_action_ms=run.first_action_ms, tool_calls=run.calls, actions=run.actions, transport=preferred, model=model, policy_version=T.POLICY_VERSION)
            self.runs.append(row)
            raise asyncio.CancelledError()
        transport = res.transport if res is not None else preferred
        if res is not None and res.mcp_error:
            s.trace.log("agent_error", error_kind="mcp", message=res.mcp_error, fallback="direct", run=run.id)
            self.metrics.error(session=s.session_id, error_kind="mcp", message=res.mcp_error, trigger=trigger, fallback="direct")
        if err is not None:
            kind = "timeout" if isinstance(err, asyncio.TimeoutError) else classify_error(err)
            message = str(err)[:200] or type(err).__name__
            s.trace.log("agent_error", error_kind=kind, message=message, run=run.id)
            self.metrics.error(session=s.session_id, error_kind=kind, message=message, trigger=trigger, fallback="rule_coach")
            h.status("offline", trigger, reason=f"Coach offline · rule coach ({kind})")
            self.offline = True
            outcome = "error"
        else:
            outcome = "stale" if (s.stopped or run.epoch != s.epoch) else "done"
            h.status("idle", trigger)
            self.offline = False
            self._cap_notified = False
        row = {
            "phase": "end", "trigger": trigger, "model": model, "transport": transport, "ms": ms,
            "input_tokens": res.input_tokens if res else None, "output_tokens": res.output_tokens if res else None,
            "cache_read_tokens": getattr(res, "cache_read_tokens", None) if res else None,
            "cache_write_tokens": getattr(res, "cache_write_tokens", None) if res else None,
            "outcome": outcome, "tool_calls": run.calls, "actions": run.actions, "first_action_ms": run.first_action_ms,
            "label": self.label, "run": run.id, "policy_version": T.POLICY_VERSION,
        }
        s.trace.log("agent_run", **row)
        self.metrics.run(session=s.session_id, trigger=trigger, outcome=outcome, ms=ms, first_action_ms=run.first_action_ms, tool_calls=run.calls, actions=run.actions, input_tokens=row["input_tokens"], output_tokens=row["output_tokens"], cache_read_tokens=row["cache_read_tokens"], cache_write_tokens=row["cache_write_tokens"], transport=transport, model=model, policy_version=T.POLICY_VERSION)
        if err is not None:
            row["error_kind"] = kind
        self.runs.append(row)
        return row

    def _daily_cap(self, trigger: str) -> dict[str, Any]:
        """Over the daily cap: no model call; say so once per session, then the rule coach carries on."""
        h, s = self.handle, self.handle.session
        message = f"daily agent limit reached ({self.daily.limit} runs per UTC day); model not called"
        self.metrics.run(session=s.session_id, trigger=trigger, outcome="daily_cap", policy_version=T.POLICY_VERSION)
        if not self._cap_notified:
            s.trace.log("agent_error", error_kind="daily_cap", message=message, trigger=trigger)
            self.metrics.error(session=s.session_id, error_kind="daily_cap", message=message, trigger=trigger, fallback="rule_coach")
            h.status("offline", trigger, reason=DAILY_CAP_REASON)
            self._cap_notified = True
        else:
            s.trace.log("agent_skip", trigger=trigger, reason=message)
        self.offline = True
        return {"phase": "end", "trigger": trigger, "outcome": "daily_cap"}
