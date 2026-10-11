"""FastMCP servers `perception`, `exertion` and `coach` over the agent tools (agent/tools.py).

MCP spec 2025-06-18, streamable HTTP, FastMCP 3.x. The servers wrap the *same* functions the
direct fallback uses; every call is routed through `tools.invoke(..., transport="mcp")`, so
budgets, guardrails and the `tool` trace row are identical. A guardrail refusal comes back to
the client as an MCP tool error (`isError: true`) and nothing happens.

Mounted in the session service's FastAPI app at `/mcp/perception`, `/mcp/exertion` and
`/mcp/coach` (one container, one port) when the agent is enabled (`PRAXIS_AGENT` != off) or
`PRAXIS_MCP=1`. Coach actions still need an active agent checkpoint run on that session, so an
outside client can read perception but cannot speak to a patient.

Access (10 Oct): the routes answer only (a) a loopback client (127.0.0.1 / ::1) whose request
carries no proxy header (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `Via`,
`X-Forwarded-Host/Proto/Port`, `CloudFront-*`, `X-Amz-Cf-*`: a reverse proxy on the same host,
or uvicorn's `--proxy-headers`, would make an internet client look local), or (b) any client that sends
`X-Praxis-MCP-Token: <token>`, where the token is `PRAXIS_MCP_TOKEN` or, if unset, a random
per-process secret generated at import. The in-process Strands MCP client and the scripted
HTTP transport send it (`agent.model.mcp_headers`). Everything else gets 403 and never reaches
FastMCP. A wrong token is refused even from loopback.

Perception tools run OpenCV 5 (cv2.__version__ == 5.0.0 at authoring) on the latest frame in
memory; results are numbers and short text, never pixels.
"""
from __future__ import annotations

import functools
import hmac
import json
import os
import secrets
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any, AsyncIterator

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.http import RequestContextMiddleware
from starlette.routing import Route

from praxis_session.agent import tools as T

INSTRUCTIONS = {
    "perception": "Praxis perception: OpenCV 5 on the patient's live camera session, run on demand. Events, the last set/arc summary, setup checks on the latest frame (ArUco markers, homography error, tilt, lighting, pose visibility) and recalibration. Numbers and short text only; no images ever leave the service.",
    "exertion": "Praxis exertion and program: behavioural exertion state, the therapist's prescription with its allowed adaptations and stop rules, and a short patient history.",
    "coach": "Praxis coach actions (instruct, correct, progress, regress, rest, stop). Each needs evidence event ids from this session. Adjustments and resumes are only proposals the patient must accept. Only available inside an agent checkpoint run.",
}


TOKEN_HEADER = "X-Praxis-MCP-Token"
LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost"})
# Any of these means the request came through a proxy (CloudFront adds X-Forwarded-For and Via;
# the EC2 unit runs uvicorn with --proxy-headers --forwarded-allow-ips=*, which rewrites the
# client address from X-Forwarded-For, so loopback is only trusted with none of them present).
PROXY_HEADERS = (b"x-forwarded-for", b"forwarded", b"x-real-ip", b"via", b"x-forwarded-host", b"x-forwarded-proto", b"x-forwarded-port")
PROXY_PREFIXES = (b"cloudfront-", b"x-amz-cf-")


def resolve_token() -> str:
    """`PRAXIS_MCP_TOKEN` when set (a deployment that wants an outside MCP client), else a
    fresh random secret. Never logged, never returned by any route."""
    return (os.environ.get("PRAXIS_MCP_TOKEN") or "").strip() or secrets.token_urlsafe(32)


_TOKEN = resolve_token()


def mcp_token() -> str:
    """This process's MCP token (what the in-process clients send)."""
    return _TOKEN


def access_allowed(scope: dict[str, Any], token: str | None = None) -> bool:
    """Loopback without proxy headers, or the right token header; nothing else."""
    token = token or _TOKEN
    headers = {k.lower(): v for k, v in (scope.get("headers") or [])}
    sent = headers.get(TOKEN_HEADER.lower().encode())
    if sent is not None:
        return hmac.compare_digest(sent, token.encode())
    client = scope.get("client")
    host = client[0] if client else None
    proxied = any(h in headers for h in PROXY_HEADERS) or any(k.startswith(PROXY_PREFIXES) for k in headers)
    return host in LOOPBACK and not proxied


class MCPAccessGuard:
    """ASGI wrapper in front of each MCP route: 403 unless `access_allowed`."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") == "http" and not access_allowed(scope):
            body = json.dumps({"error": "forbidden", "detail": "MCP routes are internal: loopback or X-Praxis-MCP-Token only"}).encode()
            await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)


def _mcp_tool(name: str, registry: T.Registry | None) -> Any:
    impl = T.TOOLS[name]

    @functools.wraps(impl)
    def tool(**kwargs: Any) -> dict[str, Any]:
        try:
            return T.invoke(name, kwargs, "mcp", registry)
        except T.ToolRejected as e:
            raise ToolError(str(e)) from None

    return tool


def build_servers(registry: T.Registry | None = None) -> dict[str, FastMCP]:
    servers: dict[str, FastMCP] = {}
    for server, names in T.SERVERS.items():
        mcp = FastMCP(server, instructions=INSTRUCTIONS[server], mask_error_details=True)
        for name in names:
            mcp.tool(_mcp_tool(name, registry), name=name)
        servers[server] = mcp
    return servers


SERVERS: dict[str, FastMCP] = build_servers()


def mount(app: Any, servers: dict[str, FastMCP] | None = None, prefix: str = "/mcp") -> list[Any]:
    """Add `/mcp/<server>` streamable-HTTP routes to a FastAPI/Starlette app (before the web
    catch-all) and return the MCP sub-apps whose lifespans must run (`lifespan_for`)."""
    subs = []
    for name, mcp in (servers or SERVERS).items():
        path = f"{prefix}/{name}"
        sub = mcp.http_app(path=path)
        for route in sub.routes:
            if isinstance(route, Route) and route.path == path:
                app.router.routes.append(Route(path, endpoint=MCPAccessGuard(RequestContextMiddleware(route.app)), methods=route.methods))
        subs.append(sub)
    return subs


def lifespan_for(subs: list[Any]) -> Any:
    """One lifespan that starts every MCP session manager (FastMCP needs its lifespan run)."""

    @asynccontextmanager
    async def lifespan(_app: Any) -> AsyncIterator[None]:
        async with AsyncExitStack() as stack:
            for sub in subs:
                await stack.enter_async_context(sub.router.lifespan_context(sub))
            yield

    return lifespan
