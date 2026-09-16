# praxis-session

FastAPI + OpenCV 5 (`opencv-python-headless==5.0.0.93`) session service. Frames arrive as 640×480 JPEG over `WS /session?mode=…`, are decoded in memory, processed, and dropped. Only JSON events (see `praxis_session/events.schema.json`) leave the process.

```bash
uv sync
uv run pytest -q
uv run ruff check .
uv run uvicorn praxis_session.main:app --reload --port 8000
uv run python tools/make_sheets.py     # docs/sheets/*.pdf
```

Modes: `heartbeat` (echo frame info) · `calibrate&sheet=nhpt_board|cup_targets` (ArUco calibration + setup checks). Later phases add `nhpt`, `cup`, `arm`.
