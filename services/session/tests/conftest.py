"""Shared fixtures for praxis_session tests. Perception tests use synthetic frames only."""
from __future__ import annotations

import cv2
import numpy as np
import pytest


def encode_jpeg(frame: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    assert ok
    return buf.tobytes()


@pytest.fixture
def blank_frame() -> np.ndarray:
    return np.full((480, 640, 3), 128, dtype=np.uint8)


@pytest.fixture
def blank_jpeg(blank_frame: np.ndarray) -> bytes:
    return encode_jpeg(blank_frame)
