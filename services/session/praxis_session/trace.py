"""Decision trace: JSON lines event -> stop rule -> decide -> tool -> action, per session.

The JSONL file is opened lazily on the first row that is not the `session` header, so a
socket that never produces an event (setup, an abandoned connection) leaves no file behind;
the header is written first when the file is created."""
from __future__ import annotations

import json
import os
import time
from collections import deque
from pathlib import Path
from typing import Any

DEFAULT_DIR = Path(os.environ["PRAXIS_TRACE_DIR"]) if "PRAXIS_TRACE_DIR" in os.environ else Path(__file__).resolve().parents[3] / "traces"


class Trace:
    def __init__(self, session_id: str, directory: Path | str | None = None, capacity: int = 5000) -> None:
        self.session_id = session_id
        self.dir = Path(directory) if directory else DEFAULT_DIR
        self.path = self.dir / f"{session_id}.jsonl"
        self._tail: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._seq = 0
        self._opened = False
        self._unwritten: list[dict[str, Any]] = []

    def log(self, kind: str, /, **fields: Any) -> dict[str, Any]:
        self._seq += 1
        row = {**fields, "seq": self._seq, "ts": time.time(), "session": self.session_id, "kind": kind}
        self._tail.append(row)
        if not self._opened and kind == "session":
            self._unwritten.append(row)  # header only: no file until something happens
            return row
        if not self._opened:
            self.dir.mkdir(parents=True, exist_ok=True)
            self._opened = True
        with open(self.path, "a") as f:
            for r in (*self._unwritten, row):
                f.write(json.dumps(r, default=str) + "\n")
        self._unwritten.clear()
        return row

    def tail(self, n: int = 50) -> list[dict[str, Any]]:
        return list(self._tail)[-n:]
