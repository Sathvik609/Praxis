"""Timestamped JSON events: the only thing that leaves the perception process."""

from __future__ import annotations

import itertools
import json
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

_ids = itertools.count(1)


@dataclass(frozen=True)
class Event:
    type: str
    t: float
    id: int
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "t": self.t, "id": self.id, **self.payload}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"))


def make_event(type: str, t: float | None = None, **payload: Any) -> Event:
    return Event(type=type, t=time.time() if t is None else t, id=next(_ids), payload=payload)


class EventRing:
    """Fixed-capacity in-process buffer shared by the WebSocket, /events and (later) the coach."""

    def __init__(self, capacity: int = 2000) -> None:
        self._buf: deque[Event] = deque(maxlen=capacity)

    def append(self, e: Event) -> None:
        self._buf.append(e)

    def latest(self, n: int) -> list[Event]:
        return list(self._buf)[-n:] if n > 0 else []

    def __len__(self) -> int:
        return len(self._buf)
