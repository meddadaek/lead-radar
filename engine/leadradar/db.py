import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

from .config import DB_PATH

_lock = threading.RLock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row
_conn.executescript("""
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, found_at TEXT NOT NULL, updated_at TEXT NOT NULL, search_id TEXT);
CREATE TABLE IF NOT EXISTS lead_keys (key TEXT PRIMARY KEY, lead_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY, params TEXT NOT NULL, created TEXT NOT NULL, state TEXT NOT NULL,
  progress TEXT NOT NULL DEFAULT '{}', last_run TEXT, last_error TEXT);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, search_id TEXT, ts TEXT, level TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS source_health (
  name TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, checked_at TEXT NOT NULL);
""")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _q(sql, args=(), commit=False):
    with _lock:
        cur = _conn.execute(sql, args)
        if commit:
            _conn.commit()
        return cur


# ---------------------------------------------------------------- leads

def lead_for_keys(keys) -> str | None:
    keys = list(keys)
    if not keys:
        return None
    row = _q(f"SELECT lead_id FROM lead_keys WHERE key IN ({','.join('?' * len(keys))}) LIMIT 1", keys).fetchone()
    return row["lead_id"] if row else None


def save_lead(lead: dict, keys, search_id: str) -> bool:
    """Insert or refresh a lead. Returns True if it is new."""
    with _lock:
        existing = lead_for_keys(keys)
        stamp = now()
        if existing:
            old = json.loads(_q("SELECT data FROM leads WHERE id=?", (existing,)).fetchone()["data"])
            lead["id"], lead["found_at"] = existing, old.get("found_at", stamp)
            lead["outreach"] = old.get("outreach", lead["outreach"])
            _q("UPDATE leads SET data=?, updated_at=? WHERE id=?", (json.dumps(lead, ensure_ascii=False), stamp, existing))
            new = False
        else:
            lead["id"] = "N" + uuid.uuid4().hex[:10]
            lead["found_at"] = stamp
            _q("INSERT INTO leads VALUES (?,?,?,?,?)", (lead["id"], json.dumps(lead, ensure_ascii=False), stamp, stamp, search_id))
            new = True
        for k in keys:
            _q("INSERT OR IGNORE INTO lead_keys VALUES (?,?)", (k, lead["id"]))
        _conn.commit()
        return new


def get_lead(lead_id: str) -> dict | None:
    row = _q("SELECT data FROM leads WHERE id=?", (lead_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def update_lead(lead: dict):
    _q("UPDATE leads SET data=?, updated_at=? WHERE id=?", (json.dumps(lead, ensure_ascii=False), now(), lead["id"]), commit=True)


def all_leads() -> list[dict]:
    return [json.loads(r["data"]) for r in _q("SELECT data FROM leads ORDER BY found_at DESC")]


# ---------------------------------------------------------------- searches

def _search_row(r) -> dict:
    return {
        "id": r["id"], "params": json.loads(r["params"]), "created": r["created"], "state": r["state"],
        "progress": json.loads(r["progress"] or "{}"), "last_run": r["last_run"], "last_error": r["last_error"],
    }


def add_search(params: dict) -> dict:
    sid = uuid.uuid4().hex[:12]
    _q("INSERT INTO searches (id, params, created, state) VALUES (?,?,?,?)", (sid, json.dumps(params), now(), "queued"), commit=True)
    return get_search(sid)


def get_search(sid: str) -> dict | None:
    r = _q("SELECT * FROM searches WHERE id=?", (sid,)).fetchone()
    return _search_row(r) if r else None


def list_searches() -> list[dict]:
    return [_search_row(r) for r in _q("SELECT * FROM searches ORDER BY created DESC")]


def update_search(sid: str, **fields):
    if "progress" in fields:
        fields["progress"] = json.dumps(fields["progress"])
    sets = ", ".join(f"{k}=?" for k in fields)
    _q(f"UPDATE searches SET {sets} WHERE id=?", (*fields.values(), sid), commit=True)


def delete_search(sid: str):
    _q("DELETE FROM searches WHERE id=?", (sid,))
    _q("DELETE FROM events WHERE search_id=?", (sid,), commit=True)


def log(sid: str, level: str, message: str):
    _q("INSERT INTO events (search_id, ts, level, message) VALUES (?,?,?,?)", (sid, now(), level, message), commit=True)


def events(sid: str, limit: int = 60) -> list[dict]:
    rows = _q("SELECT ts, level, message FROM events WHERE search_id=? ORDER BY id DESC LIMIT ?", (sid, limit))
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- source health

def set_health(name: str, status: str, detail: str):
    _q("INSERT OR REPLACE INTO source_health VALUES (?,?,?,?)", (name, status, detail[:300], now()), commit=True)


def health() -> dict:
    return {r["name"]: {"status": r["status"], "detail": r["detail"], "checked_at": r["checked_at"]}
            for r in _q("SELECT * FROM source_health")}
