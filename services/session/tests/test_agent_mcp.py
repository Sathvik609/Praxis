"""FastMCP servers over the agent tools: same functions, transport `mcp`, guardrail refusals
come back as MCP tool errors."""
import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastmcp import Client

from praxis_session.agent import mcp_server as M
from praxis_session.agent import tools as T
from praxis_session.events import make_event
from praxis_session.perception.board_spec import CUP_TARGETS
from praxis_session.perception.synth import camera_frame
from praxis_session.pipeline import SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import CoachSession


@pytest.fixture
def setup(tmp_path):
    reg = T.Registry()
    servers = M.build_servers(reg)
    p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
    frame, _ = camera_frame(CUP_TARGETS, hide_marker=1)
    p.process(frame, 0.0, 0)
    s = CoachSession(mode="cup", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="m1")
    h = reg.register(T.SessionHandle(session=s, pipeline=p, label="Claude agent · scripted (test)"))
    return reg, servers, h


def run(coro):
    return asyncio.run(coro)


def test_three_servers_list_their_tools(setup):
    _, servers, _ = setup

    async def go():
        out = {}
        for name, srv in servers.items():
            async with Client(srv) as c:
                out[name] = sorted(t.name for t in await c.list_tools())
        return out

    got = run(go())
    assert got == {k: sorted(v) for k, v in T.SERVERS.items()}


def test_check_setup_over_mcp_is_traced_as_mcp(setup):
    _, servers, h = setup

    async def go():
        async with Client(servers["perception"]) as c:
            return await c.call_tool("check_setup", {"session_id": "m1"})

    r = run(go())
    assert r.is_error is False and "markers" in r.data["failing"]
    row = [x for x in h.session.trace.tail(5) if x["kind"] == "tool"][-1]
    assert row["transport"] == "mcp" and row["server"] == "perception" and row["name"] == "check_setup"


def test_guardrail_refusal_is_an_mcp_tool_error_and_nothing_happens(setup):
    _, servers, h = setup
    e = make_event("reach_complete", t=1.0, to_dot=1, from_dot=0, verified=False, reason="marker_lost", reach_ms=900, arc=1, phase="slow")
    h.session.on_events([e], snapshot={}, t=1.0)

    async def go(args):
        async with Client(servers["coach"]) as c:
            return await c.call_tool("speak", args, raise_on_error=False)

    # outside a checkpoint run: refused
    r = run(go({"session_id": "m1", "text": "Hello", "cue": "instruct", "evidence": [e.id]}))
    assert r.is_error is True and "checkpoint" in r.content[0].text
    h.begin_run("arc_complete")
    r = run(go({"session_id": "m1", "text": "Hello", "cue": "instruct", "evidence": [999999]}))
    assert r.is_error is True and "evidence" in r.content[0].text
    assert h.drain(2.0) == []
    r = run(go({"session_id": "m1", "text": "Keep marker 1 clear of your hand.", "cue": "correct", "evidence": [e.id]}))
    assert r.is_error is False and r.data["action"] == "correct"
    assert [x.type for x in h.drain(2.0)] == ["coach"]


def test_mounted_routes_answer_mcp_initialize(setup):
    _, servers, _ = setup
    app = FastAPI()
    subs = M.mount(app, servers)
    app.router.lifespan_context = M.lifespan_for(subs)
    body = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}}
    with TestClient(app) as c:
        for name in ("perception", "exertion", "coach"):
            r = c.post(f"/mcp/{name}", json=body, headers={"Accept": "application/json, text/event-stream"})
            assert r.status_code == 200, (name, r.text)
            assert name in r.text and "serverInfo" in r.text
