"""Metric geometry of the two printed sheets (single source for PDFs and detection).

Coordinates are millimetres, origin at the sheet's top-left, x right, y down.
Detection with cv2.__version__ == 5.0.0 (cv2.aruco DICT_4X4_50, ids 0-3).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np


@dataclass(frozen=True)
class SheetSpec:
    name: str
    width_mm: float
    height_mm: float
    marker_size_mm: float
    marker_centres_mm: dict[int, tuple[float, float]]
    targets_mm: tuple[tuple[float, float], ...]
    target_radius_mm: float
    target_kind: Literal["hole", "dot"]

    def marker_corners_mm(self, marker_id: int) -> np.ndarray:
        """Corners in cv2.aruco order: top-left, top-right, bottom-right, bottom-left."""
        cx, cy = self.marker_centres_mm[marker_id]
        s = self.marker_size_mm / 2
        return np.array(
            [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]],
            dtype=np.float32,
        )

    @property
    def centre_mm(self) -> tuple[float, float]:
        return (self.width_mm / 2, self.height_mm / 2)


def _grid(cx: float, cy: float, pitch: float, n: int = 3) -> tuple[tuple[float, float], ...]:
    off = [(i - (n - 1) / 2) * pitch for i in range(n)]
    return tuple((cx + dx, cy + dy) for dy in off for dx in off)


def _arc(
    cx: float, cy: float, radius: float, half_angle_deg: float, n: int = 5
) -> tuple[tuple[float, float], ...]:
    """n points on a circle centred (cx, cy) spanning ±half_angle around the top (-y)."""
    angles = np.linspace(-half_angle_deg, half_angle_deg, n)
    return tuple(
        (cx + radius * math.sin(math.radians(a)), cy - radius * math.cos(math.radians(a)))
        for a in angles
    )


NHPT_BOARD = SheetSpec(
    name="nhpt_board",
    width_mm=210.0,
    height_mm=297.0,
    marker_size_mm=40.0,
    marker_centres_mm={0: (40.0, 40.0), 1: (170.0, 40.0), 2: (170.0, 257.0), 3: (40.0, 257.0)},
    targets_mm=_grid(105.0, 148.5, 32.0),
    target_radius_mm=5.0,
    target_kind="hole",
)

# A4 landscape. Arc centre sits on the patient side (below the sheet, +y); dots span ±26°
# on a 250 mm radius -> ~219 mm chord, apex (middle dot) 25 mm above the outer dots.
_ARC_RADIUS = 250.0
_ARC_APEX_Y = 105.0 - 12.5  # middle dot slightly above the sheet centre
CUP_TARGETS = SheetSpec(
    name="cup_targets",
    width_mm=297.0,
    height_mm=210.0,
    marker_size_mm=40.0,
    marker_centres_mm={0: (40.0, 40.0), 1: (257.0, 40.0), 2: (257.0, 170.0), 3: (40.0, 170.0)},
    targets_mm=_arc(148.5, _ARC_APEX_Y + _ARC_RADIUS, _ARC_RADIUS, 26.0),
    target_radius_mm=10.0,
    target_kind="dot",
)

SHEETS: dict[str, SheetSpec] = {s.name: s for s in (NHPT_BOARD, CUP_TARGETS)}
