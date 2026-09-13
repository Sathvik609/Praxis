"""Timestamped JSON event stream shared by perception, the WebSocket, and the future MCP server.

Every message the service emits is an Event: {"type", "t", ...payload}. Raw frames are never
part of an event. cv2.__version__ at authoring time: 5.0.0.
"""
from __future__ import annotations

import json
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Iterator


@dataclass(frozen=True)
class Event:
    type: str
    t: float
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "t": self.t, **self.payload}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"))


def now() -> float:
    return time.time()


def make_event(type_: str, t: float | None = None, **payload: Any) -> Event:
    return Event(type=type_, t=now() if t is None else t, payload=payload)


class EventRing:
    """Thread-safe in-process ring buffer of Events.

    The perception pipeline appends; the WebSocket handler and the `perception` MCP server read.
    """

    def __init__(self, capacity: int = 4096) -> None:
        self._buf: deque[Event] = deque(maxlen=capacity)
        self._lock = threading.Lock()
        self._seq = 0

    def append(self, event: Event) -> int:
        with self._lock:
            self._buf.append(event)
            self._seq += 1
            return self._seq

    def __len__(self) -> int:
        with self._lock:
            return len(self._buf)

    def since(self, t: float) -> list[Event]:
        with self._lock:
            return [e for e in self._buf if e.t > t]

    def latest(self, n: int = 50) -> list[Event]:
        with self._lock:
            items = list(self._buf)
        return items[-n:]

    def of_type(self, type_: str) -> list[Event]:
        with self._lock:
            return [e for e in self._buf if e.type == type_]

    def __iter__(self) -> Iterator[Event]:
        with self._lock:
            return iter(list(self._buf))

    def clear(self) -> None:
        with self._lock:
            self._buf.clear()
