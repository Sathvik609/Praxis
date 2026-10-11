"""agent/model.py: configuration, model construction, error mapping and the Strands planner,
all offline (no request ever leaves the process in tests)."""
import asyncio
import json

import anthropic
import httpx
import pytest

from praxis_session.agent import model as M
from praxis_session.agent import tools as T
from praxis_session.events import make_event
from praxis_session.pipeline import SessionPipeline
from praxis_session.prescription import SEED_PRESCRIPTION
from praxis_session.session import CoachSession


def test_config_defaults_to_off():
    c = M.load_config({})
    assert c.mode == "off" and not c.enabled and not c.ready and c.label is None
    assert c.health(False) == {"mode": "off", "model": None, "mcp": False, "ready": False, "reason": "PRAXIS_AGENT=off", "runs_today": 0, "daily_runs_limit": 100}


def test_config_anthropic_needs_a_key_and_defaults_to_sonnet_5():
    c = M.load_config({"PRAXIS_AGENT": "anthropic"})
    assert c.mode == "anthropic" and c.model == "claude-sonnet-5" and c.ready is False
    assert c.reason == "ANTHROPIC_API_KEY is not set"
    c = M.load_config({"PRAXIS_AGENT": "anthropic", "ANTHROPIC_API_KEY": "sk-test", "PRAXIS_AGENT_MODEL": "claude-sonnet-5", "PORT": "9001"})
    assert c.ready and c.label == "Claude agent · Anthropic API (dev)" and c.mcp_url == "http://127.0.0.1:9001/mcp"
    assert "sk-test" not in json.dumps(c.health(True))  # the key is never reported


def test_config_bedrock_only_with_cloud_enabled():
    c = M.load_config({"PRAXIS_AGENT": "bedrock", "PRAXIS_BEDROCK_MODEL_ID": "m", "AWS_REGION": "us-west-2"})
    assert not c.ready and "PRAXIS_CLOUD_ENABLED" in c.reason
    c = M.load_config({"PRAXIS_AGENT": "bedrock", "PRAXIS_CLOUD_ENABLED": "1", "AWS_REGION": "us-west-2"})
    assert not c.ready and "PRAXIS_BEDROCK_MODEL_ID" in c.reason
    c = M.load_config({"PRAXIS_AGENT": "bedrock", "PRAXIS_CLOUD_ENABLED": "1", "PRAXIS_BEDROCK_MODEL_ID": "anthropic.claude-sonnet-5", "AWS_REGION": "us-west-2"})
    assert c.ready and c.label == "Claude agent · Amazon Bedrock" and c.region == "us-west-2"


def test_config_scripted_and_unknown():
    assert M.load_config({"PRAXIS_AGENT": "scripted"}).label == "Claude agent · scripted (test)"
    c = M.load_config({"PRAXIS_AGENT": "gpt"})
    assert c.mode == "off" and "unknown" in c.reason


def test_anthropic_model_is_low_effort_without_a_thinking_budget():
    cfg = M.load_config({"PRAXIS_AGENT": "anthropic", "ANTHROPIC_API_KEY": "sk-test"})
    m = M.build_model(cfg, {"ANTHROPIC_API_KEY": "sk-test"})
    conf = m.get_config()
    assert conf["model_id"] == "claude-sonnet-5" and conf["max_tokens"] == M.MAX_TOKENS
    assert conf["params"] == {"output_config": {"effort": "low"}}
    flat = json.dumps(conf, default=str)
    assert "budget_tokens" not in flat and "temperature" not in flat
    assert m.client.api_key == "sk-test" and m.client.max_retries == 0


def test_bedrock_model_construction():
    cfg = M.load_config({"PRAXIS_AGENT": "bedrock", "PRAXIS_CLOUD_ENABLED": "1", "PRAXIS_BEDROCK_MODEL_ID": "anthropic.claude-sonnet-5", "AWS_REGION": "us-west-2"})
    m = M.build_model(cfg, {})
    conf = m.get_config()
    assert conf["model_id"] == "anthropic.claude-sonnet-5" and conf["max_tokens"] == M.MAX_TOKENS
    with pytest.raises(ValueError):
        M.build_model(M.load_config({}), {})


def _resp(code):
    return httpx.Response(code, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))


def test_error_mapping():
    assert M.classify_error(anthropic.InternalServerError("overloaded", response=_resp(503), body=None)) == "unavailable"
    assert M.classify_error(anthropic.AuthenticationError("bad key", response=_resp(401), body=None)) == "auth"
    assert M.classify_error(anthropic.RateLimitError("slow down", response=_resp(429), body=None)) == "rate_limit"
    assert M.classify_error(anthropic.BadRequestError("budget_tokens", response=_resp(400), body=None)) == "bad_request"
    assert M.classify_error(asyncio.TimeoutError()) == "timeout"
    try:
        try:
            raise anthropic.APIConnectionError(request=httpx.Request("POST", "https://x"))
        except anthropic.APIConnectionError as e:
            raise RuntimeError("wrapped") from e
    except RuntimeError as outer:
        assert M.classify_error(outer) == "connection"
    assert M.classify_error(M.AgentRefusal("no")) == "refusal"
    assert M.classify_error(ValueError("x")) == "model_error"


def test_direct_tools_carry_the_model_facing_schema():
    tools = {t.tool_name: t for t in M.direct_tools()}
    assert set(tools) == set(T.TOOLS)
    spec = tools["speak"].tool_spec["inputSchema"]["json"]
    assert set(spec["required"]) == {"session_id", "text", "cue", "evidence"}
    assert spec["properties"]["evidence"]["type"] == "array"


def test_prompt_is_numbers_and_text(tmp_path):
    s = CoachSession(mode="cup", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="p1")
    h = T.SessionHandle(session=s, pipeline=SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False))
    p = M.build_prompt(h, "pause:failed_reps", [3, 4], [])
    assert "Setup recovery" in p and '"evidence_event_ids": [3, 4]' in p
    T.assert_no_pixels(p)


# ---- the real Strands agent loop with a fake model (no network) ------------------------------
class FakeModel:
    """A Strands model that asks for one tool call, then ends the turn."""

    def __init__(self, calls):
        from strands.models.model import Model

        class _M(Model):
            def __init__(self):
                self.calls = list(calls)
                self.config = {}

            def update_config(self, **kw):
                self.config.update(kw)

            def get_config(self):
                return self.config

            async def structured_output(self, *a, **k):  # pragma: no cover
                raise NotImplementedError
                yield

            async def stream(self, messages, tool_specs=None, system_prompt=None, **kw):
                yield {"messageStart": {"role": "assistant"}}
                if self.calls:
                    name, args = self.calls.pop(0)
                    yield {"contentBlockStart": {"start": {"toolUse": {"name": name, "toolUseId": f"t{len(self.calls)}"}}}}
                    yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(args)}}}}
                    yield {"contentBlockStop": {}}
                    yield {"messageStop": {"stopReason": "tool_use"}}
                else:
                    yield {"contentBlockDelta": {"delta": {"text": "Spoke once."}}}
                    yield {"contentBlockStop": {}}
                    yield {"messageStop": {"stopReason": "end_turn"}}
                yield {"metadata": {"usage": {"inputTokens": 100, "outputTokens": 20, "totalTokens": 120}, "metrics": {"latencyMs": 1}}}

        self.model = _M()


def test_strands_planner_falls_back_to_direct_tools_and_calls_them(tmp_path):
    reg = T.Registry()
    s = CoachSession(mode="cup", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="st1")
    h = reg.register(T.SessionHandle(session=s, pipeline=SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False), label="Claude agent · Anthropic API (dev)"))
    e = make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=0)
    s.on_events([e], snapshot={}, t=1.0)
    fake = FakeModel([("speak", {"session_id": "st1", "text": "Nice steady arc.", "cue": "instruct", "evidence": [e.id]})])

    def refuse(url):
        raise ConnectionError(f"no MCP at {url}")

    cfg = M.load_config({"PRAXIS_AGENT": "anthropic", "ANTHROPIC_API_KEY": "sk-test"})

    class Mcp:
        def __init__(self, url):
            refuse(url)

    planner = M.StrandsPlanner(cfg, model_factory=lambda c: fake.model, mcp_factory=Mcp)

    async def go():
        h.begin_run("arc_complete")
        try:
            return await planner.run(M.RunContext(handle=h, trigger="arc_complete", evidence=[e.id], prompt="Checkpoint: arc_complete", registry=reg))
        finally:
            h.end_run()

    res = asyncio.run(go())
    assert res.transport == "direct" and "no MCP" in res.mcp_error
    assert res.input_tokens == 200 and res.output_tokens == 40
    out = h.drain(2.0)
    coach = next(x for x in out if x.type == "coach")
    assert coach.payload["text"] == "Nice steady arc." and coach.payload["source"] == "agent"
    row = [r for r in s.trace.tail(20) if r["kind"] == "tool"][-1]
    assert row["transport"] == "direct" and row["name"] == "speak" and row["ok"] is True


def test_strands_planner_closes_the_model_client_inside_the_run_loop(tmp_path):
    """Each run builds a model (and with it an async HTTP client); it is closed before the run
    returns, on the loop that opened it. Left open, it was garbage-collected after the event
    loop closed ("Event loop is closed" at eval shutdown) and leaked in the live service."""
    reg = T.Registry()
    s = CoachSession(mode="cup", prescription=SEED_PRESCRIPTION, trace_dir=tmp_path, session_id="cl1")
    h = reg.register(T.SessionHandle(session=s, pipeline=SessionPipeline(mode="cup", sheet="cup_targets", use_hand=False)))
    e = make_event("arc_complete", t=1.0, arc=1, reaches=4, unverified=0)
    s.on_events([e], snapshot={}, t=1.0)
    fake = FakeModel([])
    closed = []

    class Client:
        async def close(self):
            closed.append(asyncio.get_running_loop())

    fake.model.client = Client()

    class Mcp:
        def __init__(self, url):
            raise ConnectionError("no MCP")

    cfg = M.load_config({"PRAXIS_AGENT": "anthropic", "ANTHROPIC_API_KEY": "sk-test"})
    planner = M.StrandsPlanner(cfg, model_factory=lambda c: fake.model, mcp_factory=Mcp)

    async def go():
        h.begin_run("arc_complete")
        try:
            await planner.run(M.RunContext(handle=h, trigger="arc_complete", evidence=[e.id], prompt="Checkpoint", registry=reg))
            return asyncio.get_running_loop()
        finally:
            h.end_run()

    loop = asyncio.run(go())
    assert closed == [loop]
