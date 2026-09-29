"""The production transport offline: Strands MCPClient -> this service's FastMCP routes over
streamable HTTP (a local uvicorn), with a fake model asking for check_setup then speak."""
import asyncio
import socket
import threading
import time

import uvicorn
from fastapi import FastAPI

from praxis_session.agent import mcp_server
from praxis_session.agent import model as M
from praxis_session.agent import tools as T
from praxis_session.events import make_event
from praxis_session.perception.board_spec import CUP_TARGETS
from praxis_session.perception.synth import camera_frame
from praxis_session.pipeline import SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import CoachSession
from tests.test_agent_model import FakeModel


def test_strands_planner_uses_real_streamable_http_mcp(tmp_path):
    reg = T.Registry()
    app = FastAPI()
    subs = mcp_server.mount(app, mcp_server.build_servers(reg))
    app.router.lifespan_context = mcp_server.lifespan_for(subs)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", ws="none"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    try:
        p = SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)
        p.process(camera_frame(CUP_TARGETS, hide_marker=3)[0], 0.0, 0)
        s = CoachSession(mode="cup", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="http1")
        h = reg.register(T.SessionHandle(session=s, pipeline=p, label="Claude agent · Anthropic API (dev)"))
        e = make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=3)
        s.on_events([e], snapshot={}, t=1.0)
        fake = FakeModel([("check_setup", {"session_id": "http1"}), ("speak", {"session_id": "http1", "text": "Marker 3 is covered.", "cue": "correct", "evidence": [e.id]})])
        cfg = M.load_config({"PRAXIS_AGENT": "anthropic", "ANTHROPIC_API_KEY": "sk-test", "PRAXIS_MCP_URL": f"http://127.0.0.1:{port}/mcp"})
        planner = M.StrandsPlanner(cfg, model_factory=lambda c: fake.model)

        async def go():
            h.begin_run("arc_complete")
            try:
                return await planner.run(M.RunContext(handle=h, trigger="arc_complete", evidence=[e.id], prompt="Checkpoint", registry=reg))
            finally:
                h.end_run()

        res = asyncio.run(go())
        assert res.transport == "mcp" and res.mcp_error is None
        tools = [(r["name"], r["transport"], r["ok"]) for r in s.trace.tail(50) if r["kind"] == "tool" and "server" in r]
        assert tools == [("check_setup", "mcp", True), ("speak", "mcp", True)]
        assert [x.payload["text"] for x in h.drain(2.0) if x.type == "coach"] == ["Marker 3 is covered."]
    finally:
        server.should_exit = True
        th.join(timeout=5)
