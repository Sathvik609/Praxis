# services/session

FastAPI + WebSocket frame ingest + OpenCV 5 perception + FastMCP servers + Strands agent loop, all in one Python 3.12 process.

```bash
uv sync
uv run pytest
uv run uvicorn praxis_session.main:app --reload --port 8000
# multi-arch image
docker buildx build --platform linux/arm64,linux/amd64 -t praxis-session .
```

`GET /health` → `{"status":"ok","opencv_version":"5.0.0","mode":"edge"}`
`WS /session` → send 640×480 JPEG bytes, receive one JSON event per frame.
