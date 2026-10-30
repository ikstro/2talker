"""The engine notices the Chrome extension from the header it sends, and keeps it in /health."""

import asyncio
import json

import pytest
from starlette.requests import Request
from starlette.responses import Response

import app as engine

ORIGIN = "chrome-extension://" + "a" * 32


@pytest.fixture(autouse=True)
def fresh(tmp_path, monkeypatch):
    monkeypatch.setattr(engine, "EXTENSION_FILE", tmp_path / "extension.json")
    monkeypatch.setattr(engine, "extension", None)


def call(headers: dict) -> int:
    """One request through the guard; returns the status."""
    raw = {"host": "127.0.0.1:8765", **headers}
    scope = {"type": "http", "method": "GET", "path": "/health", "headers": [(k.encode(), v.encode()) for k, v in raw.items()], "query_string": b""}

    async def next_(_request):
        return Response("ok")

    return asyncio.run(engine.guard(Request(scope), next_)).status_code


def test_the_header_with_an_extension_origin_is_recorded():
    assert call({"origin": ORIGIN, "x-krya-extension": "0.2.0"}) == 200
    assert engine.extension["id"] == "a" * 32 and engine.extension["version"] == "0.2.0"
    assert engine.health()["extension"] == engine.extension
    assert json.loads(engine.EXTENSION_FILE.read_text("utf-8"))["version"] == "0.2.0"


def test_the_old_name_s_header_is_recorded_too():
    # An extension of Altype's days says hello as X-Altype-Extension until Chrome reloads it.
    assert call({"origin": ORIGIN, "x-altype-extension": "0.2.1"}) == 200
    assert engine.extension["version"] == "0.2.1"


def test_without_the_header_nothing_is_recorded():
    assert call({"origin": ORIGIN}) == 200
    assert engine.extension is None and not engine.EXTENSION_FILE.exists()
    assert engine.health()["extension"] is None


def test_a_later_ping_refreshes_the_time_but_rewrites_the_file_only_for_a_new_version(monkeypatch):
    call({"origin": ORIGIN, "x-krya-extension": "0.2.0"})
    first = engine.extension["seen"]
    engine.EXTENSION_FILE.write_text("{}", "utf-8")  # a stand-in: a rewrite would replace it
    monkeypatch.setattr(engine.time, "time", lambda: first + 900)
    call({"origin": ORIGIN, "x-krya-extension": "0.2.0"})
    assert engine.extension["seen"] == first + 900 and engine.EXTENSION_FILE.read_text("utf-8") == "{}"
    call({"origin": ORIGIN, "x-krya-extension": "0.3.0"})
    assert json.loads(engine.EXTENSION_FILE.read_text("utf-8"))["version"] == "0.3.0"


def test_a_refused_request_records_nothing():
    assert call({"origin": "https://example.com", "x-krya-extension": "0.2.0"}) == 403
    assert engine.extension is None


def test_the_last_sighting_is_read_at_start():
    engine.EXTENSION_FILE.write_text(json.dumps({"id": "b" * 32, "version": "0.2.0", "seen": 5.0}), "utf-8")
    assert engine.load_extension() == {"id": "b" * 32, "version": "0.2.0", "seen": 5.0}
