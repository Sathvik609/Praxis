# Praxis single-origin image: build context is the REPO ROOT (see railway.json / README).
#   docker build -f services/session/Dockerfile -t praxis .
# Stage 1 builds the React app; stage 2 is the Python 3.12 session service (FastAPI + OpenCV 5)
# that serves the built app, /api, /health, /events and the WebSocket from one port.

FROM node:24-slim AS web
RUN npm install -g pnpm@11.0.9
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /usr/local/bin/uv
WORKDIR /app
COPY services/session/pyproject.toml services/session/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
# OpenCV Zoo ONNX models (Apache-2.0, docs/LICENSES.md), SHA256-pinned, fetched at build time.
COPY services/session/tools ./tools
RUN .venv/bin/python tools/fetch_models.py --dir /app/models
COPY services/session/praxis_session ./praxis_session
COPY evaluation/dataset_v0 ./evaluation/dataset_v0
COPY --from=web /web/dist ./web_dist
RUN mkdir -p /app/data
ENV PRAXIS_CLOUD_ENABLED=0 \
    PRAXIS_EVAL_DIR=/app/evaluation/dataset_v0 \
    PRAXIS_WEB_DIST=/app/web_dist \
    PRAXIS_DB=/app/data/praxis.db \
    PRAXIS_TRACE_DIR=/app/data/traces \
    PORT=8000
EXPOSE 8000
CMD .venv/bin/uvicorn praxis_session.main:app --host 0.0.0.0 --port ${PORT}
