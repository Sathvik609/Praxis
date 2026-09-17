"""Local accounts for the edge build (17 Sep 2026): three named users, passwords stored as
SHA-256 hashes, tokens kept in memory for the life of the process. No database yet; Cognito
replaces this in cloud mode. No OpenCV here."""
from __future__ import annotations

import hashlib
import secrets
from typing import Any

# username -> (display name, sha256 of the password)
_USERS: dict[str, tuple[str, str]] = {
    "rinky": ("Rinky", "***REMOVED***"),
    "shruthi": ("Shruthi", "***REMOVED***"),
    "sathvik": ("Sathvik", "***REMOVED***"),
}
_TOKENS: dict[str, str] = {}


def _h(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify(username: str, password: str) -> dict[str, Any] | None:
    """Case-insensitive username, case-sensitive password. Returns the public user record."""
    key = (username or "").strip().lower()
    rec = _USERS.get(key)
    if rec is None or not secrets.compare_digest(_h(password or ""), rec[1]):
        return None
    return {"username": key, "name": rec[0], "initial": rec[0][0].upper()}


def issue_token(username: str) -> str:
    token = secrets.token_urlsafe(32)
    _TOKENS[token] = username
    return token


def user_for_token(token: str | None) -> dict[str, Any] | None:
    key = _TOKENS.get(token or "")
    if key is None:
        return None
    name = _USERS[key][0]
    return {"username": key, "name": name, "initial": name[0].upper()}


def revoke(token: str | None) -> None:
    _TOKENS.pop(token or "", None)
