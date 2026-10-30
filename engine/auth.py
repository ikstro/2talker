"""Who may call the engine.

The engine listens on 127.0.0.1, which every program and every Windows account
on the computer can reach, and any Chrome extension too. So:

- Krya (and a program of the person's that reads the key) sends the engine's
  key in X-Krya-Token. The key is random, kept in speech-token beside the
  engine's settings (in the person's own %APPDATA%, which other accounts cannot
  read) and handed to the engine Krya starts in KRYA_SPEECH_TOKEN.
- Krya's own Chrome extension, known by its fixed id (the "key" in
  extension/manifest.json), may only say hello and record a meeting.
- Anything else gets /health's bare "ok" (the extension's first look may come
  without an Origin) and nothing more.

`/health` with X-Krya-Nonce answers HMAC(key, nonce), so Krya knows the engine
on the port is its own, not another program that took the port first.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from pathlib import Path

from settings import APP_DIR

TOKEN_FILE = APP_DIR / "speech-token"
# The id Chrome gives extension/ (from the public key in its manifest), wherever it is loaded from.
EXTENSION_ID = "phokhlmnodckgejnaogjgpmfjnjkefpa"
EXTENSION_ORIGIN = f"chrome-extension://{EXTENSION_ID}"

# What the extension does: say hello, then record a meeting chunk by chunk.
_EXTENSION_ROUTES = [
    ("GET", re.compile(r"/health")),
    ("POST", re.compile(r"/recordings")),
    ("PUT", re.compile(r"/recordings/[^/]+/[^/]+/\d+")),
    ("POST", re.compile(r"/recordings/[^/]+/finish")),
    ("DELETE", re.compile(r"/recordings/[^/]+")),
]


def load_token(path: Path = TOKEN_FILE) -> str:
    """The engine's key: Krya's (KRYA_SPEECH_TOKEN), else the file's, else a new one written there."""
    given = os.environ.get("KRYA_SPEECH_TOKEN", "").strip()
    if given:
        return given
    try:
        kept = path.read_text("utf-8").strip()
        if kept:
            return kept
    except OSError:
        pass
    made = secrets.token_hex(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(made, "utf-8")
    return made


def token_ok(given: str, token: str) -> bool:
    return bool(given) and hmac.compare_digest(given.encode(), token.encode())


def proof(token: str, nonce: str) -> str:
    """What only the engine holding the key can answer to a nonce."""
    return hmac.new(token.encode(), nonce.encode(), hashlib.sha256).hexdigest()


def extension_may(method: str, path: str) -> bool:
    """Krya's extension calls only its own routes (a preflight for them too)."""
    return any((method == m or method == "OPTIONS") and p.fullmatch(path) for m, p in _EXTENSION_ROUTES)
