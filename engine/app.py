"""Altype's speech service: a local HTTP service on 127.0.0.1 for Altype, its Chrome extension and other apps.

Run: python app.py [--port 8765]. Only this computer can reach it; a web page
cannot call it either (see `guard`), only the app (no Origin) and the extension.

What other apps may use, and keep using:
  POST /dictate?language=auto|ru|en   a short recording (any format) -> {text, language}
  POST /dictate/prepare               loads the dictation model, so the next phrase is quick
  POST /transcripts {path}            a file on this computer -> a transcript in the library
  POST /recordings ...                a recording that arrives in chunks (the extension)
  GET  /health                        what is installed (parts), loaded and busy
"""

from __future__ import annotations

import argparse
import logging
import os
import secrets
import sys
import threading
import time
from pathlib import Path

# Hugging Face is asked for models only when one is missing (diarize.py downloads explicitly).
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import uvicorn
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response

import asr
import audio
import diarize
import export
import notes
from jobs import Worker, finish_recording
from settings import APP_DIR, CPU_DICTATION, Settings, adopt_altscribe
from store import Store, now_iso

VERSION = "0.1.0"
PORT = 8765
SOURCES = ("file", "mic", "meet", "note")
TRACKS = ("main", "mic", "tab")
MEDIA = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".mp3", ".m4a", ".wav", ".ogg", ".oga", ".opus", ".flac", ".aac", ".wma"}

log = logging.getLogger("altype")
settings = Settings()


class State:
    store: Store = None  # type: ignore[assignment]
    store_dir: str = ""

    def get_store(self) -> Store:
        wanted = settings["dataDir"]
        if self.store is None or self.store_dir != wanted:
            self.store = Store(Path(wanted))
            self.store_dir = wanted
        return self.store


state = State()
worker = Worker(settings, state.get_store)
setup = diarize.Setup()
app = FastAPI(title="Altype speech", version=VERSION)
app.add_middleware(CORSMiddleware, allow_origin_regex=r"chrome-extension://[a-p]{32}", allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def guard(request: Request, call_next):
    """The app calls without an Origin, the extension from chrome-extension://; any web page is refused.

    The Host check stops DNS rebinding: a page whose name points at 127.0.0.1 still says its own name.
    """
    host = request.headers.get("host", "").split(":")[0]
    origin = request.headers.get("origin", "")
    if host not in ("127.0.0.1", "localhost") or (origin and not origin.startswith("chrome-extension://")):
        return JSONResponse({"detail": "forbidden"}, status_code=403)
    return await call_next(request)


def whisper_status(model: str) -> str:
    if worker.transcriber.loaded:
        return "loaded"
    return "ready" if asr.downloaded(model) else "missing"


def dictation() -> tuple:
    """Who dictates: on the card, the transcripts' own model (already loaded, two workers); on the CPU, a small one."""
    if asr.gpu():
        return worker.transcriber, settings["model"]
    return worker.dictator, CPU_DICTATION


@app.get("/health")
def health():
    s = settings.get()
    _, dictation_model = dictation()
    return {
        "ok": True,
        "version": VERSION,
        "device": worker.device,
        "parts": {"core": True, "gpu": asr.gpu(), "speakers": diarize.installed()},
        "whisper": whisper_status(s["model"]),
        "models": {"transcripts": asr.model_state(s["model"]), "dictation": asr.model_state(dictation_model)},
        "diarization": diarize.status(s["hfToken"], setup),
        "diarizationMessage": setup.message,
        "busy": worker.current,
        "queued": worker.queue.qsize(),
        "dataDir": s["dataDir"],
        "kbDir": s["kbDir"],
    }


# Dictation ----------------------------------------------------------------

DICTATION_LONGEST = 300  # seconds; anything longer is a recording for /transcripts
_dictating = threading.Lock()


def _prepare() -> None:
    transcriber, model = dictation()
    try:
        transcriber.warm(model)
    except Exception:
        log.exception("could not load the dictation model")


@app.post("/dictate/prepare")
def prepare_dictation():
    """Loads (and the first time downloads) the dictation model in the background; /health shows how far."""
    threading.Thread(target=_prepare, name="altype-prepare", daemon=True).start()
    _, model = dictation()
    return asr.model_state(model)


@app.post("/dictate")
async def dictate(request: Request, language: str = "auto"):
    """A short recording to its text. Nothing is kept: the sound is read and thrown away."""
    data = await request.body()
    if not data:
        raise HTTPException(400, "No sound")
    if len(data) > 60_000_000:
        raise HTTPException(413, "Too long for dictation: transcribe it instead")
    tmp = APP_DIR / "tmp" / f"dictate-{secrets.token_hex(4)}"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(data)
    try:
        samples = await run_in_threadpool(audio.decode, tmp)
    except Exception as error:
        raise HTTPException(415, f"Not a recording: {error}")
    finally:
        tmp.unlink(missing_ok=True)
    seconds = audio.duration(samples)
    if seconds > DICTATION_LONGEST:
        raise HTTPException(413, "Too long for dictation: transcribe it instead")
    if seconds < 0.3:
        return {"text": "", "language": language, "seconds": round(seconds, 2)}

    def run():
        with _dictating:
            transcriber, model = dictation()
            return transcriber.dictate(samples, model, None if language == "auto" else language, settings["hotwords"])

    started = time.perf_counter()
    text, spoken = await run_in_threadpool(run)
    worker.last_work = time.monotonic()
    return {"text": text, "language": spoken, "seconds": round(seconds, 2), "took": round(time.perf_counter() - started, 2)}


# Settings -----------------------------------------------------------------

def public_settings() -> dict:
    s = settings.get()
    s["hasToken"] = bool(s.pop("hfToken"))
    return s


@app.get("/settings")
def get_settings():
    return public_settings()


@app.put("/settings")
def put_settings(changes: dict = Body(...)):
    """A new Hugging Face token is checked, and the speakers' model downloaded, right away."""
    settings.update(changes)
    if isinstance(changes.get("hfToken"), str) and changes["hfToken"].strip():
        setup.start(settings["hfToken"])
    return public_settings()


@app.post("/diarization/setup")
def setup_again():
    """Checks the saved token again: after the model's terms were accepted, or the connection came back."""
    if not settings["hfToken"]:
        raise HTTPException(409, "Paste a Hugging Face key first")
    setup.start(settings["hfToken"])
    return {"state": diarize.status(settings["hfToken"], setup)}


# Library ------------------------------------------------------------------

def transcript_or_404(id: str) -> dict:
    try:
        t = state.get_store().transcript(id)
    except KeyError:
        t = None
    if t is None:
        raise HTTPException(404, "No such transcript")
    return t


@app.get("/transcripts")
def list_transcripts(q: str = ""):
    return state.get_store().list(q)


def public(t: dict, id: str) -> dict:
    """A transcript as the window wants it: without the words (thousands of them), saying whether they are kept."""
    out = {k: v for k, v in t.items() if k != "words"}
    out["hasWords"] = bool(t.get("words"))
    out["audioPath"] = str(state.get_store().folder(id) / t.get("audio", "audio.ogg"))
    return out


@app.get("/transcripts/{id}")
def get_transcript(id: str):
    store = state.get_store()
    row = store.row(id)
    if row is None:
        raise HTTPException(404, "No such transcript")
    row.pop("job", None)
    t = store.transcript(id)
    return {"row": row, "transcript": public(t, id) if t is not None else None}



@app.patch("/transcripts/{id}")
def patch_transcript(id: str, changes: dict = Body(...)):
    """Title, speaker names, an utterance's text or speaker: {title?, speakers?: {key: name}, utterances?: {index: {text?, speaker?}}}."""
    store = state.get_store()
    t = transcript_or_404(id)
    if isinstance(changes.get("title"), str) and changes["title"].strip():
        t["title"] = changes["title"].strip()
    for key, name in (changes.get("speakers") or {}).items():
        if key in t["speakers"] and isinstance(name, str) and name.strip():
            t["speakers"][key]["name"] = name.strip()
    for index, edit in (changes.get("utterances") or {}).items():
        i = int(index)
        if 0 <= i < len(t["utterances"]):
            if isinstance(edit.get("text"), str) and edit["text"].strip() != t["utterances"][i]["text"]:
                t["utterances"][i]["text"] = edit["text"].strip()
                # A line fixed by hand is never cut up again when speakers are split later.
                t["utterances"][i]["edited"] = True
            if edit.get("speaker") in t["speakers"]:
                t["utterances"][i]["speaker"] = edit["speaker"]
    t["utterances"] = [u for u in t["utterances"] if u["text"]]
    t["edited"] = now_iso()
    store.save(id, t)
    return public(t, id)


@app.post("/transcripts/{id}/speakers")
def split_speakers(id: str, body: dict = Body(default={})):
    """Speakers for a finished transcript: from its saved words when it has them, else by recognizing its sound anew."""
    store = state.get_store()
    row = store.row(id)
    t = transcript_or_404(id)
    if row is None or row["status"] != "done":
        raise HTTPException(409, "This recording is still being transcribed")
    if row["source"] == "note":
        raise HTTPException(409, "A note has one voice")
    if not diarize.installed():
        raise HTTPException(409, "Install the speakers part first")
    if diarize.status(settings["hfToken"], setup) == "needs-token":
        raise HTTPException(409, "Add a Hugging Face key first")
    speakers = body.get("speakers") or None
    if t.get("words"):
        job = {"kind": row["source"], "task": "speakers", "speakers": speakers}
    elif row["source"] in ("file", "mic"):
        audio_path = store.folder(id) / t.get("audio", "audio.ogg")
        if not audio_path.exists():
            raise HTTPException(410, "The sound of this recording was not kept")
        job = {"kind": row["source"], "task": "redo", "keepAudio": True, "speakers": speakers,
               "language": t.get("language") or None,
               "inputs": [{"path": str(audio_path), "track": "main", "offset": 0, "temp": False}]}
    else:
        raise HTTPException(409, "This meeting can no longer be split: its words were not kept")
    store.update(id, status="queued", stage="", progress=0, error="", job=job)
    worker.submit(id)
    return {"id": id, "task": job["task"]}


@app.delete("/transcripts/{id}")
def delete_transcript(id: str):
    store = state.get_store()
    if store.row(id) is None:
        raise HTTPException(404, "No such transcript")
    if worker.current == id:
        raise HTTPException(409, "This recording is being transcribed right now")
    store.delete(id)
    return {"ok": True}


@app.post("/transcripts/{id}/retry")
def retry(id: str):
    """Runs a failed job again, when its sound is still there."""
    store = state.get_store()
    row = store.row(id)
    if row is None or row["status"] != "failed":
        raise HTTPException(409, "Only a failed transcription can be tried again")
    if not all(Path(i["path"]).exists() for i in row["job"].get("inputs", [])) or not row["job"].get("inputs"):
        raise HTTPException(410, "The source sound is gone")
    store.update(id, status="queued", error="", progress=0)
    worker.submit(id)
    return {"ok": True}


@app.get("/transcripts/{id}/audio")
def get_audio(id: str):
    transcript_or_404(id)
    path = state.get_store().folder(id) / "audio.ogg"
    if not path.exists():
        raise HTTPException(404, "No sound")
    return FileResponse(path, media_type="audio/ogg")


@app.post("/transcripts/{id}/export")
def export_to(id: str, body: dict = Body(...)):
    """Writes the transcript to body.path in body.format (the app asked where with a Save dialog)."""
    t = transcript_or_404(id)
    fmt = body.get("format")
    if fmt not in export.FORMATS or not body.get("path"):
        raise HTTPException(400, "format and path are needed")
    path = Path(body["path"])
    export.write(t, fmt, path)
    return {"path": str(path)}


@app.get("/transcripts/{id}/text")
def text_of(id: str, format: str = "txt"):
    if format not in ("txt", "md", "srt", "vtt"):
        raise HTTPException(400, "Text formats: txt, md, srt, vtt")
    t = transcript_or_404(id)
    body = {"txt": export.to_txt, "md": export.to_md, "srt": export.to_srt, "vtt": export.to_vtt}[format](t)
    return Response(body, media_type="text/plain; charset=utf-8")


@app.post("/transcripts/{id}/to-kb")
def to_kb(id: str):
    t = transcript_or_404(id)
    s = settings.get()
    try:
        path = notes.write_transcript(t, s["kbDir"], s["kbInbox"])
    except notes.NoKnowledgeBase:
        raise HTTPException(409, "Choose a knowledge base folder first")
    return {"path": str(path)}


# New work -----------------------------------------------------------------

@app.post("/transcripts")
def from_file(body: dict = Body(...)):
    """A file on this computer, by its path. It is read where it is: never copied, never deleted."""
    path = Path(body.get("path", ""))
    if not path.is_file():
        raise HTTPException(400, "File not found")
    if path.suffix.lower() not in MEDIA:
        raise HTTPException(415, "Not an audio or video file")
    job = {
        "kind": "file",
        "inputs": [{"path": str(path), "track": "main", "offset": 0, "temp": False}],
        "language": body.get("language") or None,
        "speakers": body.get("speakers") or None,
    }
    store = state.get_store()
    id = store.create(body.get("title") or path.stem, "file", "queued", job)
    worker.submit(id)
    return {"id": id}


@app.post("/recordings")
def start_recording(body: dict = Body(...)):
    """A recording that arrives in chunks: {source, title?, tracks: {tab|mic|main: {startedAt}}}."""
    source = body.get("source")
    tracks = body.get("tracks") or {}
    if source not in ("mic", "meet", "note") or not tracks or any(t not in TRACKS for t in tracks):
        raise HTTPException(400, "source and tracks are needed")
    title = (body.get("title") or "").strip() or {"mic": "Microphone recording", "meet": "Meeting", "note": "Note"}[source]
    store = state.get_store()
    job = {"kind": source, "tracks": {t: {"startedAt": float(v.get("startedAt", 0))} for t, v in tracks.items()},
           "language": body.get("language") or None, "speakers": body.get("speakers") or None}
    id = store.create(title, source, "recording", job)
    (store.folder(id) / "incoming").mkdir()
    return {"id": id}


@app.put("/recordings/{id}/{track}/{seq}")
async def chunk(id: str, track: str, seq: int, request: Request):
    store = state.get_store()
    row = store.row(id)
    if row is None or row["status"] != "recording":
        raise HTTPException(409, "The recording has ended")
    if track not in row["job"].get("tracks", {}) or not 0 <= seq < 1_000_000:
        raise HTTPException(400, "No such track")
    data = await request.body()
    part = store.folder(id) / "incoming" / f"{track}-{seq:06d}.part"
    part.write_bytes(data)
    store.update(id, touched=now_iso())
    return Response(status_code=204)


@app.post("/recordings/{id}/finish")
def finish(id: str, body: dict = Body(default={})):
    store = state.get_store()
    if not finish_recording(store, id, body):
        raise HTTPException(409, "Nothing to transcribe")
    worker.submit(id)
    return {"id": id}


@app.delete("/recordings/{id}")
def cancel(id: str):
    store = state.get_store()
    row = store.row(id)
    if row is not None and row["status"] == "recording":
        store.delete(id)
    return {"ok": True}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.environ.get("ALTYPE_SPEECH_PORT", PORT)))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    # Only a real start adopts Altscribe's folders, never an import (the tests import this module).
    adopt_altscribe()
    settings.reload()
    worker.start()
    if settings["hfToken"] and not diarize.downloaded():
        setup.start(settings["hfToken"])
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
