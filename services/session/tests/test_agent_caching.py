"""12 Oct: prompt caching on the agent's requests, per-model cost (cache reads and writes
included), the /health provider field and `model_verified`. Offline: the HTTP transport is a
stub (httpx.MockTransport), so nothing leaves the process."""
import asyncio
import json

import httpx

from praxis_session.agent import model as M
from praxis_session.agent.metrics import AgentMetrics, cost_usd

ENV = {"PRAXIS_AGENT": "anthropic", "ANTHROPIC_API_KEY": "sk-test", "PRAXIS_AGENT_MODEL": "claude-sonnet-5-5"}


def _sse(*events: dict) -> bytes:
    return b"".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n".encode() for e in events)


def _reply(text: str = "ok") -> bytes:
    usage = {"input_tokens": 12, "output_tokens": 3, "cache_read_input_tokens": 4000, "cache_creation_input_tokens": 0}
    return _sse(
        {"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5", "content": [], "stop_reason": None, "stop_sequence": None, "usage": usage}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}},
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": usage},
        {"type": "message_stop"},
    )


def test_request_carries_cache_points_effort_and_no_thinking_budget():
    """One real Strands agent turn against a stubbed Anthropic API: the request names the
    configured model, effort low, no thinking budget or sampling parameters, and cache points
    on the tool definitions, the static system prompt and the last message; the cache-read
    usage comes back."""
    from anthropic import AsyncAnthropic
    from strands import Agent, tool

    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_reply())

    @tool
    def get_set_summary(session_id: str) -> dict:
        """The last finished set."""
        return {"reps": 0}

    m = M.build_model(M.load_config(ENV), ENV)
    m.client = AsyncAnthropic(api_key="sk-test", max_retries=0, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    agent = Agent(model=m, tools=[get_set_summary], system_prompt=M.SYSTEM_PROMPT, callback_handler=None)
    result = asyncio.run(agent.invoke_async("Checkpoint: set_complete."))
    assert len(seen) == 1 and seen[0].url.path == "/v1/messages"
    body = json.loads(seen[0].content)
    assert body["model"] == "claude-sonnet-5-5" and body["output_config"] == {"effort": "low"}
    assert body["max_tokens"] == M.MAX_TOKENS and "thinking" not in body and "temperature" not in body
    assert body["tools"][-1].get("cache_control") == {"type": "ephemeral"}
    assert body["system"][-1].get("cache_control") == {"type": "ephemeral"} and body["system"][-1]["text"] == M.SYSTEM_PROMPT
    assert body["messages"][-1]["content"][-1].get("cache_control") == {"type": "ephemeral"}
    usage = result.metrics.accumulated_usage
    assert usage["cacheReadInputTokens"] == 4000 and usage["inputTokens"] == 12


def test_cost_uses_the_models_prices_and_cache_rates():
    # Sonnet: $2 in, $10 out, $0.20 cache read, $2.50 cache write per MTok
    assert M.cost_usd("claude-sonnet-5-5", 1_000_000, 0) == 2.0
    assert M.cost_usd("claude-sonnet-5-5", 0, 0, cache_read=1_000_000) == 0.2
    assert M.cost_usd("claude-sonnet-5", 0, 0, cache_write=1_000_000) == 2.5
    # Haiku 5.5: $0.10 in, $0.50 out
    assert M.cost_usd("claude-haiku-5-5", 1_000_000, 1_000_000) == 0.6
    # unknown model: the default model's prices
    assert M.cost_usd("something-else", 1_000_000, 0) == M.PRICES[M.DEFAULT_MODEL]["input"]
    assert cost_usd(0, 1_000_000, "claude-haiku-5-5") == 0.5


def test_metrics_line_carries_cache_tokens_and_model_cost():
    met = AgentMetrics(emit=False)
    row = met.run(session="s", trigger="checkin", outcome="done", model="claude-haiku-5-5", input_tokens=1000, output_tokens=200, cache_read_tokens=9000, cache_write_tokens=0)
    assert row["tokens"] == 10200 and row["cache_read_tokens"] == 9000
    assert row["cost_usd_est"] == round((1000 * 0.10 + 200 * 0.50 + 9000 * 0.01) / 1e6, 5)


def test_health_names_the_provider_and_whether_the_model_has_run():
    from praxis_session.main import agent_run_status

    cfg = M.load_config(ENV)
    assert cfg.health(True)["provider"] == "anthropic-api" and "sk-test" not in json.dumps(cfg.health(True))
    met = AgentMetrics(emit=False)
    assert agent_run_status(cfg, met) == {"model_verified": False}
    met.run(session="s", trigger="checkin", outcome="error", model=cfg.model)
    assert agent_run_status(cfg, met) == {"model_verified": False}  # an error is not a run
    met.run(session="s", trigger="checkin", outcome="done", model=cfg.model, input_tokens=10, output_tokens=5)
    assert agent_run_status(cfg, met) == {"model_verified": True}
    assert agent_run_status(M.load_config({}), met) == {}
