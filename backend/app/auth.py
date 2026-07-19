"""Single-user authentication: PBKDF2 password hashing + stateless HMAC tokens.

The app binds to 127.0.0.1, so this is about keeping a shared machine's other
users out — not internet-facing hardening. One password protects the dashboard.

Credentials live in data/auth.json (never exposed by the settings API). Tokens
are stateless HMAC-signed blobs — they survive server restarts and carry only an
expiry, so there is no session table to manage. Rotating the server secret (on
password change) invalidates every previously issued token.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time

from .paths import AUTH_PATH

_lock = threading.Lock()

ITERATIONS = 200_000
TOKEN_TTL_SECONDS = 30 * 24 * 3600  # 30 days
_MIN_PASSWORD_LEN = 6


def _read() -> dict:
    if not os.path.exists(AUTH_PATH):
        return {}
    try:
        with open(AUTH_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _write(data: dict) -> None:
    with open(AUTH_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _hash_password(password: str, salt: bytes) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return dk.hex()


def is_password_set() -> bool:
    with _lock:
        return bool(_read().get("hash"))


def set_password(password: str) -> None:
    """Create the password for the first time (fails if one already exists)."""
    password = (password or "").strip()
    if len(password) < _MIN_PASSWORD_LEN:
        raise ValueError(f"Password must be at least {_MIN_PASSWORD_LEN} characters.")
    with _lock:
        data = _read()
        if data.get("hash"):
            raise ValueError("A password is already set.")
        salt = secrets.token_bytes(16)
        _write({
            "salt": salt.hex(),
            "hash": _hash_password(password, salt),
            "secret": secrets.token_hex(32),
            "created_at": int(time.time()),
        })


def verify_password(password: str) -> bool:
    with _lock:
        data = _read()
    if not data.get("hash") or not data.get("salt"):
        return False
    try:
        salt = bytes.fromhex(data["salt"])
    except ValueError:
        return False
    candidate = _hash_password(password or "", salt)
    return hmac.compare_digest(candidate, data["hash"])


def change_password(current: str, new: str) -> None:
    if not verify_password(current):
        raise ValueError("Current password is incorrect.")
    new = (new or "").strip()
    if len(new) < _MIN_PASSWORD_LEN:
        raise ValueError(f"Password must be at least {_MIN_PASSWORD_LEN} characters.")
    with _lock:
        data = _read()
        salt = secrets.token_bytes(16)
        data["salt"] = salt.hex()
        data["hash"] = _hash_password(new, salt)
        data["secret"] = secrets.token_hex(32)  # rotate -> invalidates old tokens
        _write(data)


def _secret() -> bytes:
    with _lock:
        data = _read()
    sec = data.get("secret")
    return sec.encode("utf-8") if sec else b""


def _sign(payload_b64: str, secret: bytes) -> str:
    sig = hmac.new(secret, payload_b64.encode("ascii"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")


def issue_token() -> str:
    secret = _secret()
    if not secret:
        raise ValueError("No password configured.")
    payload = {"exp": int(time.time()) + TOKEN_TTL_SECONDS}
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload).encode("utf-8")).decode("ascii").rstrip("=")
    return f"{payload_b64}.{_sign(payload_b64, secret)}"


def verify_token(token: str | None) -> bool:
    # Never raise — a malformed/hostile header must yield a clean False (401),
    # not a 500. The Authorization header is latin-1, so it may carry non-ASCII
    # bytes that would otherwise blow up the ascii encode in _sign().
    if not token or "." not in token:
        return False
    secret = _secret()
    if not secret:
        return False
    try:
        payload_b64, _, sig = token.partition(".")
        expected = _sign(payload_b64, secret)
        if not hmac.compare_digest(sig, expected):
            return False
        pad = "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + pad))
        return int(payload.get("exp", 0)) > int(time.time())
    except Exception:
        return False
