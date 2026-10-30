"""The library: one folder per transcript under the data folder, and index.db to list and search them.

<data>/<id>/transcript.json   what was said (the source of truth)
<data>/<id>/audio.ogg         the sound, to hear a line again
<data>/<id>/incoming/         a recording's chunks until it is finished
"""

from __future__ import annotations

import json
import secrets
import shutil
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

COLUMNS = ("id", "title", "source", "created", "duration", "status", "stage", "progress", "error", "language", "speakers_status", "job", "touched")
LIST_COLUMNS = ("id", "title", "source", "created", "duration", "status", "stage", "progress", "error", "language", "speakers_status")


def new_id(now: datetime | None = None) -> str:
    now = now or datetime.now()
    return f"{now:%Y-%m-%d_%H%M%S}-{secrets.token_hex(2)}"


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Store:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(root / "index.db"), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(
            """
            create table if not exists transcripts(
              id text primary key, title text not null, source text not null, created text not null,
              duration real default 0, status text not null, stage text default '', progress real default 0,
              error text default '', language text default '', speakers_status text default '',
              job text default '{}', touched text default '');
            create virtual table if not exists search using fts5(id unindexed, title, body, tokenize='unicode61 remove_diacritics 2');
            """
        )

    def folder(self, id: str) -> Path:
        # One folder right inside the library: no separators, no "..", no drive ("D:" alone is drive D on Windows).
        if not id or "/" in id or "\\" in id or ".." in id or ":" in id or id.strip(" .") != id:
            raise KeyError(id)
        return self.root / id

    def create(self, title: str, source: str, status: str, job: dict | None = None) -> str:
        id = new_id()
        self.folder(id).mkdir(parents=True)
        with self._lock, self._db:
            self._db.execute(
                "insert into transcripts(id, title, source, created, status, job, touched) values(?,?,?,?,?,?,?)",
                (id, title, source, now_iso(), status, json.dumps(job or {}, ensure_ascii=False), now_iso()),
            )
        return id

    def update(self, id: str, **fields) -> None:
        if "job" in fields:
            fields["job"] = json.dumps(fields["job"], ensure_ascii=False)
        keys = [k for k in fields if k in COLUMNS and k != "id"]
        if not keys:
            return
        with self._lock, self._db:
            self._db.execute(
                f"update transcripts set {', '.join(f'{k}=?' for k in keys)} where id=?",
                [fields[k] for k in keys] + [id],
            )

    def row(self, id: str) -> dict | None:
        with self._lock:
            r = self._db.execute("select * from transcripts where id=?", (id,)).fetchone()
        if r is None:
            return None
        out = dict(r)
        out["job"] = json.loads(out["job"] or "{}")
        return out

    def rows(self, status: tuple[str, ...]) -> list[dict]:
        with self._lock:
            found = self._db.execute(
                f"select * from transcripts where status in ({','.join('?' * len(status))}) order by created", status
            ).fetchall()
        return [dict(r) | {"job": json.loads(r["job"] or "{}")} for r in found]

    def list(self, query: str = "") -> list[dict]:
        columns = ", ".join(f"t.{c}" for c in LIST_COLUMNS)
        with self._lock:
            if query.strip():
                terms = " ".join(f'"{t}"*' for t in query.replace('"', " ").split())
                found = self._db.execute(
                    f"select {columns}, snippet(search, 2, '[', ']', '…', 12) as snippet from search s "
                    "join transcripts t on t.id = s.id where search match ? order by t.created desc",
                    (terms,),
                ).fetchall()
            else:
                found = self._db.execute(f"select {columns} from transcripts t order by t.created desc").fetchall()
        return [dict(r) for r in found]

    def transcript(self, id: str) -> dict | None:
        try:
            return json.loads((self.folder(id) / "transcript.json").read_text("utf-8"))
        except (OSError, ValueError, KeyError):
            return None

    def save(self, id: str, transcript: dict) -> None:
        """Writes transcript.json and puts its text in the search index."""
        folder = self.folder(id)
        tmp = folder / "transcript.tmp"
        tmp.write_text(json.dumps(transcript, ensure_ascii=False, indent=1), "utf-8")
        tmp.replace(folder / "transcript.json")
        body = "\n".join(u["text"] for u in transcript.get("utterances", []))
        with self._lock, self._db:
            self._db.execute("delete from search where id=?", (id,))
            self._db.execute("insert into search(id, title, body) values(?,?,?)", (id, transcript.get("title", ""), body))
            self._db.execute(
                "update transcripts set title=?, duration=?, language=? where id=?",
                (transcript.get("title", ""), transcript.get("duration", 0), transcript.get("language", ""), id),
            )

    def delete(self, id: str) -> None:
        with self._lock, self._db:
            self._db.execute("delete from transcripts where id=?", (id,))
            self._db.execute("delete from search where id=?", (id,))
        shutil.rmtree(self.folder(id), ignore_errors=True)
