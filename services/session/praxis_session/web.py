"""Serve the built web app (web/dist) from the session service so the browser talks to one
origin for the page, /api, /health, /events and the WebSocket. Used by the container image;
local development keeps Vite's dev server and proxy.

No OpenCV here; cv2.__version__ is 5.0.0 in the perception modules.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

NO_CACHE = {"cache-control": "no-cache"}  # always revalidate (ETag / Last-Modified still apply)
IMMUTABLE = "public, max-age=31536000, immutable"  # hashed asset names change with content

SERVICE_PREFIXES = ("api", "health", "events", "ws", "docs", "openapi.json")  # /session is also the live page; the WS route takes upgrades


class _HashedAssets(StaticFiles):
    """Vite's content-hashed bundles never change under the same name: cache them for a year."""

    def file_response(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        resp = super().file_response(*args, **kwargs)
        resp.headers["cache-control"] = IMMUTABLE
        return resp


def mount_web(app: FastAPI, dist: Path | str) -> bool:
    """Mount `dist` as the SPA. Returns False (and mounts nothing) when there is no build.

    Call after every API route is registered: the catch-all must come last. Service paths
    listed in SERVICE_PREFIXES never fall back to index.html, so a wrong API URL is a 404.

    Caching: `index.html` (and any other unhashed file) goes out with `Cache-Control: no-cache`
    so the browser revalidates on every navigation and a fresh deploy shows up on the first
    click, not only after a reload. Vite's `/assets/*` names carry a content hash, so they are
    immutable for a year.
    """
    dist = Path(dist).resolve()
    index = dist / "index.html"
    if not index.is_file():
        return False
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", _HashedAssets(directory=str(assets)), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path.split("/", 1)[0] in SERVICE_PREFIXES:
            raise HTTPException(status_code=404)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist in candidate.parents:
            return FileResponse(candidate, headers=NO_CACHE)
        return FileResponse(index, headers=NO_CACHE)

    return True
