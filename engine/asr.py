"""The words: faster-whisper, on an NVIDIA card when the gpu part is there, else on the CPU.

A long recording gets times for every word; a dictated phrase just its text, fast.
"""

from __future__ import annotations

import importlib.util
import logging
import os
import sys
import threading
from pathlib import Path
from typing import Callable

import numpy as np

from audio import RATE
from settings import MODELS_DIR

log = logging.getLogger("altype.asr")

# Whisper writes in the style of the text before it; without one it sometimes
# drops capitals and full stops for a whole recording.
STYLE = {
    "ru": "Здравствуйте. Давайте начнём, у нас сегодня несколько вопросов.",
    "en": "Hello, everyone. Let's get started, we have a few things to discuss today.",
}


def _cuda_dirs() -> list[Path]:
    """Where cuBLAS 12 and cuDNN 9 are: the gpu part's nvidia wheels, or torch's CUDA build (speakers-gpu)."""
    site = Path(sys.prefix) / "Lib" / "site-packages"
    dirs = [d for d in (site / "nvidia").glob("*/bin") if d.is_dir()]
    torch = importlib.util.find_spec("torch")
    if torch and torch.origin:
        lib = Path(torch.origin).parent / "lib"
        if (lib / "cudnn64_9.dll").exists():
            dirs.append(lib)
    return dirs


_dlls_added = False


def _cuda_dlls() -> None:
    global _dlls_added
    if _dlls_added:
        return
    for d in _cuda_dirs():
        os.add_dll_directory(str(d))
        os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")
    _dlls_added = True


def gpu() -> bool:
    """An NVIDIA card and the CUDA libraries to use it (the gpu or speakers-gpu part)."""
    if not _cuda_dirs():
        return False
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


WHISPER_DIR = MODELS_DIR / "whisper"


def downloaded(name: str) -> bool:
    return any(WHISPER_DIR.glob(f"models--*--faster-whisper-{name}/snapshots/*/model.bin"))


# What a model weighs, to tell how far its first download is.
SIZES = {"large-v3-turbo": 1_620_000_000, "large-v3": 3_090_000_000, "small": 484_000_000}
fetching: set[str] = set()


def model_state(name: str) -> dict:
    """ready, missing, or downloading with a share done (the files that arrived over the model's size)."""
    if downloaded(name):
        return {"name": name, "state": "ready"}
    if name in fetching:
        got = sum(f.stat().st_size for f in WHISPER_DIR.glob(f"models--*--faster-whisper-{name}/**/*") if f.is_file())
        return {"name": name, "state": "downloading", "progress": round(min(got / SIZES.get(name, max(got, 1)), 0.99), 3)}
    return {"name": name, "state": "missing"}


class Transcriber:
    def __init__(self):
        self._model = None
        self._name = None
        self._lock = threading.Lock()
        self.device = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self, name: str) -> None:
        with self._lock:
            if self._model is not None and self._name == name:
                return
            self._model = None
            _cuda_dlls()
            from faster_whisper import WhisperModel

            # A model already here is loaded without asking Hugging Face whether it changed.
            # Two workers: a dictated phrase need not wait for a long recording's window.
            where = {"download_root": str(WHISPER_DIR), "local_files_only": downloaded(name), "num_workers": 2}
            if not downloaded(name):
                fetching.add(name)
            try:
                self._load(WhisperModel, name, where)
            finally:
                fetching.discard(name)
            self._name = name

    def _load(self, WhisperModel, name: str, where: dict) -> None:
        if gpu():
            try:
                self._model = WhisperModel(name, device="cuda", compute_type="float16", **where)
                self.device = "cuda"
            except Exception as error:  # the card is busy or too small: slower, but it still works
                log.warning("Whisper on the GPU failed (%s); using the CPU", error)
        if self._model is None:
            self._model = WhisperModel(name, device="cpu", compute_type="int8", **where)
            self.device = "cpu"

    def unload(self) -> None:
        with self._lock:
            self._model = None
            self._name = None

    def transcribe(
        self,
        samples: np.ndarray,
        model: str,
        language: str | None = None,
        hotwords: str = "",
        progress: Callable[[float], None] | None = None,
    ) -> tuple[list[dict], str]:
        """Segments as {start, end, text, words: [{start, end, word}]} and the language spoken."""
        self.load(model)
        total = max(len(samples) / RATE, 0.01)
        if language is None:
            try:
                language = self._model.detect_language(samples, vad_filter=True)[0]
            except Exception:  # nothing but silence: Whisper finds no speech either way
                language = None
        segments, info = self._model.transcribe(
            samples,
            language=language,
            initial_prompt=STYLE.get(language),
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 700},
            # The previous text keeps punctuation going from window to window; the VAD and the
            # silence threshold keep it from looping on long recordings.
            condition_on_previous_text=True,
            hallucination_silence_threshold=2.0,
            hotwords=hotwords or None,
        )
        out = []
        for segment in segments:
            words = [
                {"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word}
                for w in (segment.words or [])
                if w.word.strip()
            ]
            out.append({
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": segment.text.strip(),
                "words": words,
            })
            if progress:
                progress(min(segment.end / total, 1.0))
        return out, info.language

    def dictate(self, samples: np.ndarray, model: str, language: str | None = None, hotwords: str = "") -> tuple[str, str]:
        """A short phrase's text and language: no word times, no carrying over, just quick."""
        self.load(model)
        if language is None:
            # Found first, so the phrase gets that language's capitals and full stops (STYLE).
            try:
                language = self._model.detect_language(samples)[0]
            except Exception:
                language = None
        segments, info = self._model.transcribe(
            samples,
            language=language,
            initial_prompt=STYLE.get(language) if language else None,
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
            hotwords=hotwords or None,
        )
        return " ".join(s.text.strip() for s in segments).strip(), info.language

    def warm(self, model: str) -> None:
        """Loads the model and runs it once: a card's first run sets itself up for seconds."""
        self.load(model)
        noise = (np.random.default_rng(0).standard_normal(RATE) * 0.01).astype(np.float32)
        list(self._model.transcribe(noise, language="en", vad_filter=False, without_timestamps=True)[0])
