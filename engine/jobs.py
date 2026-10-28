"""One worker on the GPU: a queue of transcripts to make, one at a time.

A job is kept in its row (`job`), so a queue cut short by a restart picks up
where it was. A recording whose chunks stopped coming (the browser closed
mid-meeting) is finished with what arrived.

Besides new transcripts (`task` absent), a finished one can be worked on again:
"speakers" splits it by speaker from its saved sound and words, "redo"
recognizes its saved sound anew (for transcripts made before words were kept).
"""

from __future__ import annotations

import gc
import logging
import os
import queue
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

import asr
import audio
import merge
import notes
import vocab
from asr import CudaFailed, Parakeet, Transcriber
from bench import Bench
from diarize import Diarizer, NeedsPart, NeedsToken
from settings import CPU_DICTATION, Settings
from store import Store

log = logging.getLogger("altype.jobs")

IDLE_UNLOAD = 600     # seconds without work before the models leave the GPU
# Seconds without a phrase before dictation's model is let go: longer when there is memory to spare.
DICTATION_IDLE = {"roomy": 1800, "tight": 600}
YIELD_LONGEST = 60    # seconds a transcription on the processor waits at most for a dictation to finish
STALE = 180           # seconds without a chunk before a recording counts as cut off
# Each stage's share of the bar, by the time it takes on an hour of audio
# (src/webview/app.ts keeps the same numbers to say how far a stage is).
WEIGHTS = {"decode": (0.0, 0.1), "words": (0.1, 0.6), "speakers": (0.6, 0.95), "save": (0.95, 1.0)}
# A finished transcript worked on again: when that fails, the old one stays.
AGAIN = ("speakers", "redo")


def ram_gb() -> float:
    """This computer's memory, in GB (Windows' GlobalMemoryStatusEx); 8 when it cannot be read."""
    try:
        import ctypes

        class Status(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong), ("free", ctypes.c_ulonglong),
                        ("pageTotal", ctypes.c_ulonglong), ("pageFree", ctypes.c_ulonglong), ("virtualTotal", ctypes.c_ulonglong),
                        ("virtualFree", ctypes.c_ulonglong), ("extended", ctypes.c_ulonglong)]

        status = Status()
        status.length = ctypes.sizeof(Status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return status.total / 2**30
    except (AttributeError, OSError):
        pass
    return 8.0


def finish_recording(store: Store, id: str, options: dict | None = None, interrupted: bool = False) -> bool:
    """Joins a recording's chunks per track and queues it. False when nothing arrived."""
    row = store.row(id)
    if row is None or row["status"] != "recording":
        return False
    job = row["job"]
    incoming = store.folder(id) / "incoming"
    starts = {track: info.get("startedAt", 0) for track, info in job.get("tracks", {}).items()}
    first = min(starts.values(), default=0)
    inputs = []
    for track in starts:
        parts = sorted(incoming.glob(f"{track}-*.part"))
        if not parts:
            continue
        joined = incoming / f"{track}.webm"
        with joined.open("wb") as out:
            for part in parts:
                with part.open("rb") as src:
                    shutil.copyfileobj(src, out)
                part.unlink()
        inputs.append({"path": str(joined), "track": track, "offset": (starts[track] - first) / 1000, "temp": True})
    if not inputs:
        store.delete(id)
        return False
    job["inputs"] = inputs
    job.update({k: v for k, v in (options or {}).items() if k in ("language", "speakers")})
    store.update(id, status="queued", job=job, stage="", progress=0, error="The recording was cut off; what arrived is transcribed" if interrupted else "")
    return True


class Worker:
    def __init__(self, settings: Settings, get_store: Callable[[], Store]):
        self.settings = settings
        self.get_store = get_store
        # Two workers: a dictated phrase need not wait for a long recording's window when both use one model.
        self.transcriber = Transcriber(workers=2)
        # Dictation's own model, when the plan gives it another one than transcripts (on the CPU, a quicker one).
        self.dictator = Transcriber()
        # Parakeet, when the plan has it dictate (the processor, a European language).
        self.parakeet = Parakeet()
        self.last_dictation = time.monotonic()
        # A dictation is being recognized now (app.py's sessions): a transcription on the processor waits for it.
        self.dictating: Callable[[], bool] = lambda: False
        self.diarizer = Diarizer()
        self.bench = Bench(settings)
        self.queue: queue.Queue[str] = queue.Queue()
        self.current: str | None = None
        self.last_work = time.monotonic()
        # Why the card is not used though it is there (it would not take a model); the processor's plan applies until a restart.
        self.fallback: str | None = None
        # Grows with every phrase and job started: the speed test sees it was disturbed.
        self.activity = 0
        self._thread = threading.Thread(target=self._run, name="altype-worker", daemon=True)

    def start(self) -> None:
        store = self.get_store()
        for row in store.rows(("queued", "working")):
            self.submit(row["id"])
        self._thread.start()

    def submit(self, id: str) -> None:
        self.queue.put(id)

    @property
    def device(self) -> str | None:
        return self.transcriber.device or self.dictator.device

    # ------------------------------------------------------------ the plan

    def use_cuda(self) -> bool:
        return not self.fallback and asr.gpu()

    def threads(self) -> int:
        """The processor's threads for one model: the plan's (the physical cores), else half the logical ones."""
        return int(self.settings["plan"].get("threads") or max(1, (os.cpu_count() or 2) // 2))

    def entry(self, feature: str, device: str | None = None) -> tuple[str, dict]:
        """The device and {model, compute?, beam?} for dictation or transcripts: Altype's plan, else the rule before plans."""
        device = device or ("cuda" if self.use_cuda() else "cpu")
        planned = self.settings["plan"].get(device, {}).get(feature)
        if planned:
            return device, planned
        model = self.settings["model"]
        if feature == "dictation" and device == "cpu":
            model = CPU_DICTATION
        return device, {"model": model}

    def _load(self, t: Transcriber, feature: str) -> tuple[str, dict]:
        device, entry = self.entry(feature)
        try:
            t.load(entry["model"], device, entry.get("compute"), self.threads())
        except CudaFailed as error:
            self.fallback = str(error)
            log.warning("the card would not take %s; the processor's plan from now on", entry["model"])
            device, entry = self.entry(feature, "cpu")
            t.load(entry["model"], device, None, self.threads())
        return device, entry

    def words_model(self) -> Transcriber:
        self._load(self.transcriber, "transcripts")
        return self.transcriber

    def dictation_model(self) -> tuple[Transcriber | Parakeet, dict]:
        """Dictation's model, loaded: the transcripts' own when the plan gives both the same (one copy in memory)."""
        self.last_dictation = time.monotonic()
        device, entry = self.entry("dictation")
        if asr.backend(entry["model"]) == "parakeet":
            self.parakeet.load(entry["model"], "cpu", None, self.threads())
            return self.parakeet, entry
        _, words = self.entry("transcripts", device)
        same = words["model"] == entry["model"] and words.get("compute") == entry.get("compute")
        t = self.transcriber if same else self.dictator
        _, entry = self._load(t, "dictation")
        return t, entry

    def unload_all(self) -> None:
        self.transcriber.unload()
        self.dictator.unload()
        self.parakeet.unload()
        self.diarizer.unload()
        gc.collect()
        try:
            import torch

            torch.cuda.empty_cache()
        except Exception:
            pass

    def idle(self) -> bool:
        return self.current is None and self.queue.empty()

    def yield_to_dictation(self) -> None:
        """A transcription on the processor stops between its windows while someone dictates: the phrase comes first."""
        until = time.monotonic() + YIELD_LONGEST
        while self.dictating() and time.monotonic() < until:
            time.sleep(0.05)

    def _run(self) -> None:
        while True:
            try:
                id = self.queue.get(timeout=30)
            except queue.Empty:
                self._housekeeping()
                continue
            self.current = id
            self.activity += 1
            try:
                self._process(id)
            except Exception as error:
                log.exception("job %s failed", id)
                self._failed(id, str(error) or type(error).__name__)
            finally:
                self.current = None
                self.last_work = time.monotonic()

    def _failed(self, id: str, message: str) -> None:
        store = self.get_store()
        row = store.row(id)
        task = row["job"].get("task") if row else None
        if task in AGAIN and store.transcript(id):
            what = "split by speaker" if task == "speakers" else "transcribe again"
            store.update(id, status="done", stage="", progress=1.0, error=f"Could not {what}: {message}", job={"kind": row["job"].get("kind")})
        else:
            store.update(id, status="failed", stage="", error=message)

    def _housekeeping(self) -> None:
        store = self.get_store()
        now = datetime.now()
        for row in store.rows(("recording",)):
            touched = datetime.fromisoformat(row["touched"] or row["created"])
            if (now - touched).total_seconds() > STALE and finish_recording(store, row["id"], interrupted=True):
                self.submit(row["id"])
        now = time.monotonic()
        keep = DICTATION_IDLE["roomy" if ram_gb() >= 12 else "tight"]
        dictating = now - self.last_dictation < keep
        if now - self.last_work > IDLE_UNLOAD:
            # The transcripts' model goes, unless dictation shares it and is still in use.
            shared = self.transcriber.loaded and self.transcriber.name == self.entry("dictation")[1]["model"]
            if self.diarizer.loaded:
                self.diarizer.unload()
            if self.transcriber.loaded and not (shared and dictating):
                self.transcriber.unload()
            if not dictating and (self.dictator.loaded or self.parakeet.loaded):
                self.dictator.unload()
                self.parakeet.unload()
                log.info("dictation's model unloaded after %d s without a phrase", keep)
            gc.collect()

    def _process(self, id: str) -> None:
        row = self.get_store().row(id)
        if row is None or row["status"] not in ("queued", "working"):
            return
        if row["job"].get("task") == "speakers":
            self._resplit(id, row)
        else:
            self._transcribe(id, row)

    def _progress(self, id: str) -> Callable[..., None]:
        store = self.get_store()

        def progress(stage: str, part: float = 0.0) -> None:
            a, b = WEIGHTS[stage]
            store.update(id, status="working", stage=stage, progress=round(a + (b - a) * part, 3))

        return progress

    def _speakers(self, id: str, samples, wanted: int | None, progress) -> tuple[list | None, str]:
        """Speaker turns and how it went: ok, no-part, needs-token or failed (the text is kept either way)."""
        progress("speakers")
        try:
            token = self.settings["hfToken"]
            self.diarizer.load(token)
            started = time.perf_counter()
            turns = self.diarizer.diarize(samples, token, wanted, lambda p: progress("speakers", p))
            self.bench.speakers(self.diarizer.device, audio.duration(samples), time.perf_counter() - started)
            return turns, "ok"
        except NeedsPart:
            return None, "no-part"
        except NeedsToken:
            return None, "needs-token"
        except Exception:
            log.exception("speakers failed for %s", id)
            return None, "failed"

    def _transcribe(self, id: str, row: dict) -> None:
        store = self.get_store()
        job = row["job"]
        kind = job.get("kind", row["source"])
        settings = self.settings.get()
        progress = self._progress(id)

        progress("decode")
        inputs = job.get("inputs", [])
        tracks = {}
        for n, item in enumerate(inputs):
            share = lambda p, n=n: progress("decode", (n + p) / len(inputs))
            tracks[item["track"]] = (audio.decode(item["path"], share), item.get("offset", 0.0))
        mixed = audio.mix(list(tracks.values()))
        duration = audio.duration(mixed)
        if duration < 0.5:
            raise ValueError("The recording is empty")
        # The window can say how far into the recording the words are.
        store.update(id, duration=round(duration, 2))

        language = job.get("language") or settings["language"]
        language = None if language == "auto" else language
        hotwords = vocab.hotwords(settings["vocabulary"], settings["hotwords"])
        speakers_status = "single"

        def words(samples, share=(0.0, 1.0)):
            a, b = share
            t = self.words_model()

            def step(p):
                progress("words", a + (b - a) * p)
                if t.device == "cpu":
                    self.yield_to_dictation()

            started = time.perf_counter()
            segments, spoken = t.transcribe(samples, language, hotwords, step)
            self.bench.words(t.name, t.device, t.compute, audio.duration(samples), time.perf_counter() - started)
            # Spelled as the vocabulary says before the words are numbered and kept (merge.py), so the
            # kept words, the utterances and a later split by speaker all read the same; in a meeting
            # both tracks are corrected alike, so the echo of a name is still found on the microphone.
            return vocab.correct_segments(segments, settings["vocabulary"]), spoken

        # Loading the model, finding the language and cutting the silence come before the first words.
        progress("words")
        if kind == "meet" and "mic" in tracks and "tab" in tracks:
            mine = audio.pad(*tracks["mic"])
            theirs = audio.pad(*tracks["tab"])
            share = len(mine) / max(len(mine) + len(theirs), 1)
            my_segments, my_language = words(mine, (0.0, share))
            their_segments, their_language = words(theirs, (share, 1.0))
            spoken = their_language if their_segments else my_language
            turns, speakers_status = self._speakers(id, theirs, job.get("speakers"), progress)
            utterances, kept = merge.meeting(my_segments, their_segments, turns)
        else:
            segments, spoken = words(mixed)
            turns = None
            if kind != "note":
                turns, speakers_status = self._speakers(id, mixed, job.get("speakers"), progress)
            utterances, kept = merge.single(segments, turns)
            if kind == "note":
                for u in utterances:
                    u["speaker"] = merge.ME

        progress("save")
        if not job.get("keepAudio"):
            audio.save_opus(mixed, store.folder(id) / "audio.ogg", progress=lambda p: progress("save", p * 0.9))
        transcript = {
            "id": id,
            "title": row["title"],
            "source": row["source"],
            "created": row["created"],
            "duration": round(duration, 2),
            "language": spoken,
            "speakers": merge.renumber(utterances),
            "utterances": utterances,
            "words": kept,
            "audio": "audio.ogg",
            "speakersStatus": speakers_status,
        }
        if kind == "note":
            transcript["title"] = notes.first_words(" ".join(u["text"] for u in utterances), 8)
            try:
                transcript["note"] = str(notes.write_note(transcript, settings["kbDir"], settings["kbInbox"]))
            except notes.NoKnowledgeBase:
                transcript["noteError"] = "No knowledge base folder is chosen: the note stays in Transcripts"
        store.save(id, transcript)
        # The sources go only now: a job that fails on the way can run again from them.
        for item in inputs:
            if item.get("temp"):
                Path(item["path"]).unlink(missing_ok=True)
        shutil.rmtree(store.folder(id) / "incoming", ignore_errors=True)
        store.update(id, status="done", stage="", progress=1.0, speakers_status=speakers_status, job={"kind": kind})

    def _resplit(self, id: str, row: dict) -> None:
        """Speakers for a finished transcript from its saved sound and words; the text is not recognized again."""
        store = self.get_store()
        progress = self._progress(id)
        t = store.transcript(id)
        if not t or not t.get("words"):
            raise ValueError("the recording keeps no words")
        progress("decode")
        samples = audio.decode(store.folder(id) / t.get("audio", "audio.ogg"), lambda p: progress("decode", p))
        store.update(id, duration=t.get("duration", 0))
        turns, status = self._speakers(id, samples, row["job"].get("speakers"), progress)
        if status == "no-part":
            raise ValueError("the speakers part is not installed")
        if status == "needs-token":
            raise ValueError("a Hugging Face key is needed")
        if status != "ok":
            raise ValueError("the speakers model failed, see speech.log")
        progress("save")
        me = t.get("speakers", {}).get(merge.ME)
        t["utterances"] = merge.resplit(t, turns or [])
        t["speakers"] = merge.renumber(t["utterances"])
        if me and merge.ME in t["speakers"]:
            t["speakers"][merge.ME] = me
        t["speakersStatus"] = "ok"
        store.save(id, t)
        store.update(id, status="done", stage="", progress=1.0, speakers_status="ok", error="", job={"kind": row["job"].get("kind")})
