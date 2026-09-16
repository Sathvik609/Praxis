"""Contract every emitted event must satisfy; the web client's types are derived from it."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

_PATH = Path(__file__).with_name("events.schema.json")


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    return Draft202012Validator(json.loads(_PATH.read_text()))


EVENT_TYPES: frozenset[str] = frozenset(
    json.loads(_PATH.read_text())["properties"]["type"]["enum"]
)


def validate_event(d: dict) -> None:
    _validator().validate(d)
