"""DELETE /models/<name>: a model's files go only when nothing plans, holds, fetches or measures it."""

import pytest

import app as engine
import asr
from test_security import KEY, OURS, client  # noqa: F401  (the fixture)


@pytest.fixture()
def models(tmp_path, monkeypatch):
    monkeypatch.setattr(asr, "MODELS_DIR", tmp_path / "models")
    monkeypatch.setattr(asr, "WHISPER_DIR", tmp_path / "models" / "whisper")
    return tmp_path / "models"


def whisper_here(name: str):
    folder = asr._cache_dir(name)
    (folder / "snapshots" / "abc").mkdir(parents=True)
    (folder / "snapshots" / "abc" / "model.bin").write_bytes(b"x")
    lock = asr.WHISPER_DIR / ".locks" / folder.name
    lock.mkdir(parents=True)
    return folder, lock


def test_an_unknown_model_is_404(client, models):
    assert client.request("DELETE", "/models/nope", headers=KEY).status_code == 404


def test_the_planned_model_stays(client, models):
    planned = engine.worker.entry("transcripts")[1]["model"]
    folder, _ = whisper_here(planned)
    answer = client.request("DELETE", f"/models/{planned}", headers=KEY)
    assert answer.status_code == 409 and "In use" in answer.json()["detail"]
    assert asr.downloaded(planned)


def test_a_loaded_model_stays(client, models, monkeypatch):
    whisper_here("tiny")
    monkeypatch.setattr(engine.worker.dictator, "_model", object())
    monkeypatch.setattr(engine.worker.dictator, "name", "tiny")
    assert client.request("DELETE", "/models/tiny", headers=KEY).status_code == 409
    assert asr.downloaded("tiny")


def test_a_model_being_fetched_stays(client, models, monkeypatch):
    monkeypatch.setattr(asr, "fetching", {"tiny"})
    assert client.request("DELETE", "/models/tiny", headers=KEY).status_code == 409


def test_an_unused_model_is_removed(client, models):
    folder, lock = whisper_here("tiny")
    answer = client.request("DELETE", "/models/tiny", headers=KEY)
    assert answer.status_code == 200 and answer.json() == {"name": "tiny", "state": "missing"}
    assert not folder.exists() and not lock.exists()


def test_a_failed_removal_says_so(client, models, monkeypatch):
    whisper_here("tiny")

    def refuse(path):
        raise PermissionError(13, "in use")

    monkeypatch.setattr(engine.shutil, "rmtree", refuse)
    answer = client.request("DELETE", "/models/tiny", headers=KEY)
    assert answer.status_code == 409 and "in use" in answer.json()["detail"]


def test_the_extension_cannot_remove_a_model(client, models):
    whisper_here("tiny")
    assert client.request("DELETE", "/models/tiny", headers={**OURS, **KEY}).status_code == 403
    assert client.request("DELETE", "/models/tiny").status_code == 401
    assert asr.downloaded("tiny")
