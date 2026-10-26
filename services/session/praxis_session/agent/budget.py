"""Daily cap on agent runs across all sessions (spend safety; agent coach guardrails).

The public site has no login, so with `PRAXIS_AGENT` on anyone could start sessions that call
the model. `PRAXIS_AGENT_DAILY_RUNS` (default 100, `0` = unlimited) caps checkpoint runs per UTC
day for the whole process. `AgentCoach.run_once` takes one run from the budget before any planner
(Strands + Claude or scripted) is called; over the cap the model is not called, the session goes
`agent_status offline` with `DAILY_CAP_REASON`, the trace gets `agent_error {error_kind:
"daily_cap"}`, and the rule coach carries on. The counter is in memory: a restart resets it, so
the team also sets a spend limit in the Anthropic console (report §10).
"""
from __future__ import annotations

import time
from datetime import date, datetime, timezone
from typing import Callable

DEFAULT_DAILY_RUNS = 100
DAILY_CAP_REASON = "Daily agent limit reached · rule coach continues"


def parse_limit(raw: str | None) -> int:
    """`PRAXIS_AGENT_DAILY_RUNS` → limit; missing, non-integer or negative → the default."""
    try:
        n = int((raw or "").strip())
    except ValueError:
        return DEFAULT_DAILY_RUNS
    return n if n >= 0 else DEFAULT_DAILY_RUNS


class DailyRunBudget:
    """In-process count of agent runs per UTC day. `limit == 0` means unlimited."""

    def __init__(self, limit: int = DEFAULT_DAILY_RUNS, now: Callable[[], float] = time.time) -> None:
        self.limit = limit
        self._now = now
        self._day: date | None = None
        self._count = 0

    def _roll(self) -> None:
        today = datetime.fromtimestamp(self._now(), tz=timezone.utc).date()
        if today != self._day:
            self._day, self._count = today, 0

    @property
    def runs_today(self) -> int:
        self._roll()
        return self._count

    def acquire(self) -> bool:
        """Take one run; False (nothing taken) when today's limit is reached."""
        self._roll()
        if self.limit and self._count >= self.limit:
            return False
        self._count += 1
        return True

    def health(self) -> dict[str, int]:
        return {"runs_today": self.runs_today, "daily_runs_limit": self.limit}
