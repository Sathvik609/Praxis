"""Coach interface shared by the rule coach and the (W6) Strands/Bedrock agent.

Actions are restricted to instruct | correct | progress | regress | rest | stop. Every
Decision must cite the perception event ids it was made from (CLAUDE.md rule 5). Tools carry
the names the agent will bind: get_events, get_exertion_state, get_prescription,
read_patient_model, write_session_summary, speak.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from praxis_session.events import Event, EventRing, make_event
from praxis_session.prescription import Prescription

ACTIONS: tuple[str, ...] = ("instruct", "correct", "progress", "regress", "rest", "stop")
Action = Literal["instruct", "correct", "progress", "regress", "rest", "stop"]


@dataclass
class CoachContext:
    mode: str
    events: list[Event]
    snapshot: dict[str, Any]
    exertion: dict[str, Any]
    prescription: Prescription
    t: float
    last_speak_t: float = -1e9


@dataclass
class Decision:
    action: Action
    cue_id: str
    text: str
    reason: str
    evidence: list[int]
    ui: dict[str, Any] = field(default_factory=dict)
    label: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "cue_id": self.cue_id,
            "text": self.text,
            "reason": self.reason,
            "evidence": list(self.evidence),
            "ui": dict(self.ui),
            "label": self.label,
            "tool_calls": list(self.tool_calls),
        }


class Coach(Protocol):
    name: str

    def decide(self, ctx: CoachContext) -> list[Decision]: ...


# ---- tools (plain functions; the agent binds these names as MCP/Gateway tools in W6) ----
def get_events(ring: EventRing, n: int = 50) -> list[dict[str, Any]]:
    return [e.to_dict() for e in ring.latest(n)]


def get_exertion_state(exertion_state: dict[str, Any]) -> dict[str, Any]:
    return dict(exertion_state)


def get_prescription(p: Prescription) -> dict[str, Any]:
    return p.model_dump()


def read_patient_model(store: Any, patient_id: str) -> dict[str, Any]:
    if store is None:
        return {"patient_id": patient_id, "history": [], "source": "no store (Phase 8)"}
    return store.read_patient_model(patient_id)


def write_session_summary(store: Any, summary: dict[str, Any]) -> dict[str, Any]:
    if store is None:
        return {"ok": False, "reason": "no store (Phase 8)"}
    return store.write_session_summary(summary)


def speak(text: str, t: float, cue_id: str, action: str) -> Event:
    """A speak action becomes a captioned event; the browser voices it (Polly in W6)."""
    return make_event("speak", t=t, text=text, cue_id=cue_id, action=action)
