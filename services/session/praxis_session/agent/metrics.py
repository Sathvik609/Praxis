"""Agent observability (10 Oct): one structured JSON line per agent run and per agent error on
stdout, and an in-process aggregate behind `GET /api/agent/metrics`.

12 Oct: with `PRAXIS_EMF=1` (the systemd unit) each line also carries a CloudWatch Embedded
Metric Format block (`ops.emf_fields`, namespace `Praxis`, dimension Service=session only):
AgentRuns, AgentFallbacks (rule coach took over: error or daily cap), AgentErrors,
AgentCostUSD (estimate) and AgentFirstActionMs. The provider (`PRAXIS_AGENT`) and model are
plain fields, never dimensions, so they add no custom metrics.

Each line is a single JSON object (`{"evt": "agent_run", ...}` / `{"evt": "agent_error", ...}`),
so CloudWatch Logs (the systemd journal on the EC2 box, or any log driver) can index and filter
it without a parser (e.g. a metric filter on `{ $.evt = "agent_run" && $.outcome = "error" }`).
No patient text, frames or keys go in a line: ids, counts, timings, kinds and short error
messages only. The aggregate is in memory (a restart resets it, like the daily cap) and keeps
the last `MAX_ROWS` events.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections import Counter, deque
from datetime import datetime, timezone
from typing import Any, Callable

from praxis_session import ops
from praxis_session.agent import model as _model

MAX_ROWS = 5000


def cost_usd(input_tokens: int | None, output_tokens: int | None, model: str | None = None, cache_read: int | None = 0, cache_write: int | None = 0) -> float:
    """List-price estimate at the run's model's prices (agent/model.py `PRICES`; the default
    model's prices when unknown), cache reads and writes included."""
    return round(_model.cost_usd(model, input_tokens, output_tokens, cache_read, cache_write), 5)


def _pct(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[max(0, min(len(xs) - 1, round(q * (len(xs) - 1))))], 1)


def _provider() -> str:
    """The agent provider this process runs (PRAXIS_AGENT: off | anthropic | scripted)."""
    return os.environ.get("PRAXIS_AGENT", "off") or "off"


class AgentMetrics:
    def __init__(self, now: Callable[[], float] = time.time, emit: bool = True) -> None:
        self._now = now
        self._emit = emit
        self._rows: deque[dict[str, Any]] = deque(maxlen=MAX_ROWS)
        self._lock = threading.Lock()

    def _day(self, ts: float) -> str:
        return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()

    def _log(self, row: dict[str, Any], metrics: dict[str, float | int | None] | None = None) -> dict[str, Any]:
        ts = self._now()
        row = {"ts": round(ts, 3), **row}
        with self._lock:
            self._rows.append(row)
        if self._emit:
            line = row
            if metrics and ops.emf_enabled():
                line = {**row, **ops.emf_fields(metrics, {"Service": ops.SERVICE}, int(ts * 1000))}
            print(json.dumps(line, separators=(",", ":"), default=str), file=sys.stdout, flush=True)
        return row

    def run(self, *, session: str, trigger: str, outcome: str, ms: float | None = None, first_action_ms: float | None = None, tool_calls: int = 0, actions: int = 0, input_tokens: int | None = None, output_tokens: int | None = None, transport: str | None = None, model: str | None = None, policy_version: str | None = None, provider: str | None = None, cache_read_tokens: int | None = None, cache_write_tokens: int | None = None) -> dict[str, Any]:
        tokens = (input_tokens or 0) + (output_tokens or 0) + (cache_read_tokens or 0) + (cache_write_tokens or 0)
        cost = cost_usd(input_tokens, output_tokens, model, cache_read_tokens, cache_write_tokens)
        emf = {
            "AgentRuns": None if outcome == "daily_cap" else 1,
            "AgentFallbacks": 1 if outcome in ("error", "daily_cap") else None,
            "AgentCostUSD": cost if tokens else None,
            "AgentFirstActionMs": first_action_ms,
        }
        return self._log({
            "evt": "agent_run", "session": session, "trigger": trigger, "outcome": outcome, "ms": ms,
            "first_action_ms": first_action_ms, "tool_calls": tool_calls, "actions": actions, "tokens": tokens,
            "input_tokens": input_tokens, "output_tokens": output_tokens, "cache_read_tokens": cache_read_tokens,
            "cache_write_tokens": cache_write_tokens, "transport": transport, "model": model,
            "cost_usd_est": cost, "policy_version": policy_version, "provider": provider or _provider(),
        }, emf)

    def model_verified(self, model: str | None) -> bool:
        """At least one run of `model` got its answer (`done`, or `stale`: the model answered
        after the session moved on) since this process started: /health's evidence that the
        configured provider really ran, not just that it is configured."""
        with self._lock:
            return any(r["evt"] == "agent_run" and r.get("model") == model and r["outcome"] in ("done", "stale") for r in self._rows)

    def error(self, *, session: str, error_kind: str, message: str, trigger: str | None = None, fallback: str | None = None) -> dict[str, Any]:
        return self._log({"evt": "agent_error", "session": session, "trigger": trigger, "error_kind": error_kind, "message": str(message)[:200], "fallback": fallback, "provider": _provider()}, {"AgentErrors": 1})

    def summary(self, budget: Any | None = None) -> dict[str, Any]:
        today = self._day(self._now())
        with self._lock:
            rows = [r for r in self._rows if self._day(r["ts"]) == today]
        attempts = [r for r in rows if r["evt"] == "agent_run"]
        # A daily-cap refusal is not a run (no planner, no model call): counted apart, so
        # `runs_today` agrees with the budget's own count (11 Oct audit).
        runs = [r for r in attempts if r["outcome"] != "daily_cap"]
        errors = [r for r in rows if r["evt"] == "agent_error"]
        first = [float(r["first_action_ms"]) for r in runs if r.get("first_action_ms") is not None]
        calls = [int(r.get("tool_calls") or 0) for r in runs]
        out: dict[str, Any] = {
            "day_utc": today,
            "runs_today": len(runs),
            "blocked_by_cap": len(attempts) - len(runs),
            "by_outcome": dict(Counter(r["outcome"] for r in attempts)),
            "errors_by_kind": dict(Counter(r["error_kind"] for r in errors)),
            "first_action_ms_p50": _pct(first, 0.5),
            "first_action_ms_p95": _pct(first, 0.95),
            "mean_tool_calls": round(sum(calls) / len(calls), 2) if calls else None,
            "fallbacks": {
                "direct_tools": sum(1 for r in runs if r.get("transport") == "direct"),
                "rule_coach": sum(1 for r in attempts if r["outcome"] in ("error", "daily_cap")),
            },
            "tokens": sum(int(r.get("tokens") or 0) for r in runs),
            "cost_usd_est": round(sum(float(r.get("cost_usd_est") or 0) for r in runs), 4),
            "sessions": len({r["session"] for r in runs}),
        }
        if budget is not None:
            h = budget.health()
            limit = h.get("daily_runs_limit") or 0
            out["cap"] = h | {"reached": bool(limit) and h.get("runs_today", 0) >= limit}
        return out


METRICS = AgentMetrics()
