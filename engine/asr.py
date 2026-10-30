"""The words: faster-whisper, on an NVIDIA card when the gpu part is there, else on the CPU.

A long recording gets times for every word; a dictated phrase just its text, fast.
Which model runs where is Krya's plan (settings.py `plan`); this module loads
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

import phantoms
from audio import RATE
from settings import CATALOG, MODELS_DIR

log = logging.getLogger("krya.asr")

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
_MODELS = {m["name"]: m for m in CATALOG["models"]}
_WHISPER = {name: m for name, m in _MODELS.items() if m["backend"] == "whisper"}
# What a model weighs, to tell how far its first download is.
SIZES = {name: m["bytes"] for name, m in _MODELS.items()}
# Parakeet's files as onnx-asr reads them, int8, its features computed by numpy (no preprocessor model).
PARAKEET_FILES = ("config.json", "vocab.txt", "encoder-model.int8.onnx", "decoder_joint-model.int8.onnx")


def backend(name: str) -> str:
    return _MODELS.get(name, {}).get("backend", "")


def _cache_dir(name: str) -> Path:
    """Where a model's files are: Hugging Face's models--<owner>--<repo> for Whisper, a folder of its own for Parakeet."""
    if backend(name) == "whisper":
        return WHISPER_DIR / ("models--" + _WHISPER[name]["repo"].replace("/", "--"))
    return MODELS_DIR / name


def downloaded(name: str) -> bool:
    if backend(name) == "whisper":
        return any(_cache_dir(name).glob("snapshots/*/model.bin"))
    if backend(name) == "parakeet":
        return all((_cache_dir(name) / f).is_file() for f in PARAKEET_FILES)
    return False


fetching: set[str] = set()


def model_state(name: str) -> dict:
    """ready, missing, or downloading with a share done (the files that arrived over the model's size)."""
    if downloaded(name):
        return {"name": name, "state": "ready"}
    if name in fetching:
        got = sum(f.stat().st_size for f in _cache_dir(name).glob("**/*") if f.is_file()) if name in _MODELS else 0
        return {"name": name, "state": "downloading", "progress": round(min(got / SIZES.get(name, max(got, 1)), 0.99), 3)}
    return {"name": name, "state": "missing"}


def fetch(name: str) -> str:
    """The model's folder, downloaded first when it is not here (once; `fetching` shows it meanwhile)."""
    here = downloaded(name)
    if not here:
        fetching.add(name)
    try:
        if backend(name) == "parakeet":
            if not here:
                from huggingface_hub import snapshot_download

                snapshot_download(_MODELS[name]["repo"], local_dir=str(_cache_dir(name)), allow_patterns=list(PARAKEET_FILES))
            return str(_cache_dir(name))
        from faster_whisper.utils import download_model

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


def pick_language(probs: dict[str, float], expected: tuple[str, ...] | list[str], strict: bool = False) -> str:
    """Whisper's likeliest language, unless it is an unexpected one it is not sure of: then the likelier expected one.

    `strict`: the caller knows only the expected ones are spoken (Ukrainian heard in Russian
    speech is a mistake there, however sure), so the likeliest of them, always."""
    top = max(probs, key=probs.get)
    pool = [c for c in expected if c in probs]
    if strict:
        if pool:
            return max(pool, key=lambda c: probs[c])
        log.warning("strict language asked, but Whisper knows none of %s", list(expected))
    if not pool or top in pool or probs[top] >= SURE_OTHER:
        return top
    return max(pool, key=lambda c: probs[c])


def _said(segments, speech: np.ndarray) -> str:
    """A dictated phrase's text, without the credits and sign-offs Whisper adds from its subtitles (phantoms.py)."""
    segments = list(segments)
    text = " ".join(s.text.strip() for s in segments).strip()
    if not segments:
        return text
    sound = phantoms.Sound(
        len(speech) / RATE,
        max(s.no_speech_prob for s in segments),
        min(s.avg_logprob for s in segments),
    )
    return phantoms.clean(text, sound, dictation=True)


class Transcriber:
    def __init__(self, workers: int = 1):
        self._model = None
        self._key: tuple | None = None
        self._warm: tuple | None = None
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
            self._warm = None
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
            self._warm = None
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
            if progress:
                progress(min(segment.end / total, 1.0))
            words = [
                {"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word}
                for w in (segment.words or [])
                if w.word.strip()
            ]
            kept = phantoms.clean_segment(
                {"start": round(segment.start, 2), "end": round(segment.end, 2), "text": segment.text.strip(), "words": words},
                phantoms.Sound(segment.end - segment.start, segment.no_speech_prob, segment.avg_logprob),
            )
            if kept:
                out.append(kept)
        return out, info.language

    def dictate(
        self,
        samples: np.ndarray,
        language: str | None = None,
        expected: tuple[str, ...] | list[str] = (),
        hotwords: str = "",
        beam: int = 5,
        before: str = "",
        strict: bool = False,
    ) -> tuple[str, str, float]:
        """A short phrase's text, its language and how sure Whisper is of it (0…1): no word times.

        The sound is encoded once: the language is read from the same pass the words
        come from (faster-whisper's own way encodes it twice), among the `expected`
        ones unless Whisper is sure of another (never another with `strict`).
        `before`: the text said just before (a dictation's earlier pieces), so this
        one goes on in its style.
        """
        speech = _speech_only(samples)
        if speech is None:
            return "", language or "", 0.0
        try:
            return self._one_pass(speech, language, expected, hotwords, beam, before, strict)
        except (AttributeError, TypeError, KeyError) as error:  # faster-whisper changed underneath
            log.warning("one-pass dictation failed (%s); using faster-whisper's own way", error)
            return self._two_passes(speech, language, hotwords, beam, expected, strict)

    def _one_pass(self, speech: np.ndarray, language: str | None, expected, hotwords: str, beam: int, before: str = "", strict: bool = False) -> tuple[str, str, float]:
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
                language = pick_language(probs, expected, strict)
                sure = float(probs[language])
            else:
                language = "en"
        # The options as faster-whisper fills them (thresholds, suppressed tokens…), from a call
        # that only prepares: its segments are a generator that is never run.
        prompt = " ".join(p for p in (STYLE.get(language), before[-150:].strip()) if p) or None
        _, info = model.transcribe(
            speech[:RATE],
            language=language,
            beam_size=beam,
            initial_prompt=prompt,
            without_timestamps=True,
            condition_on_previous_text=False,
            vad_filter=False,
            hotwords=hotwords or None,
        )
        tokenizer = Tokenizer(model.hf_tokenizer, model.model.is_multilingual, task="transcribe", language=language)
        segments = model.generate_segments(features, tokenizer, info.transcription_options, False, encoded)
        return _said(segments, speech), language, sure

    def _two_passes(self, speech: np.ndarray, language: str | None, hotwords: str, beam: int, expected=(), strict: bool = False) -> tuple[str, str, float]:
        sure = 1.0
        if language is None:
            try:
                top, sure, every = self._model.detect_language(speech)
                # Every language's chance, so the expected ones are preferred here as in one pass.
                probs = dict(every) if every else {top: sure}
                language = pick_language(probs, expected, strict)
                sure = probs.get(language, sure)
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
        return _said(segments, speech), info.language, float(sure)

    def warm(self) -> None:
        """Runs the loaded model once (once per load: a card's first run sets itself up for seconds;
        again, on the processor, it would only take a second from the phrase being spoken)."""
        if self._warm == self._key:
            return
        noise = (np.random.default_rng(0).standard_normal(RATE) * 0.01).astype(np.float32)
        list(self._model.transcribe(noise, language="en", vad_filter=False, without_timestamps=True)[0])
        self._warm = self._key


class Parakeet:
    """NVIDIA's Parakeet TDT 0.6B v3 through onnx-asr, int8 on the processor: 25 European languages, with
    their punctuation and capitals. It costs what the sound lasts (Whisper pads every phrase to a 30 s
    window), so a phrase takes a third of a second on a desktop processor. It does not say which
    language it heard: the caller finds out from the text."""

    def __init__(self):
        self._model = None
        self._key: tuple | None = None
        self._warm: tuple | None = None
        self._lock = threading.Lock()
        self.name: str | None = None
        self.device = "cpu"
        self.compute = "int8"

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self, name: str, device: str = "cpu", compute: str | None = None, threads: int = 0) -> None:
        with self._lock:
            key = (name, threads)
            if self._model is not None and self._key == key:
                return
            self._model = None
            self._key = None
            self._warm = None
            path = fetch(name)
            import onnx_asr
            import onnxruntime as rt

            options = rt.SessionOptions()
            if threads:
                options.intra_op_num_threads = threads
            self._model = onnx_asr.load_model(_MODELS[name]["onnx"], path, quantization="int8", sess_options=options, providers=["CPUExecutionProvider"])
            self.name = name
            self._key = key

    def unload(self) -> None:
        with self._lock:
            self._model = None
            self._key = None
            self._warm = None
            self.name = None

    def dictate(self, samples: np.ndarray, language: str | None = None, expected=(), hotwords: str = "", beam: int = 0, before: str = "", strict: bool = False) -> tuple[str, str, float]:
        """The phrase's text; its language is unknown here ("", sure 0), so `strict` has nothing to hold."""
        speech = _speech_only(samples)
        if speech is None:
            return "", language or "", 0.0
        return str(self._model.recognize(speech)).strip(), language or "", 0.0

    def warm(self) -> None:
        if self._warm == self._key:
            return
        noise = (np.random.default_rng(0).standard_normal(RATE) * 0.01).astype(np.float32)
        self._model.recognize(noise)
        self._warm = self._key


def recognizer(name: str):
    """A fresh, unloaded recognizer for this model: Whisper's or Parakeet's."""
    return Parakeet() if backend(name) == "parakeet" else Transcriber()
