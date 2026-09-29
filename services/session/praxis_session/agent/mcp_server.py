"""FastMCP servers `perception`, `exertion` and `coach` over the agent tools (agent/tools.py).

MCP spec 2025-06-18, streamable HTTP, FastMCP 3.x. The servers wrap the *same* functions the
direct fallback uses; every call is routed through `tools.invoke(..., transport="mcp")`, so
budgets, guardrails and the `tool` trace row are identical. A guardrail refusal comes back to
the client as an MCP tool error (`isError: true`) and nothing happens.

Mounted in the session service's FastAPI app at `/mcp/perception`, `/mcp/exertion` and
`/mcp/coach` (one container, one port) when the agent is enabled (`PRAXIS_AGENT` != off) or
`PRAXIS_MCP=1`. Any MCP client (Claude Desktop, Claude Code, a judge) can connect; coach
actions still need an active agent checkpoint run on that session, so an outside client can
read perception but cannot speak to a patient.

Perception tools run OpenCV 5 (cv2.__version__ == 5.0.0 at authoring) on the latest frame in
memory; results are numbers and short text, never pixels.
"""
from __future__ import annotations

import functools
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
                app.router.routes.append(Route(path, endpoint=RequestContextMiddleware(route.app), methods=route.methods))
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
