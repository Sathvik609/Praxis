"""Decision trace: JSON lines event -> stop rule -> decide -> tool -> action, per session."""
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
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / f"{session_id}.jsonl"
        self._tail: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._seq = 0

    def log(self, kind: str, /, **fields: Any) -> dict[str, Any]:
        self._seq += 1
        row = {**fields, "seq": self._seq, "ts": time.time(), "session": self.session_id, "kind": kind}
        self._tail.append(row)
        with open(self.path, "a") as f:
            f.write(json.dumps(row, default=str) + "\n")
        return row

    def tail(self, n: int = 50) -> list[dict[str, Any]]:
        return list(self._tail)[-n:]
