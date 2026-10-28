r"""The speech engine's settings: %APPDATA%\Altype\speech.json.

Altype's own settings (keys, theme) are its settings.json beside it; these are
the ones the engine acts on. Altscribe, the app this engine came from, is
adopted once: its settings and its downloaded models move over.
"""

from __future__ import annotations

import ctypes
import json
import logging
import os
import shutil
import threading
import uuid
from pathlib import Path

log = logging.getLogger("altype.settings")

# A test run gives its own folders; the real ones are Altype's.
TEST_HOME = os.environ.get("ALTYPE_SPEECH_HOME")
APP_DIR = Path(TEST_HOME or Path(os.environ.get("APPDATA", Path.home())) / "Altype")
SPEECH_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Altype" / "speech"
MODELS_DIR = SPEECH_DIR / "models"
SETTINGS_FILE = APP_DIR / "speech.json"

OLD_SETTINGS = Path(os.environ.get("APPDATA", Path.home())) / "Altscribe" / "engine.json"
OLD_MODELS = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Altscribe" / "models"

# The speech models Altype can use: engine/models.json, shared with src/speechplan.ts.
CATALOG = json.loads((Path(__file__).resolve().parent / "models.json").read_text("utf-8"))
MODELS = tuple(m["name"] for m in CATALOG["models"] if m["backend"] == "whisper")
# Every model, Whisper or not (Parakeet dictates on the processor), with where and for what it may run.
ALL_MODELS = {m["name"]: m for m in CATALOG["models"]}
# Dictation on the CPU while Altype has sent no plan (an older Altype, or the plan
# not made yet): large-v3-turbo takes ~6 s for a 7 s phrase there, small ~2 s.
CPU_DICTATION = "small"
LANGUAGES = ("auto", "ru", "en")
DEVICES = ("cpu", "cuda")
FEATURES = ("dictation", "transcripts")
COMPUTE = {"cpu": ("int8",), "cuda": ("float16", "int8_float16")}


def documents_dir() -> Path:
    """The person's Documents folder, wherever Windows moved it (OneDrive)."""
    try:
        folder_id = uuid.UUID("{FDD39AD0-238F-46AF-ADB4-6C85480369C7}")  # FOLDERID_Documents
        guid = (ctypes.c_byte * 16).from_buffer_copy(folder_id.bytes_le)
        out = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(guid, 0, None, ctypes.byref(out)) == 0:
            path = Path(out.value)
            ctypes.windll.ole32.CoTaskMemFree(out)
            return path
    except (AttributeError, OSError):
        pass
    return Path.home() / "Documents"


def defaults() -> dict:
    return {
        "model": "large-v3-turbo",
        "language": "auto",
        "hotwords": "",
        "hfToken": "",
        "dataDir": str(documents_dir() / "Altype" / "Transcripts"),
        "kbDir": "",
        "kbInbox": "Inbox",
        # What runs where, made by Altype from this computer's measurements (src/speechplan.ts):
        # {threads, cpu: {dictation: {model, beam}, transcripts: {model}}, cuda: {... compute}}.
        "plan": {},
        # How fast each model runs here: {fingerprint, at, runs: {"model|device|compute": {phrase, rtf, n, at}}}.
        "bench": {},
    }


def adopt_altscribe(file: Path = SETTINGS_FILE) -> None:
    """Altscribe's settings (its library folder, knowledge base, Hugging Face key) and models, once."""
    if TEST_HOME:
        return
    if not file.exists() and OLD_SETTINGS.exists():
        try:
            file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(OLD_SETTINGS, file)
            log.info("adopted Altscribe's settings")
        except OSError as error:
            log.warning("could not adopt Altscribe's settings: %s", error)
    if not MODELS_DIR.exists() and OLD_MODELS.exists():
        try:
            MODELS_DIR.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(OLD_MODELS), str(MODELS_DIR))
            log.info("adopted Altscribe's models")
        except OSError as error:
            log.warning("could not adopt Altscribe's models: %s", error)


def clean_plan(plan: dict) -> dict:
    """A plan as Altype sends it, with anything this engine does not know left out."""
    out: dict = {}
    if isinstance(plan.get("fingerprint"), str):
        out["fingerprint"] = plan["fingerprint"][:64]
    if isinstance(plan.get("threads"), int) and 1 <= plan["threads"] <= 256:
        out["threads"] = plan["threads"]
    for device in DEVICES:
        entries = plan.get(device)
        if not isinstance(entries, dict):
            continue
        for feature in FEATURES:
            entry = entries.get(feature)
            known = ALL_MODELS.get(entry.get("model")) if isinstance(entry, dict) else None
            if not known or device not in known.get("devices", DEVICES) or feature not in known.get("features", FEATURES):
                continue
            clean = {"model": entry["model"]}
            if entry.get("compute") in COMPUTE[device]:
                clean["compute"] = entry["compute"]
            if isinstance(entry.get("beam"), int) and 1 <= entry["beam"] <= 10:
                clean["beam"] = entry["beam"]
            out.setdefault(device, {})[feature] = clean
    return out


class Settings:
    def __init__(self, file: Path = SETTINGS_FILE):
        self.file = file
        self._lock = threading.Lock()
        self.reload()

    def reload(self) -> None:
        values = defaults()
        try:
            stored = json.loads(self.file.read_text("utf-8"))
            values.update({k: v for k, v in stored.items() if k in values})
        except (OSError, ValueError):
            pass
        with self._lock:
            self._values = values
            self._check()

    def _check(self) -> None:
        if self._values["model"] not in MODELS:
            self._values["model"] = "large-v3-turbo"
        if self._values["language"] not in LANGUAGES:
            self._values["language"] = "auto"
        self._values["plan"] = clean_plan(self._values["plan"])
        if not isinstance(self._values["bench"].get("runs"), dict):
            self._values["bench"] = {}

    def get(self) -> dict:
        with self._lock:
            return dict(self._values)

    def __getitem__(self, key: str):
        with self._lock:
            return self._values[key]

    def update(self, changes: dict) -> dict:
        with self._lock:
            for key, value in changes.items():
                if key in self._values and isinstance(value, type(self._values[key])):
                    self._values[key] = value.strip() if isinstance(value, str) and key != "hotwords" else value
            self._check()
            self.file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.file.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._values, ensure_ascii=False, indent=2), "utf-8")
            tmp.replace(self.file)
            return dict(self._values)

    @property
    def data_dir(self) -> Path:
        return Path(self["dataDir"])
