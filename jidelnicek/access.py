"""Zámek stránky: jen vybraná IP a přístupový kód, z kterého se ukládá jen otisk."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ALLOWED_IP = "185.22.236.11"
LOOPBACK = {"127.0.0.1", "::1"}
SESSION_MESSAGE = b"obedy-vstup-v1"


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_code_hash() -> str | None:
    raw = os.environ.get("ACCESS_UUID", "").strip()
    if raw:
        return sha256_text(raw)
    digest = os.environ.get("ACCESS_UUID_SHA256", "").strip().lower()
    if digest:
        return digest
    path = Path(os.environ.get("ACCESS_FILE", ROOT / "access.json"))
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    found = str(data.get("uuid_sha256") or "").strip().lower()
    return found or None


def gate_enabled() -> bool:
    return load_code_hash() is not None


def allowed_ips() -> set[str]:
    raw = os.environ.get("ALLOWED_IPS", DEFAULT_ALLOWED_IP)
    return {item.strip() for item in raw.split(",") if item.strip()}


def allow_loopback() -> bool:
    return os.environ.get("ALLOW_LOOPBACK", "1").strip().lower() not in {"0", "false", "ne"}


def trust_proxy() -> bool:
    return os.environ.get("TRUST_PROXY", "0").strip().lower() in {"1", "true", "ano"}


def client_ip(host: str | None, forwarded_for: str | None, trust: bool) -> str:
    if trust and forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return (host or "").strip()


def ip_allowed(ip: str, allowed: set[str] | None = None, loopback: bool | None = None) -> bool:
    addresses = allowed_ips() if allowed is None else allowed
    permit_loopback = allow_loopback() if loopback is None else loopback
    if permit_loopback and ip in LOOPBACK:
        return True
    return ip in addresses


def code_matches(code: str, digest: str) -> bool:
    submitted = sha256_text(code.strip())
    if len(submitted) != len(digest):
        return False
    return hmac.compare_digest(submitted, digest)


def session_token(digest: str) -> str:
    return hmac.new(bytes.fromhex(digest), SESSION_MESSAGE, hashlib.sha256).hexdigest()


def session_matches(token: str, digest: str) -> bool:
    expected = session_token(digest)
    if len(token) != len(expected):
        return False
    return hmac.compare_digest(token, expected)
