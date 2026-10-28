"""A dictation heard while it is spoken, on made-up sound: tones for speech, zeros for pauses, a VAD that hears the tones."""

import threading
import time

import numpy as np
import pytest

import stream
from audio import RATE


def fake_speech(samples):
    """Speech wherever the sound is loud; pauses shorter than stream.PAUSE stay inside."""
    loud = np.abs(samples) > 0.05
    spans, start, quiet = [], None, 0
    for i in range(0, len(samples), 160):
        on = bool(loud[i : i + 160].any())
        if on:
            if start is None:
                start = i
            quiet = 0
            end = i + 160
        elif start is not None:
            quiet += 160
            if quiet >= stream.PAUSE * RATE:
                spans.append((start, end))
                start = None
    if start is not None:
        spans.append((start, end))
    return spans


def tone(seconds):
    t = np.arange(int(seconds * RATE)) / RATE
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(seconds):
    return np.zeros(int(seconds * RATE), dtype=np.float32)


class Recognizer:
    """Says how long each piece was; remembers what it was given."""

    def __init__(self, language="ru", delay=0.0, fail=False):
        self.calls = []
        self.language = language
        self.delay = delay
        self.fail = fail
        self.lock = threading.Lock()

    def __call__(self, sound, language, expected, before):
        if self.fail:
            raise ValueError("broken model")
        time.sleep(self.delay)
        with self.lock:
            self.calls.append({"seconds": round(len(sound) / RATE, 1), "language": language, "before": before})
        return f"[{len(self.calls)}]", self.language, 0.9


def send(session, sound, chunk=4000, pace=0.0):
    """The sound in chunks; `pace`: seconds between them (the badge sends one every quarter of a second)."""
    pcm = (np.clip(sound, -1, 1) * 32767).astype("<i2").tobytes()
    step = chunk * 2
    for seq, at in enumerate(range(0, len(pcm), step)):
        session.add(seq, pcm[at : at + step])
        if pace:
            time.sleep(pace)
    return seq + 1


def wait(condition, seconds=5.0):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if condition():
            return True
        time.sleep(0.02)
    return False


def make(recognizer, kind=("whisper", "cpu"), language=None):
    return stream.Session(recognizer, kind, ["ru", "en"], language, speech=fake_speech)


def test_pieces_are_recognized_while_speaking_and_the_tail_at_the_end():
    r = Recognizer()
    s = make(r)
    send(s, np.concatenate([tone(5), silence(1.0), tone(3)]))
    # The first piece (5 s, then a pause) is recognized before the key is let go.
    assert wait(lambda: len(r.calls) >= 1)
    out = s.finish(b"")
    assert out["text"] == "[1] [2]"
    assert out["language"] == "ru" and out["sure"] == 0.9
    assert [c["seconds"] for c in r.calls][0] == pytest.approx(5.2, abs=0.2)
    # The language of the first piece is kept, and the second is told the text before it.
    assert r.calls[1]["language"] == "ru" and r.calls[1]["before"] == "[1]"


def test_a_tail_recognized_in_the_pause_is_not_recognized_again():
    r = Recognizer()
    s = make(r)
    send(s, np.concatenate([tone(2.5), silence(0.8)]))
    assert wait(lambda: len(r.calls) == 1)
    time.sleep(0.1)
    out = s.finish(b"")
    assert out["text"] == "[1]"
    assert len(r.calls) == 1


def test_speech_after_the_guess_is_recognized_with_it():
    r = Recognizer()
    s = make(r)
    n = send(s, np.concatenate([tone(2), silence(0.4)]))
    assert wait(lambda: len(r.calls) == 1)
    pcm = (tone(1.5) * 32767).astype("<i2").tobytes()
    s.add(n, pcm)
    out = s.finish(b"")
    assert out["text"] == "[2]"
    assert r.calls[-1]["seconds"] == pytest.approx(3.9, abs=0.3)


def test_nobody_pauses_so_the_longest_piece_is_cut_where_it_is_quietest():
    r = Recognizer(delay=0.01)
    s = make(r)
    loud = np.concatenate([tone(23), (tone(0.3) * 0.1), tone(6)])
    send(s, loud)
    assert wait(lambda: len(r.calls) >= 1)
    out = s.finish(b"")
    assert out["text"] == "[1] [2]"
    assert 21 <= r.calls[0]["seconds"] <= 25


def test_parakeet_takes_short_pieces():
    r = Recognizer(language="")
    s = make(r, kind=("parakeet", "cpu"))
    # As it comes (ten times real time): each pause after 1.5 s of speech ends a piece.
    send(s, np.concatenate([tone(2), silence(0.8), tone(2), silence(0.8), tone(1)]), pace=0.025)
    out = s.finish(b"")
    # Three pieces in the text (previews, shown meanwhile, are not in it), none longer than its speech and pause.
    assert len(out["text"].split()) == 3
    assert max(c["seconds"] for c in r.calls) < 3
    # Parakeet does not say the language: Altype finds it from the text.
    assert out["language"] == "" and out["sure"] == 0


def test_talking_without_pauses_still_shows_the_words_where_it_is_cheap():
    r = Recognizer(language="")
    s = make(r, kind=("parakeet", "cpu"))
    send(s, tone(7), pace=0.025)
    assert wait(lambda: s.status()["heard"] != "")
    # A preview is only shown: the whole stretch is recognized at the end.
    out = s.finish(b"")
    assert r.calls[-1]["seconds"] == pytest.approx(7.0, abs=0.3)
    assert out["text"] == f"[{len(r.calls)}]"
    slow = Recognizer()
    w = make(slow, kind=("whisper", "cpu"))
    send(w, tone(7), pace=0.01)
    time.sleep(0.3)
    assert slow.calls == []


def test_a_chunk_sent_twice_counts_once_and_silence_is_dropped():
    r = Recognizer()
    s = make(r)
    pcm = (silence(3) * 32767).astype("<i2").tobytes()
    s.add(0, pcm)
    s.add(0, pcm)
    assert s.status()["seconds"] == 3.0
    out = s.finish(b"")
    assert out["text"] == "" and r.calls == []


def test_cancel_and_failure():
    r = Recognizer(delay=0.2)
    s = make(r)
    send(s, np.concatenate([tone(5), silence(1)]))
    s.cancel()
    assert wait(lambda: s.over)
    broken = make(Recognizer(fail=True))
    send(broken, np.concatenate([tone(2), silence(1)]))
    with pytest.raises(RuntimeError, match="broken model"):
        broken.finish(b"")


def test_sessions_one_at_a_time():
    sessions = stream.Sessions()
    a = sessions.open(make(Recognizer()))
    b = sessions.open(make(Recognizer()))
    assert a.state == "cancelled" and sessions.get(b.id) is b and sessions.get(a.id) is None
    assert sessions.active()
    sessions.drop(b.id)
    assert not sessions.active()
