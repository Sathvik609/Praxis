# Praxis session service — multi-arch (linux/arm64 for Graviton c8g, linux/amd64 for laptops).
# Cloud/judge mode runs this same code under systemd on the COOL AMI (not ECS); see docs/TECHNICAL_REPORT.md.
FROM python:3.12-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PRAXIS_CLOUD_ENABLED=0

# opencv-python-headless still needs libglib for cv2 import on slim images
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /uvx /bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY praxis_session ./praxis_session
COPY tools ./tools
RUN uv sync --frozen --no-dev

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD ["/app/.venv/bin/python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health')"]
CMD ["/app/.venv/bin/uvicorn", "praxis_session.main:app", "--host", "0.0.0.0", "--port", "8000"]
