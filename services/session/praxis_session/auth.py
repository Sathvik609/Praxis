"""Who may call an internal or therapist-only route (no sign-in exists since 21 Sep; Cognito is
not built).

Two rules share one notion of "local": a request from loopback with no proxy header at all.
Railway, CloudFront and the EC2 unit (uvicorn --proxy-headers rewrites the client address from
X-Forwarded-For) all add proxy headers, so a public visitor never counts as local.

- MCP routes (`agent/mcp_server.py`): local, or the per-process `X-Praxis-MCP-Token`.
- Therapist writes (21 Oct team test: anyone with the public link could change practice days or
  clear therapist flags): with `PRAXIS_THERAPIST_TOKEN` set, only the matching
  `X-Praxis-Therapist-Token` header writes, from anywhere; unset, only a local request (laptop
  dev) writes and every public request is refused with 403. Reads stay open.
"""
from __future__ import annotations

import hmac
import os
from typing import Any

LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost"})
# Any of these means the request came through a proxy (CloudFront adds X-Forwarded-For and Via;
# the EC2 unit runs uvicorn with --proxy-headers --forwarded-allow-ips=*, which rewrites the
# client address from X-Forwarded-For, so loopback is only trusted with none of them present).
PROXY_HEADERS = (b"x-forwarded-for", b"forwarded", b"x-real-ip", b"via", b"x-forwarded-host", b"x-forwarded-proto", b"x-forwarded-port")
PROXY_PREFIXES = (b"cloudfront-", b"x-amz-cf-")
THERAPIST_HEADER = "X-Praxis-Therapist-Token"


def _headers(scope: dict[str, Any]) -> dict[bytes, bytes]:
    return {k.lower(): v for k, v in (scope.get("headers") or [])}


def is_local(scope: dict[str, Any]) -> bool:
    """Loopback client and no proxy header of any kind."""
    headers = _headers(scope)
    client = scope.get("client")
    host = client[0] if client else None
    proxied = any(h in headers for h in PROXY_HEADERS) or any(k.startswith(PROXY_PREFIXES) for k in headers)
    return host in LOOPBACK and not proxied


def header_matches(scope: dict[str, Any], header: str, token: str) -> bool | None:
    """None when the header is absent, else whether it equals `token` (constant time)."""
    sent = _headers(scope).get(header.lower().encode())
    if sent is None:
        return None
    return hmac.compare_digest(sent, token.encode())


def therapist_token_from_env() -> str | None:
    return (os.environ.get("PRAXIS_THERAPIST_TOKEN") or "").strip() or None


def therapist_write_allowed(scope: dict[str, Any], token: str | None) -> bool:
    if token:
        return bool(header_matches(scope, THERAPIST_HEADER, token))
    return is_local(scope)
