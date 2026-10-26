"""Frame-stream latency bookkeeping for one session.

Wire format (browser -> service): each binary WebSocket message is an optional 8-byte
little-endian IEEE-754 float64 `t_capture` (milliseconds since the Unix epoch, taken in the
browser as `performance.timeOrigin + performance.now()` at the moment the frame was drawn)
followed by the 640x480 JPEG. A message that starts with the JPEG SOI marker (FF D8 FF) is a
bare frame with no capture time; `split_capture_prefix` accepts both.

Every latency number is wall-clock on the service. `capture_to_event_ms` compares the
browser's clock with the service's, which is one clock in the edge/laptop product story and
two clocks (skew included) when the service runs on a remote host.
"""

from __future__ import annotations

import math
import struct
from collections import deque
from typing import Any

_JPEG_SOI = b"\xff\xd8\xff"
PREFIX_BYTES = 8


def split_capture_prefix(data: bytes) -> tuple[float | None, bytes]:
    """Return (t_capture_ms or None, jpeg_bytes)."""
    if len(data) > PREFIX_BYTES and data[PREFIX_BYTES : PREFIX_BYTES + 3] == _JPEG_SOI:
        return struct.unpack("<d", data[:PREFIX_BYTES])[0], data[PREFIX_BYTES:]
    return None, data


def percentile(xs: list[float] | deque[float], p: float) -> float | None:
    """Nearest-rank percentile (p in 0..100); None on empty input."""
    if not xs:
        return None
    s = sorted(xs)
    k = max(1, min(len(s), math.ceil(p / 100.0 * len(s))))
    return float(s[k - 1])


class LatencyStats:
    """Per-session rolling record of capture->event, processing and event->cue times.

    Kept in `main.py` (not in `CoachSession`) so the summary can gain a `latency` block
    without touching `session.py`; capped so a long session cannot grow without bound."""

    def __init__(self, capacity: int = 20000) -> None:
        self.capture_to_event: deque[float] = deque(maxlen=capacity)
        self.proc: deque[float] = deque(maxlen=capacity)
        self.event_to_cue: deque[float] = deque(maxlen=capacity)
        self.frames = 0
        self.dropped = 0
        self.cues = 0

    def frame(self, capture_to_event_ms: float | None, proc_ms: float, dropped: int = 0) -> None:
        self.frames += 1
        self.dropped += int(dropped)
        self.proc.append(float(proc_ms))
        if capture_to_event_ms is not None:
            self.capture_to_event.append(float(capture_to_event_ms))

    def cue(self, event_to_cue_ms: float) -> None:
        self.cues += 1
        self.event_to_cue.append(float(event_to_cue_ms))

    def summary(self) -> dict[str, Any]:
        r = lambda v: None if v is None else round(v, 1)  # noqa: E731
        return {
            "capture_to_event_p50": r(percentile(self.capture_to_event, 50)),
            "capture_to_event_p95": r(percentile(self.capture_to_event, 95)),
            "proc_p50": r(percentile(self.proc, 50)),
            "proc_p95": r(percentile(self.proc, 95)),
            "event_to_cue_p50": r(percentile(self.event_to_cue, 50)),
            "event_to_cue_p95": r(percentile(self.event_to_cue, 95)),
            "frames": self.frames,
            "dropped": self.dropped,
            "cues": self.cues,
        }
