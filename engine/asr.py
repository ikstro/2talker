"""The words: faster-whisper, on an NVIDIA card when the gpu part is there, else on the CPU.

A long recording gets times for every word; a dictated phrase just its text, fast.
Which model runs where is Altype's plan (settings.py `plan`); this module loads
what it is told and says when the card cannot take it (`CudaFailed`).
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
from settings import CATALOG, MODELS_DIR

log = logging.getLogger("altype.asr")

# Whisper writes in the style of the text before it; without one it sometimes
# drops capitals and full stops for a whole recording.
STYLE = {
    "ru": "Здравствуйте. Давайте начнём, у нас сегодня несколько вопросов.",
    "uk": "Добрий день. Давайте почнемо, у нас сьогодні кілька питань.",
    "en": "Hello, everyone. Let's get started, we have a few things to discuss today.",
}

# A language Whisper hears that is neither of the ones expected (the person's own,
# English) is taken only when it is this sure; else the likelier expected one.
SURE_OTHER = 0.7


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


def torch_cuda() -> bool:
    """torch's CUDA build is installed (the speakers-gpu part): speakers run on the card."""
    torch = importlib.util.find_spec("torch")
    return bool(torch and torch.origin and (Path(torch.origin).parent / "lib" / "cudnn64_9.dll").exists())


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
_WHISPER = {m["name"]: m for m in CATALOG["models"] if m["backend"] == "whisper"}
# What a model weighs, to tell how far its first download is.
SIZES = {name: m["bytes"] for name, m in _WHISPER.items()}


def _cache_dir(name: str) -> Path:
    """Hugging Face's folder for a model: models--<owner>--<repo>."""
    return WHISPER_DIR / ("models--" + _WHISPER[name]["repo"].replace("/", "--"))


def downloaded(name: str) -> bool:
    return name in _WHISPER and any(_cache_dir(name).glob("snapshots/*/model.bin"))


fetching: set[str] = set()


def model_state(name: str) -> dict:
    """ready, missing, or downloading with a share done (the files that arrived over the model's size)."""
    if downloaded(name):
        return {"name": name, "state": "ready"}
    if name in fetching:
        got = sum(f.stat().st_size for f in _cache_dir(name).glob("**/*") if f.is_file()) if name in _WHISPER else 0
        return {"name": name, "state": "downloading", "progress": round(min(got / SIZES.get(name, max(got, 1)), 0.99), 3)}
    return {"name": name, "state": "missing"}


def fetch(name: str) -> str:
    """The model's folder, downloaded first when it is not here (once; `fetching` shows it meanwhile)."""
    from faster_whisper.utils import download_model

    here = downloaded(name)
    if not here:
        fetching.add(name)
    try:
        return download_model(name, cache_dir=str(WHISPER_DIR), local_files_only=here)
    finally:
        fetching.discard(name)


class CudaFailed(Exception):
    """The card would not take the model (too small, busy, a driver too old): the processor's plan applies."""


def _speech_only(samples: np.ndarray) -> np.ndarray | None:
    """The phrase with its silences cut out (Silero VAD, inside faster-whisper); None when nobody spoke."""
    from faster_whisper.vad import VadOptions, collect_chunks, get_speech_timestamps

    chunks = get_speech_timestamps(samples, VadOptions(min_silence_duration_ms=500, speech_pad_ms=300))
    if not chunks:
        return None
    pieces, _ = collect_chunks(samples, chunks)
    speech = np.concatenate(pieces) if pieces else np.array([], dtype=np.float32)
    return speech if len(speech) >= RATE // 4 else None


def pick_language(probs: dict[str, float], expected: tuple[str, ...] | list[str]) -> str:
    """Whisper's likeliest language, unless it is an unexpected one it is not sure of: then the likelier expected one."""
    top = max(probs, key=probs.get)
    pool = [c for c in expected if c in probs]
    if not pool or top in pool or probs[top] >= SURE_OTHER:
        return top
    return max(pool, key=lambda c: probs[c])


class Transcriber:
    def __init__(self, workers: int = 1):
        self._model = None
        self._key: tuple | None = None
        self._lock = threading.Lock()
        self.workers = workers
        self.name: str | None = None
        self.device: str | None = None
        self.compute: str | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self, name: str, device: str = "cpu", compute: str | None = None, threads: int = 0) -> None:
        """The model on that device: on the card in `compute` (float16 first, then int8_float16), raising
        CudaFailed when neither fits; on the processor in int8 with `threads` threads (0: CTranslate2's 4)."""
        with self._lock:
            key = (name, device, compute, threads)
            if self._model is not None and self._key == key:
                return
            self._model = None
            self._key = None
            path = fetch(name)
            from faster_whisper import WhisperModel

            if device == "cuda":
                _cuda_dlls()
                first = compute or "float16"
                tries = [first, "int8_float16"] if first == "float16" else [first]
                problem: Exception | None = None
                for kind in tries:
                    try:
                        self._model = WhisperModel(path, device="cuda", compute_type=kind, num_workers=self.workers)
                        self.compute = kind
                        break
                    except Exception as error:  # out of memory, a driver too old, no card after all
                        problem = error
                        log.warning("%s in %s on the GPU failed: %s", name, kind, error)
                if self._model is None:
                    raise CudaFailed(str(problem) or type(problem).__name__)
            else:
                self._model = WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=threads, num_workers=self.workers)
                self.compute = "int8"
            self.name = name
            self.device = device
            self._key = key

    def unload(self) -> None:
        with self._lock:
            self._model = None
            self._key = None
            self.name = None

    def transcribe(
        self,
        samples: np.ndarray,
        language: str | None = None,
        hotwords: str = "",
        progress: Callable[[float], None] | None = None,
    ) -> tuple[list[dict], str]:
        """Segments as {start, end, text, words: [{start, end, word}]} and the language spoken (the model loaded first)."""
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

    def dictate(
        self,
        samples: np.ndarray,
        language: str | None = None,
        expected: tuple[str, ...] | list[str] = (),
        hotwords: str = "",
        beam: int = 5,
    ) -> tuple[str, str, float]:
        """A short phrase's text, its language and how sure Whisper is of it (0…1): no word times, no carrying over.

        The sound is encoded once: the language is read from the same pass the words
        come from (faster-whisper's own way encodes it twice), among the `expected`
        ones unless Whisper is sure of another.
        """
        speech = _speech_only(samples)
        if speech is None:
            return "", language or "", 0.0
        try:
            return self._one_pass(speech, language, expected, hotwords, beam)
        except (AttributeError, TypeError, KeyError) as error:  # faster-whisper changed underneath
            log.warning("one-pass dictation failed (%s); using faster-whisper's own way", error)
            return self._two_passes(speech, language, hotwords, beam)

    def _one_pass(self, speech: np.ndarray, language: str | None, expected, hotwords: str, beam: int) -> tuple[str, str, float]:
        from faster_whisper.audio import pad_or_trim
        from faster_whisper.tokenizer import Tokenizer

        model = self._model
        extractor = model.feature_extractor
        features = extractor(speech)
        encoded = model.encode(pad_or_trim(features[:, : extractor.nb_max_frames]))
        sure = 1.0
        if language is None:
            if model.model.is_multilingual:
                probs = {token[2:-2]: p for token, p in model.model.detect_language(encoded)[0]}
                language = pick_language(probs, expected)
                sure = float(probs[language])
            else:
                language = "en"
        # The options as faster-whisper fills them (thresholds, suppressed tokens…), from a call
        # that only prepares: its segments are a generator that is never run.
        _, info = model.transcribe(
            speech[:RATE],
            language=language,
            beam_size=beam,
            initial_prompt=STYLE.get(language),
            without_timestamps=True,
            condition_on_previous_text=False,
            vad_filter=False,
            hotwords=hotwords or None,
        )
        tokenizer = Tokenizer(model.hf_tokenizer, model.model.is_multilingual, task="transcribe", language=language)
        segments = model.generate_segments(features, tokenizer, info.transcription_options, False, encoded)
        return " ".join(s.text.strip() for s in segments).strip(), language, sure

    def _two_passes(self, speech: np.ndarray, language: str | None, hotwords: str, beam: int) -> tuple[str, str, float]:
        sure = 1.0
        if language is None:
            try:
                language, sure, _ = self._model.detect_language(speech)
            except Exception:
                language = None
        segments, info = self._model.transcribe(
            speech,
            language=language,
            initial_prompt=STYLE.get(language) if language else None,
            beam_size=beam,
            vad_filter=False,
            condition_on_previous_text=False,
            hotwords=hotwords or None,
        )
        return " ".join(s.text.strip() for s in segments).strip(), info.language, float(sure)

    def warm(self) -> None:
        """Runs the loaded model once: a card's first run sets itself up for seconds."""
        noise = (np.random.default_rng(0).standard_normal(RATE) * 0.01).astype(np.float32)
        list(self._model.transcribe(noise, language="en", vad_filter=False, without_timestamps=True)[0])
