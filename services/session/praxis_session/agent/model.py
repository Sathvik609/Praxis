"""Agent configuration, model providers and planners (agent coach design §2, §6, §9).

`PRAXIS_AGENT` picks the coach:
- `off` (default): the rule coach only, exactly as before 29 Sep; no agent, no MCP routes.
- `anthropic`: Strands `AnthropicModel`, `PRAXIS_AGENT_MODEL` (default `claude-sonnet-5`),
  needs `ANTHROPIC_API_KEY`. Development path while AWS is deferred.
- `bedrock`: Strands `BedrockModel`, model id `PRAXIS_BEDROCK_MODEL_ID`, region `AWS_REGION`;
  only with `PRAXIS_CLOUD_ENABLED=1` (every cloud call is gated, CLAUDE.md §1).
- `scripted`: a fixed list of tool calls per checkpoint, no network (tests, CI, UI work).

A **planner** runs one checkpoint: `StrandsPlanner` (the real model, tools over MCP to this
service's own `/mcp/*` routes, or the same functions as direct Strands tools when the MCP
connection fails) and `ScriptedPlanner` (executes given tool calls through the same dispatch,
MCP or direct). Checkpoint latency is kept low: effort `low`, small `max_tokens`, no retries,
no `thinking.budget_tokens` (Sonnet 5 rejects it with a 400), no sampling parameters.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from praxis_session.agent import tools as T
from praxis_session.agent.budget import DailyRunBudget, parse_limit

AGENT_LABELS = {
    "anthropic": "Claude agent · Anthropic API (dev)",
    "bedrock": "Claude agent · Amazon Bedrock",
    "scripted": "Claude agent · scripted (test)",
}
DEFAULT_MODEL = "claude-sonnet-5"
MAX_TOKENS = 800
EFFORT = "low"
RUN_TIMEOUT_S = 15.0
MCP_STARTUP_TIMEOUT_S = 3
# Sonnet 5 list price per million tokens (Anthropic API, cached 2026-06-24); Bedrock differs.
PRICE_PER_MTOK = {"input": 2.00, "output": 10.00}


@dataclass(frozen=True)
class AgentConfig:
    mode: str  # off | anthropic | bedrock | scripted
    model: str | None = None
    ready: bool = False
    reason: str | None = None
    region: str | None = None
    mcp_url: str = "http://127.0.0.1:8000/mcp"
    mcp_enabled: bool = False
    # Process-wide daily run cap (PRAXIS_AGENT_DAILY_RUNS); shared by every session's AgentCoach.
    budget: DailyRunBudget = field(default_factory=DailyRunBudget, compare=False, repr=False)

    @property
    def enabled(self) -> bool:
        return self.mode != "off"

    @property
    def label(self) -> str | None:
        return AGENT_LABELS.get(self.mode)

    def health(self, mcp_mounted: bool) -> dict[str, Any]:
        out: dict[str, Any] = {"mode": self.mode, "model": self.model, "mcp": mcp_mounted, "ready": self.ready}
        out |= self.budget.health()
        if self.reason:
            out["reason"] = self.reason
        return out


def load_config(env: Mapping[str, str] | None = None) -> AgentConfig:
    """Read the agent configuration from the environment. Never logs or returns a key."""
    env = os.environ if env is None else env
    mode = (env.get("PRAXIS_AGENT") or "off").strip().lower()
    port = env.get("PORT") or "8000"
    mcp_url = (env.get("PRAXIS_MCP_URL") or f"http://127.0.0.1:{port}/mcp").rstrip("/")
    mcp_flag = env.get("PRAXIS_MCP", "") == "1"
    budget = DailyRunBudget(parse_limit(env.get("PRAXIS_AGENT_DAILY_RUNS")))
    if mode in ("", "off", "0", "false", "none"):
        return AgentConfig("off", None, False, "PRAXIS_AGENT=off", mcp_url=mcp_url, mcp_enabled=mcp_flag, budget=budget)
    if mode == "anthropic":
        model = env.get("PRAXIS_AGENT_MODEL") or DEFAULT_MODEL
        has_key = bool((env.get("ANTHROPIC_API_KEY") or "").strip())
        return AgentConfig("anthropic", model, has_key, None if has_key else "ANTHROPIC_API_KEY is not set", mcp_url=mcp_url, mcp_enabled=True, budget=budget)
    if mode == "bedrock":
        model = env.get("PRAXIS_BEDROCK_MODEL_ID") or None
        region = env.get("AWS_REGION") or env.get("AWS_DEFAULT_REGION") or None
        reason = None
        if env.get("PRAXIS_CLOUD_ENABLED", "0") != "1":
            reason = "bedrock needs PRAXIS_CLOUD_ENABLED=1"
        elif not model:
            reason = "PRAXIS_BEDROCK_MODEL_ID is not set"
        elif not region:
            reason = "AWS_REGION is not set"
        return AgentConfig("bedrock", model, reason is None, reason, region=region, mcp_url=mcp_url, mcp_enabled=True, budget=budget)
    if mode == "scripted":
        return AgentConfig("scripted", "scripted", True, None, mcp_url=mcp_url, mcp_enabled=True, budget=budget)
    return AgentConfig("off", None, False, f"unknown PRAXIS_AGENT={mode!r}; the coach stays rule-based", mcp_url=mcp_url, mcp_enabled=mcp_flag, budget=budget)


def build_model(cfg: AgentConfig, env: Mapping[str, str] | None = None) -> Any:
    """The Strands model for `cfg` (constructed only; no request is made here)."""
    env = os.environ if env is None else env
    if cfg.mode == "anthropic":
        from strands.models.anthropic import AnthropicModel

        return AnthropicModel(
            client_args={"api_key": env.get("ANTHROPIC_API_KEY", ""), "max_retries": 0, "timeout": RUN_TIMEOUT_S},
            model_id=cfg.model or DEFAULT_MODEL,
            max_tokens=MAX_TOKENS,
            # Sonnet 5: effort, not a thinking budget (budget_tokens is a 400); no temperature.
            params={"output_config": {"effort": EFFORT}},
        )
    if cfg.mode == "bedrock":
        from botocore.config import Config as BotocoreConfig
        from strands.models.bedrock import BedrockModel

        return BedrockModel(
            model_id=cfg.model,
            region_name=cfg.region,
            max_tokens=MAX_TOKENS,
            boto_client_config=BotocoreConfig(read_timeout=RUN_TIMEOUT_S, connect_timeout=3, retries={"max_attempts": 1}),
        )
    raise ValueError(f"no model for PRAXIS_AGENT={cfg.mode}")


def classify_error(exc: BaseException) -> str:
    """Map a model / transport failure to a short `agent_error.error_kind`."""
    seen: set[int] = set()
    e: BaseException | None = exc
    while e is not None and id(e) not in seen:
        seen.add(id(e))
        name = type(e).__name__
        status = getattr(e, "status_code", None)
        if isinstance(e, (asyncio.TimeoutError, TimeoutError)) or name in ("APITimeoutError", "ReadTimeoutError", "ReadTimeout"):
            return "timeout"
        if name in ("AuthenticationError", "PermissionDeniedError") or status in (401, 403):
            return "auth"
        if name in ("RateLimitError", "ModelThrottledException", "ThrottlingException") or status == 429:
            return "rate_limit"
        if status in (500, 502, 503, 504, 529) or name in ("InternalServerError", "ServiceUnavailableError", "OverloadedError"):
            return "unavailable"
        if name in ("APIConnectionError", "ConnectError", "EndpointConnectionError"):
            return "connection"
        if name in ("MCPClientInitializationError", "ToolProviderException"):
            return "mcp"
        if name == "AgentRefusal":
            return "refusal"
        if name in ("MaxTokensReachedException",):
            return "max_tokens"
        if name in ("BadRequestError",) or status == 400:
            return "bad_request"
        if name in ("ValidationError", "JSONDecodeError", "ToolRejected"):
            return "malformed"
        if name == "ClientError":  # botocore
            code = str(getattr(e, "response", {}).get("Error", {}).get("Code", ""))
            return {"ThrottlingException": "rate_limit", "AccessDeniedException": "auth", "ModelTimeoutException": "timeout"}.get(code, "bedrock")
        e = e.__cause__ or e.__context__
    return "model_error"


class AgentRefusal(Exception):
    """The model declined (stop_reason `refusal`)."""


# ---- planners -------------------------------------------------------------------------------
@dataclass
class RunContext:
    handle: T.SessionHandle
    trigger: str
    evidence: list[int]
    prompt: str
    also: list[str] = field(default_factory=list)
    registry: T.Registry | None = None


@dataclass
class PlanResult:
    transport: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    text: str = ""
    mcp_error: str | None = None


class _Transport:
    """Tool calls for the scripted planner: MCP clients (in-process servers, or HTTP when a URL
    is given) with the direct functions as fallback when the MCP connection fails."""

    def __init__(self, registry: T.Registry | None, prefer: str, servers: dict[str, Any] | None, url: str | None) -> None:
        self.registry, self.prefer, self.servers, self.url = registry, prefer, servers, url
        self.name = "direct"
        self.error: str | None = None
        self._clients: dict[str, Any] = {}
        self._stack = AsyncExitStack()

    async def __aenter__(self) -> _Transport:
        if self.prefer == "mcp":
            from fastmcp import Client

            try:
                for server in T.SERVERS:
                    target = f"{self.url}/{server}" if self.url else self.servers[server]  # type: ignore[index]
                    c = Client(target, timeout=5)
                    self._clients[server] = await asyncio.wait_for(self._stack.enter_async_context(c), MCP_STARTUP_TIMEOUT_S)
                self.name = "mcp"
            except Exception as e:  # MCP down: this run uses the same functions directly
                self.error = f"{type(e).__name__}: {e}"[:200]
                await self._stack.aclose()
                self._stack = AsyncExitStack()
                self._clients = {}
        return self

    async def __aexit__(self, *exc: Any) -> None:
        try:
            await self._stack.aclose()
        except Exception:  # pragma: no cover - closing a broken HTTP session
            pass

    async def call(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        if self.name == "mcp":
            r = await self._clients[T.SERVER_OF[name]].call_tool(name, args, raise_on_error=False)
            if r.is_error:
                raise T.ToolRejected(r.content[0].text if r.content else "tool error")
            return dict(r.structured_content or {})
        return await asyncio.to_thread(T.invoke, name, args, "direct", self.registry)


_REF = re.compile(r"\{([a-z_]+)\.([A-Za-z0-9_.]+)\}")


def _lookup(results: dict[str, Any], tool: str, path: str) -> Any:
    cur: Any = results.get(tool)
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return None
    return cur


class ScriptedPlanner:
    """Runs a fixed list of tool calls per checkpoint through the real dispatch (MCP or direct).

    `scripts` maps a trigger (`checkin`, `set_complete`, `pause:failed_reps`, ...), its prefix
    (`pause`) or `*` to steps. A step is `{"tool": name, "args": {...}}` with placeholders:
    `"$session"`, `"$evidence"` (the checkpoint's event ids), `"$last:<type>"` (id list of the
    newest event of that type) and `"{tool.path}"` inside strings (a value from an earlier
    result, e.g. `{check_setup.first_hint}`); `"if": "tool.path"` runs a step only when that
    value is truthy; `{"sleep": s}` waits; `{"raise": "timeout"|"error"}` fails the run.
    """

    mode = "scripted"
    model = "scripted"

    def __init__(self, scripts: dict[str, list[dict[str, Any]]] | None = None, transport: str = "mcp", servers: dict[str, Any] | None = None, mcp_url: str | None = None) -> None:
        self.scripts = DEFAULT_SCRIPT if scripts is None else scripts
        self.transport = transport
        self.servers = servers
        self.mcp_url = mcp_url

    def steps_for(self, trigger: str) -> list[dict[str, Any]]:
        for key in (trigger, trigger.split(":")[0], "*"):
            if key in self.scripts:
                return list(self.scripts[key])
        return []

    async def run(self, ctx: RunContext) -> PlanResult:
        steps = self.steps_for(ctx.trigger)
        servers = self.servers
        if servers is None and self.transport == "mcp" and self.mcp_url is None:
            from praxis_session.agent import mcp_server

            same = ctx.registry is None or ctx.registry is T.REGISTRY
            servers = mcp_server.SERVERS if same else mcp_server.build_servers(ctx.registry)
        results: dict[str, Any] = {}
        async with _Transport(ctx.registry, self.transport, servers, self.mcp_url) as tr:
            for step in steps:
                if "sleep" in step:
                    await asyncio.sleep(float(step["sleep"]))
                    continue
                if "raise" in step:
                    raise (asyncio.TimeoutError() if step["raise"] == "timeout" else RuntimeError(str(step["raise"])))
                cond = step.get("if")
                if cond and not _lookup(results, *cond.split(".", 1)):
                    continue
                name = step["tool"]
                args = self._resolve(step.get("args", {}), ctx, results)
                args.setdefault("session_id", ctx.handle.session_id)
                try:
                    results[name] = await tr.call(name, args)
                except T.ToolRejected as e:
                    results[name] = {"error": str(e)}
            return PlanResult(transport=tr.name, input_tokens=0, output_tokens=0, text=f"{len(steps)} scripted steps", mcp_error=tr.error)

    def _resolve(self, value: Any, ctx: RunContext, results: dict[str, Any]) -> Any:
        if isinstance(value, dict):
            return {k: self._resolve(v, ctx, results) for k, v in value.items()}
        if isinstance(value, list):
            return [self._resolve(v, ctx, results) for v in value]
        if not isinstance(value, str):
            return value
        if value == "$session":
            return ctx.handle.session_id
        if value == "$evidence":
            return list(ctx.evidence)
        if value.startswith("$last:"):
            evs = ctx.handle.session.recent_events(types=[value[6:]], last_n=1)
            return [evs[-1].id] if evs else []
        return _REF.sub(lambda m: str(_lookup(results, m.group(1), m.group(2)) or ""), value)


# A generic script for PRAXIS_AGENT=scripted in the running app (UI work without a key).
DEFAULT_SCRIPT: dict[str, list[dict[str, Any]]] = {
    "checkin": [
        {"tool": "get_prescription"},
        {"tool": "speak", "args": {"text": "Thanks for checking in. We'll go at your program's pace; tell me if anything hurts.", "cue": "instruct", "evidence": "$evidence"}},
    ],
    "set_complete": [
        {"tool": "get_set_summary"},
        {"tool": "speak", "args": {"text": "Set done: {get_set_summary.verified} of {get_set_summary.reps} verified. Rest the arm a moment.", "cue": "instruct", "evidence": "$evidence"}},
    ],
    "arc_complete": [
        {"tool": "get_set_summary"},
        {"tool": "speak", "args": {"text": "Arc done: {get_set_summary.verified} of {get_set_summary.reps} verified.", "cue": "instruct", "evidence": "$evidence"}},
    ],
    "pause": [
        {"tool": "check_setup"},
        {"tool": "speak", "if": "check_setup.first_hint", "args": {"text": "{check_setup.first_hint}", "cue": "correct", "evidence": "$evidence"}},
        {"tool": "recalibrate"},
        {"tool": "request_resume", "args": {"reason": "I've re-checked the camera setup.", "evidence": "$evidence"}},
    ],
    "nhpt_complete": [
        {"tool": "speak", "args": {"text": "That's the peg test recorded. Your therapist will see the time and splits.", "cue": "instruct", "evidence": "$evidence"}},
    ],
    "feedback": [
        {"tool": "get_set_summary"},
        {"tool": "write_session_summary", "args": {"note": "Session ended: {get_set_summary.session_counts.verified} verified, {get_set_summary.session_counts.unverified} unverified.", "evidence": "$evidence"}},
    ],
}


SYSTEM_PROMPT = """You are the Praxis home-rehab coach, working beside a deterministic rule coach.
The therapist prescribes; you coach within the prescription. You are not a clinician: no
diagnosis, no clinical claims, no promises about recovery. Feelings are self-reported; you
never read them from the face.

You run only at checkpoints (check-in, end of a set or arc, a stop-rule pause, peg-test end,
session end). Each run: at most 6 tool calls, then stop. Every coach action needs `evidence`:
ids of this session's events from get_events or get_set_summary (never invent ids).

- Talk to the patient only with `speak`: one short, warm, plain line (<= 160 characters).
- Change the dose only with `propose_adjustment`; the patient decides (Yes / Keep / Why).
  Values are clamped to the prescription; never suggest anything outside it.
- The patient reads every `text` and every `reason` you pass (speak, propose_adjustment,
  request_rest, request_resume): plain everyday words, no measurements like "rms" or "mm",
  no internal names (marker ids, tools, events).
- Setup problem (pause after unverified reps or lost tracking): get_set_summary to see why
  the reps were not verified, then check_setup. Speak the one specific fix: the failing
  check's hint (say which corner or body part), or, if every check passes, the reason the
  reps were not verified (for example a hand covering the cup). Then recalibrate, then
  request_resume (the prompt already asks the patient, so do not ask in `speak` too).
  Never resume on your own.
- Compensation on most reps of a set (trunk lean or shoulder hiking): the target is too high
  for good form. Correct the form with speak and propose a smaller target with
  propose_adjustment.
- Falling peak angles, slower reps or moderate/high exertion: consider a smaller target or
  a shorter hold with propose_adjustment, or request_rest.
- At session end: write_session_summary (<= 400 characters, factual, cite evidence).
- If nothing useful needs saying, say nothing.
When done, reply with one short sentence describing what you did."""

TRIGGER_JOB = {
    "checkin": "Plan the session: read the prescription (and history if useful) and give one short opening instruction.",
    "set_complete": "Review the set just finished (get_set_summary, get_exertion_state): praise, correct, or propose an adjustment.",
    "arc_complete": "Review the arc just finished (get_set_summary, get_exertion_state): praise, correct, or propose an adjustment.",
    "pause": "Setup recovery: get_set_summary (why reps were not verified), check_setup, speak the specific fix, recalibrate, request_resume.",
    "nhpt_complete": "Explain the peg-test result plainly (time, splits); no clinical interpretation.",
    "feedback": "Write the session summary note for the report.",
}


def build_prompt(h: T.SessionHandle, trigger: str, evidence: list[int], also: list[str]) -> str:
    """The per-run user message: the checkpoint, the evidence ids and a numbers-only context."""
    s = h.session
    ctx = {
        "session_id": s.session_id,
        "mode": s.mode,
        "exercise": s.exercise,
        "trigger": trigger,
        "also_since_last_run": also,
        "evidence_event_ids": evidence,
        "paused": s.paused,
        "pause_rule": s.pause_rule,
        "counts": s.counts,
        "exertion": {k: v for k, v in s.exertion.state.items() if k in ("level", "reasons")},
        "checkin": s.checkin,
        "source": "replay" if s.replay_clip else "live",
    }
    job = TRIGGER_JOB.get(trigger, TRIGGER_JOB.get(trigger.split(":")[0], "Review and act only if useful."))
    return f"Checkpoint: {trigger}. {job}\nContext: {json.dumps(ctx, default=str)}"


def direct_tools(registry: T.Registry | None = None) -> list[Any]:
    """The tools as Strands function tools (transport `direct`): the MCP fallback."""
    from strands import tool as strands_tool

    return [strands_tool(T.bind(name, "direct", registry)) for name in T.TOOLS]


class StrandsPlanner:
    """The real model: a Strands Agent with tools over MCP (this service's own `/mcp/*`
    routes), or the same functions as direct Strands tools when MCP cannot connect."""

    def __init__(
        self,
        cfg: AgentConfig,
        model_factory: Callable[[AgentConfig], Any] | None = None,
        agent_factory: Callable[..., Any] | None = None,
        mcp_factory: Callable[[str], Any] | None = None,
    ) -> None:
        self.cfg = cfg
        self.mode = cfg.mode
        self.model = cfg.model or ""
        self._model_factory = model_factory or build_model
        self._agent_factory = agent_factory
        self._mcp_factory = mcp_factory

    def _mcp_client(self, url: str) -> Any:
        if self._mcp_factory is not None:
            return self._mcp_factory(url)
        from mcp.client.streamable_http import streamable_http_client
        from strands.tools.mcp import MCPClient

        # Our own transport callable: MCPClient(url=...) still builds the deprecated
        # `streamablehttp_client` (DeprecationWarning with mcp 1.30).
        return MCPClient(lambda: streamable_http_client(url), startup_timeout=MCP_STARTUP_TIMEOUT_S)

    def _start_mcp(self) -> tuple[list[Any], list[Any]]:
        clients: list[Any] = []
        try:
            for server in T.SERVERS:
                c = self._mcp_client(f"{self.cfg.mcp_url}/{server}")
                c.start()
                clients.append(c)
            tools = [t for c in clients for t in c.list_tools_sync()]
            return clients, tools
        except BaseException:
            self._stop_mcp(clients)
            raise

    @staticmethod
    def _stop_mcp(clients: list[Any]) -> None:
        for c in clients:
            try:
                c.stop(None, None, None)
            except Exception:  # pragma: no cover
                pass

    def _agent(self, tools: list[Any]) -> Any:
        if self._agent_factory is not None:
            return self._agent_factory(model=self._model_factory(self.cfg), tools=tools, system_prompt=SYSTEM_PROMPT)
        from strands import Agent

        return Agent(model=self._model_factory(self.cfg), tools=tools, system_prompt=SYSTEM_PROMPT, callback_handler=None, retry_strategy=None)

    async def run(self, ctx: RunContext) -> PlanResult:
        transport, clients, mcp_error = "mcp", [], None
        try:
            clients, tools = await asyncio.to_thread(self._start_mcp)
        except Exception as e:
            transport, tools, mcp_error = "direct", direct_tools(ctx.registry), f"{type(e).__name__}: {e}"[:200]
        try:
            agent = self._agent(tools)
            result = await agent.invoke_async(ctx.prompt)
            if getattr(result, "stop_reason", None) == "refusal":
                raise AgentRefusal("the model declined this checkpoint")
            usage = getattr(getattr(result, "metrics", None), "accumulated_usage", None) or {}
            return PlanResult(transport, usage.get("inputTokens"), usage.get("outputTokens"), str(result)[:300], mcp_error)
        finally:
            if clients:
                await asyncio.to_thread(self._stop_mcp, clients)


def make_planner(cfg: AgentConfig) -> Any:
    if cfg.mode == "scripted":
        return ScriptedPlanner()
    return StrandsPlanner(cfg)
