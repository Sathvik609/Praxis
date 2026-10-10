"""Behavioural exertion / fatigue index (P0). Always labeled method="behavioural".

Signals: rep-time slope (later reps slower), falling peak angles (arm), tremor share of the
fingertip trace (hand), and the last self-reported RPE. Hesitation (long dwell before a lift)
is not computed yet.
No physiology is measured; rPPG is P1 and not present.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from praxis_session.events import Event
from praxis_session.prescription import Prescription

RPE_HALF_LIFE_S = 120.0


class Exertion:
    def __init__(self, prescription: Prescription) -> None:
        self.prescription = prescription
        self._durations: list[float] = []
        self._peaks: list[float] = []
        self._tremor: list[float] = []
        self._rpe: int | None = None
        # The last RPE fades: its contribution halves for every RPE_HALF_LIFE_S of low
        # behavioural score since it was reported (a fresh RPE resets the clock).
        self._rpe_low_s = 0.0
        self._last_t: float | None = None
        self._level = "low"
        self._high_since: float | None = None
        self.state: dict[str, Any] = {"level": "low", "score": 0.0, "reasons": [], "method": "behavioural"}

    def update(self, events: list[Event], rpe: int | None = None, t: float | None = None) -> dict[str, Any]:
        for e in events:
            if e.type == "rep_complete":
                d = e.payload.get("duration_s")
                if d is None and "t_start" in e.payload and "t_end" in e.payload:
                    d = e.payload["t_end"] - e.payload["t_start"]
                if d is not None:
                    self._durations.append(float(d))
                if "peak_deg" in e.payload:
                    self._peaks.append(float(e.payload["peak_deg"]))
            elif e.type == "reach_complete":
                self._durations.append(float(e.payload["reach_ms"]) / 1000.0)
            elif e.type == "frame":
                hand = e.payload.get("hand") or {}
                if hand.get("present") and hand.get("tremor_ratio") is not None:
                    self._tremor.append(float(hand["tremor_ratio"]))
        if rpe is not None:
            self._rpe = int(rpe)
            self._rpe_low_s = 0.0
        score, reasons = 0.0, []
        if len(self._durations) >= 6:
            d = np.array(self._durations[-12:])
            slope = np.polyfit(np.arange(d.size), d, 1)[0] / max(np.mean(d), 1e-6)
            if slope > 0.06:
                score += min(1.0, slope * 6)
                reasons.append(f"reps getting slower ({slope * 100:.0f}% per rep)")
        if len(self._peaks) >= 4:
            p = np.array(self._peaks[-8:])
            drop = p[0] - p[-1]
            if drop > 8:
                score += min(1.0, drop / 20)
                reasons.append(f"peak angle falling ({drop:.0f}° over the set)")
        if len(self._tremor) >= 3:
            tr = float(np.mean(self._tremor[-10:]))
            if tr > 0.45:
                score += min(1.0, tr)
                reasons.append(f"tremor share {tr:.0%} of hand motion")
        behavioural_low = score < 0.5
        if t is not None and self._last_t is not None and behavioural_low and rpe is None:
            self._rpe_low_s += max(0.0, t - self._last_t)
        if t is not None:
            self._last_t = t
        if self._rpe is not None:
            base = 1.5 if self._rpe >= 7 else 0.6 if self._rpe >= 5 else 0.0
            if base:
                decay = 0.5 ** (self._rpe_low_s / RPE_HALF_LIFE_S)
                score += base * decay
                fading = f", fading after {self._rpe_low_s:.0f} s of steady work" if decay < 0.9 else ""
                reasons.append(f"RPE {self._rpe}/10{fading}")
        level = "high" if score >= 1.2 else "moderate" if score >= 0.5 else "low"
        if t is not None:
            if level == "high":
                self._high_since = self._high_since if self._high_since is not None else t
            else:
                self._high_since = None
        self._level = level
        self.state = {"level": level, "score": round(score, 2), "reasons": reasons, "method": "behavioural"}
        return self.state

    def high_for_s(self, t: float) -> float:
        return 0.0 if self._high_since is None or self._level != "high" else max(0.0, t - self._high_since)
