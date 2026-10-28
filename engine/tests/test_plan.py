import time

import pytest

import asr
import bench
import settings as settings_module
from settings import Settings, clean_plan


@pytest.fixture
def s(tmp_path):
    return Settings(tmp_path / "speech.json")


def test_catalog_models_are_the_whisper_ones():
    assert settings_module.MODELS == ("tiny", "base", "small", "large-v3-turbo", "large-v3")
    assert asr.SIZES["small"] > asr.SIZES["base"] > asr.SIZES["tiny"]


def test_parakeet_dictates_on_the_processor_only():
    plan = clean_plan({"cpu": {"dictation": {"model": "parakeet-tdt-0.6b-v3"}, "transcripts": {"model": "parakeet-tdt-0.6b-v3"}}, "cuda": {"dictation": {"model": "parakeet-tdt-0.6b-v3"}}})
    assert plan == {"cpu": {"dictation": {"model": "parakeet-tdt-0.6b-v3"}}}
    assert asr.backend("parakeet-tdt-0.6b-v3") == "parakeet" and asr.backend("small") == "whisper"


def test_clean_plan_keeps_what_the_engine_knows():
    plan = clean_plan({
        "fingerprint": "abc",
        "threads": 8,
        "cpu": {"dictation": {"model": "small", "beam": 2, "compute": "float16"}, "transcripts": {"model": "nope"}},
        "cuda": {"transcripts": {"model": "large-v3-turbo", "compute": "int8_float16"}},
        "tpu": {"dictation": {"model": "small"}},
    })
    assert plan == {
        "fingerprint": "abc",
        "threads": 8,
        "cpu": {"dictation": {"model": "small", "beam": 2}},
        "cuda": {"transcripts": {"model": "large-v3-turbo", "compute": "int8_float16"}},
    }


def test_settings_keep_a_clean_plan_and_drop_a_broken_bench(s):
    s.update({"plan": {"cpu": {"dictation": {"model": "base"}}, "junk": 1}, "bench": {"runs": "no"}})
    assert s["plan"] == {"cpu": {"dictation": {"model": "base"}}}
    assert s["bench"] == {}
    s.update({"model": "medium"})
    assert s["model"] == "large-v3-turbo"


def test_pick_language_prefers_the_expected_ones_when_unsure():
    probs = {"de": 0.4, "en": 0.35, "ru": 0.2}
    assert asr.pick_language(probs, ["ru", "en"]) == "en"
    assert asr.pick_language({"uk": 0.8, "ru": 0.15, "en": 0.05}, ["ru", "en"]) == "uk"
    assert asr.pick_language({"ru": 0.5, "en": 0.4}, ["ru", "en"]) == "ru"
    assert asr.pick_language({"fr": 0.6}, []) == "fr"


def test_strict_language_never_leaves_the_expected_ones():
    probs = {"uk": 0.8, "ru": 0.15, "en": 0.05}
    assert asr.pick_language(probs, ["ru", "en"], strict=True) == "ru"
    # Nothing expected that Whisper knows: as without strict.
    assert asr.pick_language(probs, [], strict=True) == "uk"
    assert asr.pick_language(probs, ["xx"], strict=True) == "uk"


def test_clean_vocabulary_drops_bad_entries_and_takes_bare_words():
    raw = [
        "Altype",
        {"word": "  Paximizer ", "heard": ["paxi mizer", "  too   many words here ", 5, "paxi   mizer", ""]},
        {"word": "altype", "heard": ["dup"]},  # the same word again
        {"word": "two\nlines"},
        {"word": "x" * 49},
        {"word": ""},
        {"heard": ["no word"]},
        42,
        {"word": "Льоша", "heard": "not a list"},
        {"word": "Many", "heard": [f"m{i}" for i in range(12)]},
    ]
    assert settings_module.clean_vocabulary(raw) == [
        {"word": "Altype", "heard": []},
        {"word": "Paximizer", "heard": ["paxi mizer"]},
        {"word": "Льоша", "heard": []},
        {"word": "Many", "heard": [f"m{i}" for i in range(8)]},
    ]
    assert settings_module.clean_vocabulary("Altype") == []
    assert len(settings_module.clean_vocabulary([f"w{i}" for i in range(300)])) == 200


def test_settings_keep_a_clean_vocabulary(s):
    s.update({"vocabulary": ["Altype", {"word": "Lisa", "heard": ["Liza"]}, {"bad": 1}]})
    assert s["vocabulary"] == [{"word": "Altype", "heard": []}, {"word": "Lisa", "heard": ["Liza"]}]
    s.update({"vocabulary": "not a list"})
    assert s["vocabulary"] == [{"word": "Altype", "heard": []}, {"word": "Lisa", "heard": ["Liza"]}]


def test_old_hotwords_move_into_the_vocabulary_once(tmp_path):
    import json

    file = tmp_path / "speech.json"
    file.write_text(json.dumps({"hotwords": "Altype, Visual Studio;Paximizer\nAltype"}), "utf-8")
    s = Settings(file)
    assert [e["word"] for e in s["vocabulary"]] == ["Altype", "Visual Studio", "Paximizer"]
    assert s["hotwords"] == ""
    # Saved: a second start finds the vocabulary, not the hotwords.
    assert json.loads(file.read_text("utf-8"))["hotwords"] == ""
    # A vocabulary already there is never overwritten by hotwords.
    file.write_text(json.dumps({"hotwords": "Other", "vocabulary": ["Mine"]}), "utf-8")
    s = Settings(file)
    assert s["vocabulary"] == [{"word": "Mine", "heard": []}] and s["hotwords"] == "Other"


def test_bench_test_replaces_and_use_nudges(s):
    b = bench.Bench(s)
    name = bench.key("small", "cpu", "int8")
    b.record(name, source="test", phrase=1.0, rtf=0.2)
    assert s["bench"]["runs"][name]["phrase"] == 1.0
    b.phrase("small", "cpu", "int8", seconds=6, took=2.0)
    assert s["bench"]["runs"][name]["phrase"] == pytest.approx(1.25)
    assert s["bench"]["runs"][name]["source"] == "test"
    b.phrase("small", "cpu", "int8", seconds=40, took=9.0)  # too long to stand for a phrase
    assert s["bench"]["runs"][name]["phrase"] == pytest.approx(1.25)
    b.words("small", "cpu", "int8", seconds=30, took=10)  # too short to say much
    assert s["bench"]["runs"][name]["rtf"] == 0.2
    b.speakers("cpu", seconds=600, took=180)
    assert s["bench"]["runs"]["speakers|cpu"]["rtf"] == pytest.approx(0.3)
    b.reset("other computer")
    assert s["bench"] == {"fingerprint": "other computer", "runs": {}}


class FakeTranscriber:
    def __init__(self, workers=1):
        self.loaded_with = None
        self.name = self.device = self.compute = None

    def load(self, name, device="cpu", compute=None, threads=0):
        if device == "cuda" and compute == "boom":
            raise asr.CudaFailed("out of memory")
        self.loaded_with = (name, device, compute, threads)
        self.name, self.device, self.compute = name, device, compute or "int8"

    def unload(self):
        self.loaded_with = None


def make_worker(s, monkeypatch, cuda=True):
    import jobs

    monkeypatch.setattr(jobs, "Transcriber", FakeTranscriber)
    monkeypatch.setattr(asr, "gpu", lambda: cuda)
    return jobs.Worker(s, lambda: None)


def test_worker_follows_the_plan_and_shares_one_model(s, monkeypatch):
    w = make_worker(s, monkeypatch)
    s.update({"plan": {"threads": 6, "cuda": {"dictation": {"model": "large-v3-turbo"}, "transcripts": {"model": "large-v3-turbo"}}, "cpu": {"dictation": {"model": "base"}, "transcripts": {"model": "small"}}}})
    t, entry = w.dictation_model()
    assert t is w.transcriber and t.loaded_with == ("large-v3-turbo", "cuda", None, 6)


def test_worker_without_a_plan_keeps_the_old_rule(s, monkeypatch):
    w = make_worker(s, monkeypatch, cuda=False)
    t, entry = w.dictation_model()
    assert t is w.dictator and entry == {"model": "small"}
    assert w.words_model().loaded_with[0] == "large-v3-turbo"


def test_card_failure_falls_back_to_the_processors_plan(s, monkeypatch):
    w = make_worker(s, monkeypatch)
    s.update({"plan": {"cuda": {"transcripts": {"model": "large-v3", "compute": "float16"}}, "cpu": {"transcripts": {"model": "small"}}}})
    # A plan entry with a compute the card refuses stands for any CUDA failure.
    s._values["plan"]["cuda"]["transcripts"]["compute"] = "boom"
    t = w.words_model()
    assert w.fallback == "out of memory"
    assert t.loaded_with[:2] == ("small", "cpu")
    assert w.entry("dictation")[0] == "cpu"


def test_calibrator_measures_and_records(s, monkeypatch, tmp_path):
    import numpy as np

    class Timed(FakeTranscriber):
        def warm(self):
            pass

        def dictate(self, *args, **kwargs):
            time.sleep(0.01)
            return "text", "en", 0.9

        def transcribe(self, samples, language=None, *args, **kwargs):
            time.sleep(0.02)
            return [], "en"

    monkeypatch.setattr(bench, "recognizer", lambda name: Timed())
    monkeypatch.setattr(bench.audio, "decode", lambda path: np.zeros(16000 * 40, dtype=np.float32))
    b = bench.Bench(s)
    c = bench.Calibrator(b, lambda: True, lambda: None, lambda: 0, lambda: 4)
    assert c.start([{"model": "small", "device": "cpu"}, {"model": "large-v3", "device": "cuda", "compute": "boom"}], ["ru", "en"])
    c._thread.join(5)
    assert c.state == "done" and c.done == 4
    runs = s["bench"]["runs"]
    assert runs["small|cpu|int8"]["phrase"] >= 0.01 and runs["small|cpu|int8"]["source"] == "test"
    assert runs["large-v3|cuda|boom"]["failed"] == "out of memory"
